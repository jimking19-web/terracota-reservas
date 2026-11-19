// Panel de administración · Terracota Suites
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = c => c == null ? '' : (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const eurShort = c => (c / 100).toLocaleString('es-ES', { maximumFractionDigits: c % 100 ? 2 : 0 }) + '€';
const toEuros = c => c == null ? '' : String(c / 100).replace('.', ',');
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fd = (s, o = { day: 'numeric', month: 'short' }) => new Date(s + 'T00:00:00Z').toLocaleDateString('es-ES', { ...o, timeZone: 'UTC' });
const DOW = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STATUS = { confirmed: 'Confirmada', pending: 'Pendiente', cancelled: 'Cancelada', expired: 'Caducada' };
const SOURCE = { web: 'Web', manual: 'Manual', bloqueo: 'Bloqueo' };

let S = null;           // estado del servidor
let unitId = Number(localStorage.getItem('ts_unit') || 1);
const unit = () => S.units.find(u => u.id === unitId) || S.units[0];

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error('Sesión caducada'); }
  const j = await r.json().catch(() => ({ ok: false, error: 'Respuesta no válida' }));
  return j;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2800);
}
async function act(promise, okMsg) {
  const r = await promise;
  if (r.ok === false) { toast(r.error || 'Error', true); return null; }
  if (okMsg) toast(okMsg);
  return r;
}

// ---------- selector de días de la semana ----------
function daysPick(el, values) {
  const set = new Set(values.map(Number));
  const labels = el.dataset.labels === 'day' ? DOW : ['D→L', 'L→M', 'M→X', 'X→J', 'J→V', 'V→S', 'S→D'];
  el.innerHTML = DOW_ORDER.map(d => `<button type="button" data-d="${d}" class="${set.has(d) ? 'on' : ''}" title="${labels[d]}">${labels[d]}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
}
const daysValue = el => $$(`[data-name="${el.dataset.name}"] button.on`).filter(b => el.contains(b)).map(b => Number(b.dataset.d));

// ---------- login / primera activación ----------
let setupMode = false;
async function showLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  const st = await fetch('/api/admin/status').then(r => r.json()).catch(() => ({}));
  setupMode = !!st.setup;
  $('#setupBox').hidden = $('#pw2Box').hidden = !setupMode;
  $('#pwLabel').textContent = setupMode ? 'Nueva contraseña (mínimo 8 caracteres)' : 'Contraseña';
  $('#pw').autocomplete = setupMode ? 'new-password' : 'current-password';
  $('#loginForm .btn').textContent = setupMode ? 'Crear contraseña y entrar' : 'Entrar';
  const code = new URLSearchParams(location.search).get('codigo');
  if (code) $('#setupCode').value = code;
  (setupMode && !code ? $('#setupCode') : $('#pw')).focus();
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  let r;
  if (setupMode) {
    if ($('#pw').value.length < 8) return ($('#loginErr').textContent = 'Mínimo 8 caracteres');
    if ($('#pw').value !== $('#pw2').value) return ($('#loginErr').textContent = 'Las contraseñas no coinciden');
    r = await api('/api/admin/setup', 'POST', { code: $('#setupCode').value, password: $('#pw').value });
  } else r = await api('/api/admin/login', 'POST', { password: $('#pw').value });
  if (!r.ok) { $('#loginErr').textContent = r.error; return; }
  history.replaceState(null, '', '/admin/' + location.hash);
  $('#login').hidden = true; boot();
};
$('#logout').onclick = async () => { await api('/api/admin/logout', 'POST'); location.reload(); };

// ---------- navegación ----------
let currentTab = 'inicio';
function go(tab) {
  currentTab = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach(v => v.hidden = v.dataset.view !== tab);
  $('#title').textContent = $(`#tabs [data-tab="${tab}"]`).textContent.replace(/\d+$/, '').trim().replace(/^[^\wÁÉÍÓÚáéíóú]+/, '');
  $('.side').classList.remove('open');
  history.replaceState(null, '', '#' + tab);
  ({ clientes: renderClientes, visitas: renderVisits, inicio: renderHome, calendario: renderCal, reservas: loadBookings, tarifas: renderTarifas, codigos: renderPromos, sincro: renderSync, web: renderWeb, pagos: renderPagos })[tab]?.();
}
$('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });
$('#burger').onclick = () => $('.side').classList.toggle('open');
$('#unitSel').onchange = e => { unitId = Number(e.target.value); localStorage.setItem('ts_unit', unitId); go(currentTab); };
$$('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

async function refresh() {
  S = await api('/api/admin/state');
  if (!S.units.some(u => u.id === unitId)) unitId = S.units[0].id;
  $('#unitSel').innerHTML = S.units.map(u => `<option value="${u.id}" ${u.id === unitId ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  $('#unitSel').hidden = S.units.length < 2;
  $('#pendingPill').hidden = !S.pending; $('#pendingPill').textContent = S.pending;
}

async function boot() {
  try { await refresh(); } catch { return; }
  if (S.ok === false) return showLogin();
  $('#app').hidden = false;
  go((location.hash || '#inicio').slice(1) || 'inicio');
}

// ---------- INICIO ----------
async function renderHome() {
  const w = [];
  if (!S.stripe) w.push('<div class="warn">Stripe no está conectado: las reservas llegan como <b>solicitudes</b> sin pago. <button class="linkbtn" data-goto="pagos">Conectar Stripe</button></div>');
  else if (!S.webhook) w.push('<div class="warn">Falta STRIPE_WEBHOOK_SECRET: los pagos se confirman al volver el cliente a la web, pero conviene configurar el webhook.</div>');
  else if (S.stripeMode === 'test') w.push('<div class="warn">Stripe está en <b>modo de prueba</b>. Cambia a las claves «live» para cobrar de verdad.</div>');
  if (!S.mail) w.push('<div class="warn">Los emails a los huéspedes están desactivados. <button class="linkbtn" data-goto="pagos">Actívalos en 1 minuto con tu Gmail</button></div>');
  else if (!S.invoices) w.push('<div class="warn">Los emails están activos, pero falta completar los <button class="linkbtn" data-goto="pagos">datos de facturación</button> para que cada reserva lleve su factura.</div>');
  if (!S.feeds.length) w.push('<div class="warn">Aún no has conectado Airbnb ni Booking. <button class="linkbtn" data-goto="sincro">Conectar ahora</button></div>');
  $('#warnings').innerHTML = w.join('');

  const [b, st] = await Promise.all([api('/api/admin/bookings?filter=upcoming'), api('/api/admin/stats?year=' + ($('#statsYear').value || S.today.slice(0, 4)))]);
  const today = S.today;
  const mine = b.bookings.filter(x => x.unit_id === unitId);
  const inHouse = mine.filter(x => x.status === 'confirmed' && x.checkin <= today && x.checkout > today && x.source !== 'bloqueo');
  const next30 = mine.filter(x => x.status === 'confirmed' && x.checkin >= today && x.checkin <= addDays(today, 30) && x.source !== 'bloqueo');
  const totalYear = st.months.reduce((a, m) => a + m.total, 0);
  const nightsYear = st.months.reduce((a, m) => a + m.nights, 0);
  $('#kpis').innerHTML = [
    ['Huéspedes ahora', inHouse.length ? esc(inHouse[0].name.split(' ')[0]) : '—'],
    ['Llegadas 30 días', next30.length],
    [`Ingresos web/manual ${st.year}`, eur(totalYear)],
    [`Noches vendidas ${st.year}`, nightsYear],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join('');

  const list = [...mine.filter(x => x.source !== 'bloqueo').map(x => ({ ...x, kind: 'own' })), ...b.external.filter(x => x.unit_id === unitId).map(x => ({ checkin: x.start_date, checkout: x.end_date, name: x.summary || 'Reserva', source: x.feed_name, kind: 'ext' }))]
    .filter(x => x.checkout > today).sort((a, c) => a.checkin.localeCompare(c.checkin)).slice(0, 8);
  $('#nextArrivals').innerHTML = list.length ? list.map(x => `<div class="arrival" ${x.id ? `data-bid="${x.id}"` : ''}><div class="date">${new Date(x.checkin + 'T00:00:00Z').getUTCDate()}<small>${fd(x.checkin, { month: 'short' })}</small></div>
    <div style="flex:1"><b>${esc(x.name || '—')}</b><div class="muted small">${diff(x.checkin, x.checkout)} noches · hasta ${fd(x.checkout)} ${x.guests ? '· ' + x.guests + ' pers.' : ''}</div></div>
    <span class="tag ${x.kind === 'ext' ? 't-bloqueo' : 't-' + x.source}">${esc(x.kind === 'ext' ? x.source : SOURCE[x.source])}</span>${x.status === 'pending' ? '<span class="tag t-pending">Pendiente</span>' : ''}</div>`).join('')
    : '<p class="muted">No hay llegadas próximas.</p>';
  $$('#nextArrivals [data-bid]').forEach(el => el.onclick = () => openBooking(Number(el.dataset.bid), mine));

  const ys = $('#statsYear');
  if (!ys.options.length) { const y = Number(today.slice(0, 4)); ys.innerHTML = [y + 1, y, y - 1].map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join(''); ys.onchange = renderHome; }
  const months = Array.from({ length: 12 }, (_, i) => st.months.find(m => m.month === `${st.year}-${String(i + 1).padStart(2, '0')}`) || { total: 0 });
  const max = Math.max(1, ...months.map(m => m.total));
  $('#statsChart').innerHTML = `<div class="bars">${months.map((m, i) => `<div title="${eur(m.total)}"><em>${m.total ? Math.round(m.total / 100) : ''}</em><i style="height:${(m.total / max) * 100}%"></i>${'EFMAMJJASOND'[i]}</div>`).join('')}</div><p class="muted small">Solo reservas directas (web y manuales). Lo de Airbnb/Booking no se incluye.</p>`;
}

// ---------- CALENDARIO ----------
let calMonth = null, calDays = [], selA = null, selB = null;
async function renderCal() {
  if (!calMonth) calMonth = S.today.slice(0, 8) + '01';
  const d0 = new Date(calMonth + 'T00:00:00Z');
  const mt = d0.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(' de ', ' ');
  $('#cMonth').textContent = mt.charAt(0).toUpperCase() + mt.slice(1);
  const lead = (d0.getUTCDay() + 6) % 7;
  const start = addDays(calMonth, -lead);
  const r = await api(`/api/admin/calendar?unit=${unitId}&from=${start}&days=42`);
  calDays = r.days;
  drawCal();
}
function drawCal() {
  const month = calMonth.slice(0, 7);
  const [a, b] = selA && selB ? [selA, selB].sort() : [selA, selA];
  let html = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<div class="dow">${x}</div>`).join('');
  for (const d of calDays) {
    const cls = ['acell'];
    if (d.date.slice(0, 7) !== month) cls.push('out');
    if (d.date < S.today) cls.push('past');
    if (d.date === S.today) cls.push('today');
    if (a && d.date >= a && d.date <= b) cls.push('sel');
    const season = d.season ? S.seasons.find(s => s.name === d.season && s.unit_id === unitId) : null;
    let bk = '';
    if (d.booking) {
      const c = d.booking.status === 'pending' ? 'pending' : d.booking.source;
      bk = `<div class="bk ${c} ${d.booking.start ? '' : 'cont'}" data-bid="${d.booking.id}">${d.booking.start ? '' : '↳ '}${esc(d.booking.name || d.booking.ref)}</div>`;
    } else if (d.external) bk = `<div class="bk ext">${esc((S.feeds.find(f => f.id === d.external.feed_id) || {}).name || 'Externa')}</div>`;
    else if (d.closed) bk = '<div class="bk closed">Cerrado</div>';
    const meta = [`mín. ${d.minNights}`, d.noCheckin ? 'sin entrada' : '', d.rule?.note || ''].filter(Boolean).join(' · ');
    html += `<div class="${cls.join(' ')}" data-d="${d.date}">
      <div class="dn">${Number(d.date.slice(8))}<small>${d.weekend ? 'finde' : ''}</small></div>
      <div class="pr ${d.rule?.price != null ? 'rule' : ''}">${eurShort(d.price)}</div>
      ${season ? `<span class="season" style="background:${esc(season.color)}">${esc(season.name)}</span>` : ''}
      <div class="meta">${esc(meta)}</div>${bk}</div>`;
  }
  $('#acal').innerHTML = html;
}
$('#acal').onclick = e => {
  const bkEl = e.target.closest('[data-bid]');
  if (bkEl) { openBooking(Number(bkEl.dataset.bid)); return; }
  const c = e.target.closest('.acell'); if (!c) return;
  const d = c.dataset.d;
  if (!selA || selB) { selA = d; selB = null; drawCal(); return; }
  selB = d; drawCal(); openRange();
};
$('#cPrev').onclick = () => { const d = new Date(calMonth + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); calMonth = d.toISOString().slice(0, 10); renderCal(); };
$('#cNext').onclick = () => { const d = new Date(calMonth + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); calMonth = d.toISOString().slice(0, 10); renderCal(); };
$('#cToday').onclick = () => { calMonth = S.today.slice(0, 8) + '01'; renderCal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && currentTab === 'calendario') { selA = selB = null; drawCal(); } });

let rangeDirty = {};
function openRange() {
  const [a, b] = [selA, selB].sort();
  const sel = calDays.filter(d => d.date >= a && d.date <= b);
  const n = diff(a, b) + 1;
  $('#rangeTitle').textContent = a === b ? fd(a, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fd(a)} – ${fd(b)} · ${n} días`;
  const prices = [...new Set(sel.map(d => d.price))];
  const busy = sel.filter(d => d.booking || d.external).length;
  $('#rangeInfo').innerHTML = `<div class="kv"><span>Precio actual</span><b>${prices.length === 1 ? eur(prices[0]) : `${eurShort(Math.min(...prices))} – ${eurShort(Math.max(...prices))}`}</b>
    <span>Ocupados</span><b>${busy ? `${busy} de ${n} días` : 'Libre'}</b></div>`;
  const f = $('#rangeForm');
  f.reset();
  f.price.placeholder = prices.length === 1 ? `Actual: ${toEuros(prices[0])}` : 'Sin cambio';
  f.closed.checked = sel.every(d => d.closed);
  f.no_checkin.checked = sel.every(d => d.rule?.no_checkin);
  rangeDirty = {};
  f.closed.onchange = () => rangeDirty.closed = 1;
  f.no_checkin.onchange = () => rangeDirty.no_checkin = 1;
  f.note.oninput = () => rangeDirty.note = 1;
  daysPick(f.querySelector('[data-name="weekdays"]'), [0, 1, 2, 3, 4, 5, 6]);
  $('#rangeDrawer').showModal();
}
async function saveRange(clear) {
  const [a, b] = [selA, selB].sort();
  const f = $('#rangeForm');
  const weekdays = daysValue(f.querySelector('[data-name="weekdays"]'));
  const payload = { unit_id: unitId, from: a, to: b, weekdays: weekdays.length === 7 ? null : weekdays };
  if (clear) payload.clear = true;
  else {
    if (f.price.value.trim()) payload.price = f.price.value.trim();
    if (f.min_nights.value.trim()) payload.min_nights = f.min_nights.value.trim();
    if (rangeDirty.closed) payload.closed = f.closed.checked;
    if (rangeDirty.no_checkin) payload.no_checkin = f.no_checkin.checked;
    if (rangeDirty.note) payload.note = f.note.value;
    if (Object.keys(payload).length === 5) { toast('No has cambiado nada', true); return; }
  }
  if (await act(api('/api/admin/days', 'POST', payload), clear ? 'Días devueltos a la tarifa' : 'Cambios guardados')) {
    $('#rangeDrawer').close(); selA = selB = null; renderCal();
  }
}
$('#rangeSave').onclick = () => saveRange(false);
$('#rangeClear').onclick = () => saveRange(true);
$('#rangeBook').onclick = () => { const [a, b] = [selA, selB].sort(); $('#rangeDrawer').close(); bookingForm({ checkin: a, checkout: addDays(b, 1) }); };
$('#rangeBlock').onclick = async () => {
  const [a, b] = [selA, selB].sort();
  const name = prompt('Motivo del bloqueo (opcional)', 'Bloqueo');
  if (name === null) return;
  if (await act(api('/api/admin/bookings', 'POST', { unit_id: unitId, checkin: a, checkout: addDays(b, 1), source: 'bloqueo', name: name || 'Bloqueo' }), 'Fechas bloqueadas')) {
    $('#rangeDrawer').close(); selA = selB = null; renderCal();
  }
};
$('#rangeDrawer').addEventListener('close', () => { if (currentTab === 'calendario') { selA = selB = null; drawCal(); } });

// ---------- RESERVAS ----------
let bFilter = 'upcoming', bCache = [];
$('#bFilter').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; bFilter = b.dataset.f; $$('#bFilter button').forEach(x => x.classList.toggle('on', x === b)); loadBookings(); };
async function loadBookings() {
  const r = await api('/api/admin/bookings?filter=' + bFilter);
  bCache = r.bookings.filter(b => b.unit_id === unitId);
  $('#bTable').innerHTML = `<thead><tr><th>Ref.</th><th>Huésped</th><th>Entrada</th><th>Salida</th><th class="num">Noches</th><th class="num">Pers.</th><th class="num">Total</th><th>Origen</th><th>Estado</th></tr></thead><tbody>`
    + (bCache.length ? bCache.map(b => `<tr class="click" data-id="${b.id}"><td><b>${b.ref}</b></td><td>${esc(b.name)}<div class="muted small">${esc(b.phone || '')}</div></td><td>${fd(b.checkin, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${fd(b.checkout, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
      <td class="num">${b.nights}</td><td class="num">${b.guests}</td><td class="num">${b.source === 'bloqueo' ? '—' : eur(b.total)}${b.source !== 'bloqueo' && !b.paid && b.status === 'confirmed' ? '<div class="small" style="color:var(--warn)">sin cobrar</div>' : ''}</td>
      <td><span class="tag t-${b.source}">${SOURCE[b.source]}</span></td><td><span class="tag t-${b.status}">${STATUS[b.status]}</span>${b.internal_note?.includes('CONFLICTO') ? ' ⚠️' : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="empty">No hay reservas aquí</td></tr>') + '</tbody>';
  $$('#bTable tr.click').forEach(tr => tr.onclick = () => openBooking(Number(tr.dataset.id), bCache));
  const ext = r.external.filter(x => x.unit_id === unitId);
  $('#extCard').hidden = !ext.length;
  $('#extTable').innerHTML = '<thead><tr><th>Canal</th><th>Entrada</th><th>Salida</th><th class="num">Noches</th><th>Detalle</th></tr></thead><tbody>'
    + ext.map(x => `<tr><td><b>${esc(x.feed_name)}</b></td><td>${fd(x.start_date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${fd(x.end_date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="num">${diff(x.start_date, x.end_date)}</td><td class="muted">${esc(x.summary)}</td></tr>`).join('') + '</tbody>';
}

const DEP_ST = { pending: 'Pendiente de retener', held: 'Retenida en la tarjeta', captured: 'Cobrada', released: 'Liberada' };
function depositBlock(b) {
  if (!(b.deposit > 0)) return b.status === 'confirmed' ? `<div class="dep"><span class="muted">Sin fianza</span> <button type="button" class="linkbtn" data-dep="set">Añadir fianza</button></div>` : '';
  const st = b.deposit_status || 'pending';
  const rel = b.deposit_status === 'held' ? addDays(b.checkout, unit().deposit_release_days ?? 2) : null;
  return `<div class="dep"><div><b>Fianza ${eur(b.deposit)}</b> · <span class="tag ${st === 'held' ? 't-confirmed' : st === 'captured' ? 't-cancelled' : 't-pending'}">${DEP_ST[st] || st}</span>
    ${st === 'captured' ? ` · cobrados ${eur(b.deposit_captured)}` : ''}${rel && !b.deposit_keep ? `<br><span class="muted small">Se libera sola el ${fd(rel)}</span>` : ''}${b.deposit_note ? `<br><span class="muted small">${esc(b.deposit_note)}</span>` : ''}</div>
    <div class="row-btns" style="margin-top:8px">
      ${st === 'held' ? `<button type="button" class="btn" data-dep="capture">Cobrar fianza</button><button type="button" class="btn" data-dep="release">Liberar ya</button>
        <label class="chk"><input type="checkbox" data-dep="keep" ${b.deposit_keep ? 'checked' : ''}> No liberar sola (revisar daños)</label>` : ''}
      ${st === 'pending' && b.status === 'confirmed' ? `<button type="button" class="btn" data-dep="hold">Retener ahora</button><button type="button" class="btn" data-dep="link">Copiar enlace para el huésped</button>` : ''}
      ${st !== 'held' && st !== 'captured' ? `<button type="button" class="linkbtn" data-dep="set">Cambiar importe</button>` : ''}
    </div></div>`;
}
function bindDeposit(b, after) {
  $$('[data-dep]').forEach(el => {
    const a = el.dataset.dep;
    const run = async (payload, ok) => { const r = await api(`/api/admin/bookings/${b.id}/deposit`, 'POST', payload); if (!r.ok) return toast(r.error, true); if (ok) toast(ok); return r; };
    if (a === 'keep') { el.onchange = async () => { await run({ action: 'keep', keep: el.checked }, el.checked ? 'No se liberará sola' : 'Se liberará sola'); }; return; }
    el.onclick = async () => {
      if (a === 'set') { const v = prompt('Importe de la fianza en € (0 para quitarla):', b.deposit ? toEuros(b.deposit) : String((unit().deposit_amount || 12000) / 100)); if (v == null) return; if (await run({ action: 'set', amount: v }, 'Fianza actualizada')) after(); }
      if (a === 'hold') { el.disabled = true; if (await run({ action: 'hold' }, 'Fianza retenida')) after(); el.disabled = false; }
      if (a === 'link') { const r = await run({ action: 'link' }); if (r) { try { await navigator.clipboard.writeText(r.url); toast('Enlace copiado: pégalo en WhatsApp o email'); } catch { prompt('Copia este enlace:', r.url); } } }
      if (a === 'release') { if (confirm('¿Liberar la fianza? Ya no podrás cobrarla.') && await run({ action: 'release' }, 'Fianza liberada')) after(); }
      if (a === 'capture') { const v = prompt(`¿Cuánto cobras de la fianza? (máximo ${eur(b.deposit)})`, toEuros(b.deposit)); if (v == null) return; const why = prompt('Motivo (para tu registro):', '') ?? ''; if (await run({ action: 'capture', amount: v, reason: why }, 'Fianza cobrada')) after(); }
    };
  });
}

async function openBooking(id, cache) {
  let b = (cache || bCache).find(x => x.id === id);
  if (!b) { const r = await api('/api/admin/bookings?filter=all'); b = r.bookings.find(x => x.id === id); }
  if (!b) return toast('Reserva no encontrada', true);
  const lines = JSON.parse(b.breakdown || '[]');
  const isBlock = b.source === 'bloqueo';
  $('#modalBody').innerHTML = `<div class="drawer-h"><h3>${isBlock ? 'Bloqueo' : 'Reserva'} ${b.ref}</h3><button class="x" data-close>×</button></div>
  <div class="drawer-b">
    <p><span class="tag t-${b.status}">${STATUS[b.status]}</span> <span class="tag t-${b.source}">${SOURCE[b.source]}</span> ${b.paid ? '<span class="tag t-confirmed">Cobrada</span>' : ''}</p>
    ${b.internal_note?.includes('CONFLICTO') ? `<div class="warn">${esc(b.internal_note)}</div>` : ''}
    <div class="kv"><span>Fechas</span><b>${fd(b.checkin, { weekday: 'short', day: 'numeric', month: 'long' })} → ${fd(b.checkout, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })} (${b.nights} noches)</b>
      <span>Creada</span><span>${esc(b.created_at)} UTC</span>${b.stripe_payment ? `<span>Pago Stripe</span><a href="https://dashboard.stripe.com/payments/${esc(b.stripe_payment)}" target="_blank">${esc(b.stripe_payment)}</a>` : ''}
      ${b.promo_code ? `<span>Código</span><b>${esc(b.promo_code)}</b>` : ''}</div>
    ${isBlock ? '' : `<div class="lines">${lines.map(l => `<div class="r"><span>${esc(l.label)}</span><span>${eur(l.amount)}</span></div>`).join('')}<div class="r t"><span>Total</span><span>${eur(b.total)}</span></div></div>`}
    ${isBlock ? '' : depositBlock(b)}
    <form id="bEdit" class="fgrid" style="grid-template-columns:1fr 1fr">
      <label class="span2">Nombre<input name="name" value="${esc(b.name)}"></label>
      ${isBlock ? '' : `<label>Email<input name="email" value="${esc(b.email)}"></label><label>Teléfono<input name="phone" value="${esc(b.phone)}"></label>
      <label>País<input name="country" value="${esc(b.country)}"></label><label>Huéspedes<input name="guests" type="number" min="1" value="${b.guests}"></label>
      <label>Total €<input name="total" inputmode="decimal" value="${toEuros(b.total)}"></label><label class="chk" style="align-self:end"><input type="checkbox" name="paid" ${b.paid ? 'checked' : ''}> Cobrada</label>
      <label class="span2">Comentarios del huésped<textarea name="notes" rows="2">${esc(b.notes)}</textarea></label>`}
      <label class="span2">Nota interna<textarea name="internal_note" rows="2">${esc(b.internal_note)}</textarea></label>
    </form>
    <div class="row-btns">
      <button class="btn primary" id="bSave">Guardar</button>
      ${b.status === 'pending' || b.status === 'expired' ? '<button class="btn" id="bConfirm">Confirmar reserva</button>' : ''}
      ${b.status === 'confirmed' || b.status === 'pending' ? `<button class="btn danger-ghost" id="bCancel">${isBlock ? 'Quitar bloqueo' : 'Cancelar reserva'}</button>` : ''}
      ${!isBlock && b.status === 'confirmed' && b.email && S.mail ? `<button class="btn" id="bMail">${b.mail_sent_at ? 'Reenviar confirmación' : 'Enviar confirmación'}</button>` : ''}
      ${!isBlock && b.status === 'confirmed' && S.invoices && b.total > 0 ? `<button class="btn" id="bInvoice">${b.invoice_no ? 'Factura ' + esc(b.invoice_no) : 'Crear factura'}</button>` : ''}
      ${b.email ? `<a class="btn" href="mailto:${esc(b.email)}?subject=${encodeURIComponent('Tu reserva ' + b.ref)}">Email</a>` : ''}
      ${b.phone ? `<a class="btn" href="https://wa.me/${esc(b.phone.replace(/\D/g, '').replace(/^(?!34)(\d{9})$/, '34$1'))}" target="_blank">WhatsApp</a>` : ''}
    </div>
    ${b.stripe_payment && b.status === 'confirmed' ? '<p class="hint">Si cancelas una reserva pagada, haz el reembolso (total o parcial) desde Stripe con el enlace de arriba.</p>' : ''}
  </div>`;
  const m = $('#modal');
  m.querySelector('[data-close]').onclick = () => m.close();
  const after = () => { m.close(); refresh().then(() => go(currentTab)); };
  $('#bSave').onclick = async () => {
    const f = new FormData($('#bEdit')); const data = Object.fromEntries(f.entries());
    if (!isBlock) data.paid = !!f.get('paid');
    if (await act(api(`/api/admin/bookings/${b.id}`, 'PATCH', data), 'Guardado')) after();
  };
  $('#bConfirm') && ($('#bConfirm').onclick = async () => {
    const notify = !isBlock && !!b.email && S.mail && confirm('¿Enviar al huésped el email de confirmación' + (S.invoices ? ' con su factura' : '') + '?');
    const r = await api(`/api/admin/bookings/${b.id}`, 'PATCH', { status: 'confirmed', notify });
    if (!r.ok) return toast(r.error, true);
    toast(r.mailed ? 'Reserva confirmada y email enviado' : r.mailError ? 'Confirmada, pero el email falló: ' + r.mailError : 'Reserva confirmada', !!r.mailError); after();
  });
  bindDeposit(b, after);
  $('#bMail') && ($('#bMail').onclick = async () => { const bt = $('#bMail'); bt.disabled = true; bt.textContent = 'Enviando…'; if (await act(api(`/api/admin/bookings/${b.id}/email`, 'POST'), 'Email enviado a ' + b.email)) after(); else { bt.disabled = false; bt.textContent = 'Reenviar confirmación'; } });
  $('#bInvoice') && ($('#bInvoice').onclick = async () => { const w = window.open('', '_blank'); const r = await api(`/api/admin/bookings/${b.id}/invoice`, 'POST'); if (!r.ok) { w && w.close(); return toast(r.error, true); } if (w) w.location = r.url; else location.href = r.url; });
  $('#bCancel') && ($('#bCancel').onclick = async () => { if (!confirm(isBlock ? '¿Quitar este bloqueo?' : '¿Cancelar esta reserva? Las fechas quedarán libres.')) return; if (await act(api(`/api/admin/bookings/${b.id}`, 'PATCH', { status: 'cancelled' }), isBlock ? 'Bloqueo quitado' : 'Reserva cancelada')) after(); });
  m.showModal();
}

$('#newBooking').onclick = () => bookingForm({});
function bookingForm({ checkin = '', checkout = '' }) {
  $('#modalBody').innerHTML = `<div class="drawer-h"><h3>Nueva reserva manual</h3><button class="x" data-close>×</button></div>
  <div class="drawer-b"><p class="hint" style="margin-top:0">Para reservas por teléfono, WhatsApp o clientes que repiten. Bloquea las fechas en la web y en Airbnb/Booking (vía iCal).</p>
  <form id="nb" class="fgrid" style="grid-template-columns:1fr 1fr;margin-top:14px">
    <label>Entrada<input type="date" name="checkin" value="${checkin}" required></label><label>Salida<input type="date" name="checkout" value="${checkout}" required></label>
    <label class="span2">Nombre<input name="name" required></label>
    <label>Teléfono<input name="phone"></label><label>Email<input name="email" type="email"></label>
    <label>Huéspedes<input name="guests" type="number" min="1" value="2"></label>
    <label>Total € (vacío = precio de tarifa)<input name="total" inputmode="decimal" placeholder=""></label>
    <label class="chk"><input type="checkbox" name="paid"> Ya cobrada</label>
    <label class="span2">Nota interna<textarea name="internal_note" rows="2"></textarea></label>
  </form>
  <div id="nbQuote"></div>
  <div class="row-btns"><button class="btn primary" id="nbSave">Crear reserva</button></div></div>`;
  const m = $('#modal'); m.querySelector('[data-close]').onclick = () => m.close();
  const f = $('#nb');
  const preview = async () => {
    if (!f.checkin.value || !f.checkout.value) return;
    const q = await api('/api/admin/quote', 'POST', { unit: unitId, checkin: f.checkin.value, checkout: f.checkout.value, guests: f.guests.value });
    $('#nbQuote').innerHTML = q.ok ? `<div class="lines">${q.lines.map(l => `<div class="r"><span>${esc(l.label)}</span><span>${eur(l.amount)}</span></div>`).join('')}<div class="r t"><span>Precio de tarifa</span><span>${eur(q.total)}</span></div></div>` : `<div class="warn">${esc(q.error)}</div>`;
    f.total.placeholder = q.ok ? toEuros(q.total) : '';
  };
  f.checkin.onchange = f.checkout.onchange = f.guests.onchange = preview; preview();
  $('#nbSave').onclick = async () => {
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f).entries()); d.paid = !!f.paid.checked; d.unit_id = unitId; d.source = 'manual';
    let r = await api('/api/admin/bookings', 'POST', d);
    if (!r.ok && /no está disponible/.test(r.error || '') && confirm('Hay noches ocupadas en esas fechas. ¿Crear la reserva igualmente?')) r = await api('/api/admin/bookings', 'POST', { ...d, force: true });
    if (!r.ok) return toast(r.error, true);
    toast('Reserva creada ' + r.ref); m.close(); refresh().then(() => go(currentTab));
  };
  m.showModal();
}

// ---------- TARIFAS ----------
function renderDeposit() {
  const u = unit(); const f = $('#depositForm');
  f.deposit_amount.value = u.deposit_amount ? toEuros(u.deposit_amount) : '';
  f.deposit_when.value = u.deposit_when || 'never';
  f.deposit_min_nights.value = u.deposit_min_nights || '';
  f.deposit_release_days.value = u.deposit_release_days ?? 2;
  let ranges = []; try { ranges = JSON.parse(u.deposit_dates || '[]'); } catch {}
  const toggle = () => { $('#depositRules').hidden = f.deposit_when.value !== 'rules'; };
  f.deposit_when.onchange = toggle; toggle();
  const draw = () => {
    $('#depRanges').innerHTML = ranges.map((r, i) => `<div class="tier"><input type="date" style="width:160px" data-ri="${i}" data-k="from" value="${r.from || ''}"> → <input type="date" style="width:160px" data-ri="${i}" data-k="to" value="${r.to || ''}"> <input data-ri="${i}" data-k="label" value="${esc(r.label || '')}" placeholder="Nochevieja, Semana Santa…" style="width:180px"> <button type="button" class="linkbtn" data-rrm="${i}">Quitar</button></div>`).join('') || '<p class="muted small">Sin fechas</p>';
    $$('#depRanges input').forEach(inp => inp.oninput = () => { ranges[inp.dataset.ri][inp.dataset.k] = inp.value; });
    $$('[data-rrm]').forEach(b => b.onclick = () => { ranges.splice(Number(b.dataset.rrm), 1); draw(); });
  };
  $('#addDepRange').onclick = () => { ranges.push({ from: '', to: '', label: '' }); draw(); };
  draw();
  f._ranges = () => ranges;
}
$('#depositForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const d = { deposit_amount: f.deposit_amount.value, deposit_when: f.deposit_when.value, deposit_min_nights: f.deposit_min_nights.value, deposit_release_days: f.deposit_release_days.value, deposit_dates: f._ranges ? f._ranges().filter(r => r.from && r.to) : [] };
  if (d.deposit_when !== 'never' && !(Number(String(d.deposit_amount).replace(',', '.')) > 0)) return toast('Pon el importe de la fianza', true);
  if (d.deposit_when === 'rules' && !(Number(d.deposit_min_nights) > 0) && !d.deposit_dates.length) return toast('Indica las noches mínimas o alguna fecha', true);
  if (d.deposit_when !== 'never' && !S.stripe) toast('Ojo: la fianza necesita Stripe conectado', true);
  if (await act(api('/api/admin/units/' + unitId, 'PUT', d), 'Fianza guardada')) { await refresh(); renderTarifas(); }
};

function renderTarifas() {
  renderExtras(); renderDeposit();
  const u = unit(); const f = $('#unitForm');
  for (const k of ['base_price', 'weekend_price', 'cleaning_fee', 'extra_guest_fee']) f[k].value = toEuros(u[k]);
  for (const k of ['min_nights', 'max_nights', 'max_guests', 'base_guests', 'min_advance_days', 'max_advance_days', 'last_minute_days', 'early_bird_days']) f[k].value = u[k] ?? '';
  for (const k of ['weekly_discount', 'monthly_discount', 'last_minute_discount', 'early_bird_discount']) f[k].value = u[k] ? String(u[k]).replace('.', ',') : '';
  let tiers = []; try { tiers = JSON.parse(u.stay_discounts || '[]'); } catch {}
  const drawTiers = () => {
    $('#tiers').innerHTML = tiers.map((t, i) => `<div class="tier">A partir de <input type="number" min="1" data-ti="${i}" data-k="nights" value="${t.nights}"> noches → <input inputmode="decimal" data-ti="${i}" data-k="pct" value="${String(t.pct).replace('.', ',')}"> % menos <button type="button" class="linkbtn" data-trm="${i}">Quitar</button></div>`).join('') || '<p class="muted small">Sin tramos</p>';
    $$('#tiers input').forEach(inp => inp.oninput = () => { tiers[inp.dataset.ti][inp.dataset.k] = inp.value; });
    $$('[data-trm]').forEach(b => b.onclick = () => { tiers.splice(Number(b.dataset.trm), 1); drawTiers(); });
  };
  $('#addTier').onclick = () => { tiers.push({ nights: 2, pct: 10 }); drawTiers(); };
  drawTiers();
  f._tiers = () => tiers;
  daysPick(f.querySelector('[data-name="weekend_nights"]'), String(u.weekend_nights).split(',').filter(Boolean));
  daysPick(f.querySelector('[data-name="checkin_days"]'), String(u.checkin_days).split(',').filter(x => x !== ''));
  const seasons = S.seasons.filter(s => s.unit_id === u.id);
  $('#seasonTable').innerHTML = '<thead><tr><th>Temporada</th><th>Desde</th><th>Hasta (última noche)</th><th class="num">Noche</th><th class="num">Finde</th><th class="num">Mín.</th><th class="num">Prioridad</th><th></th></tr></thead><tbody>'
    + (seasons.length ? seasons.map(s => `<tr class="click" data-sid="${s.id}"><td><span class="swatch" style="background:${esc(s.color)}"></span><b>${esc(s.name)}</b></td><td>${fd(s.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${fd(s.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td class="num">${eur(s.price)}</td><td class="num">${s.weekend_price != null ? eur(s.weekend_price) : '—'}</td><td class="num">${s.min_nights ?? '—'}</td><td class="num">${s.priority}</td><td class="num"><button class="linkbtn" data-del="${s.id}">Borrar</button></td></tr>`).join('')
      : '<tr><td colspan="8" class="empty">Sin temporadas: se usa siempre el precio base</td></tr>') + '</tbody>';
  $$('#seasonTable [data-sid]').forEach(tr => tr.onclick = e => { if (!e.target.dataset.del) seasonForm(seasons.find(s => s.id === Number(tr.dataset.sid))); });
  $$('#seasonTable [data-del]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar esta temporada?') && await act(api('/api/admin/seasons/' + b.dataset.del, 'DELETE'), 'Temporada borrada')) { await refresh(); renderTarifas(); } });
  if (!$('#simIn').value) { $('#simIn').value = addDays(S.today, 14); $('#simOut').value = addDays(S.today, 16); }
}
$('#unitForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target; const d = Object.fromEntries(new FormData(f).entries());
  d.weekend_nights = daysValue(f.querySelector('[data-name="weekend_nights"]')).join(',');
  d.checkin_days = daysValue(f.querySelector('[data-name="checkin_days"]')).join(',');
  d.stay_discounts = f._tiers ? f._tiers() : [];
  if (!d.checkin_days) return toast('Elige al menos un día de entrada', true);
  if (Number(d.base_guests) > Number(d.max_guests)) return toast('Los huéspedes incluidos no pueden superar el máximo', true);
  if (await act(api('/api/admin/units/' + unitId, 'PUT', d), 'Tarifas guardadas')) { await refresh(); renderTarifas(); }
};
$('#addSeason').onclick = () => seasonForm(null);
function seasonForm(s) {
  const COLORS = ['#c2410c', '#b45309', '#15803d', '#0e7490', '#7c3aed', '#be185d', '#4b5563'];
  $('#modalBody').innerHTML = `<div class="drawer-h"><h3>${s ? 'Editar temporada' : 'Nueva temporada'}</h3><button class="x" data-close>×</button></div>
  <div class="drawer-b"><form id="sf" class="fgrid" style="grid-template-columns:1fr 1fr">
    <label class="span2">Nombre<input name="name" required value="${esc(s?.name || '')}" placeholder="Verano, Semana Santa, Navidad…"></label>
    <label>Primera noche<input type="date" name="start_date" required value="${s?.start_date || ''}"></label>
    <label>Última noche<input type="date" name="end_date" required value="${s?.end_date || ''}"></label>
    <label>Precio noche €<input name="price" inputmode="decimal" required value="${s ? toEuros(s.price) : ''}"></label>
    <label>Precio finde € (opcional)<input name="weekend_price" inputmode="decimal" value="${s?.weekend_price != null ? toEuros(s.weekend_price) : ''}"></label>
    <label>Estancia mínima (opcional)<input name="min_nights" type="number" min="1" value="${s?.min_nights ?? ''}"></label>
    <label>Prioridad (si se solapan, gana la mayor)<input name="priority" type="number" value="${s?.priority ?? 0}"></label>
    <div class="field span2"><span>Color</span><div class="days-pick" id="colors">${COLORS.map(c => `<button type="button" data-c="${c}" class="${(s?.color || COLORS[0]) === c ? 'on' : ''}" style="background:${c};border-color:${c};width:34px;height:28px"></button>`).join('')}</div></div>
  </form><div class="row-btns"><button class="btn primary" id="sfSave">Guardar</button></div></div>`;
  const m = $('#modal'); m.querySelector('[data-close]').onclick = () => m.close();
  let color = s?.color || COLORS[0];
  $('#colors').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; $$('#colors button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#sfSave').onclick = async () => {
    const f = $('#sf'); if (!f.reportValidity()) return;
    const d = { ...Object.fromEntries(new FormData(f).entries()), color, unit_id: unitId };
    if (await act(api(s ? '/api/admin/seasons/' + s.id : '/api/admin/seasons', s ? 'PUT' : 'POST', d), 'Temporada guardada')) { m.close(); await refresh(); renderTarifas(); }
  };
  m.showModal();
}
$('#simGo').onclick = async () => {
  const q = await api('/api/admin/quote', 'POST', { unit: unitId, checkin: $('#simIn').value, checkout: $('#simOut').value, guests: $('#simGuests').value, promo: $('#simPromo').value });
  $('#simOutBox').innerHTML = q.ok
    ? `<div class="lines">${q.lines.map(l => `<div class="r"><span>${esc(l.label)}</span><span>${eur(l.amount)}</span></div>`).join('')}<div class="r t"><span>Total que verá el cliente</span><span>${eur(q.total)}</span></div></div>
       ${q.promoError ? `<div class="warn">${esc(q.promoError)}</div>` : ''}<p class="muted small">Noche a noche: ${q.nightly.map(n => `${fd(n.date)} ${eurShort(n.price)} (${esc(n.source)})`).join(' · ')}</p>`
    : `<div class="warn">${esc(q.error)}</div>`;
};

// ---------- CÓDIGOS ----------
function renderPromos() {
  $('#promoTable').innerHTML = '<thead><tr><th>Código</th><th>Descuento</th><th>Fechas de entrada</th><th class="num">Mín. noches</th><th class="num">Usos</th><th>Nota</th><th>Acumulable</th><th>Activo</th><th></th></tr></thead><tbody>'
    + (S.promos.length ? S.promos.map(p => `<tr><td><b>${esc(p.code)}</b></td><td>${p.kind === 'pct' ? p.value + ' %' : eur(p.value)}</td><td>${p.valid_from || p.valid_to ? `${p.valid_from ? fd(p.valid_from) : '…'} – ${p.valid_to ? fd(p.valid_to) : '…'}` : 'Siempre'}</td>
      <td class="num">${p.min_nights || '—'}</td><td class="num">${p.uses}${p.max_uses ? ' / ' + p.max_uses : ''}</td><td class="muted">${esc(p.note)}${p.no_weekend ? '<br>Solo domingo a viernes' : ''}${p.blackout ? `<br>Excepto: ${esc(p.blackout_label || p.blackout)}` : ''}</td>
      <td><label class="chk" title="Si lo desmarcas, al usar el código se quitan los demás descuentos"><input type="checkbox" data-stack="${p.id}" ${p.exclusive ? '' : 'checked'}></label></td>
      <td><label class="chk"><input type="checkbox" data-toggle="${p.id}" ${p.active ? 'checked' : ''}></label></td><td class="num"><button class="linkbtn" data-pedit="${p.id}">Editar</button> · <button class="linkbtn" data-pdel="${p.id}">Borrar</button></td></tr>`).join('')
      : '<tr><td colspan="9" class="empty">Aún no hay códigos</td></tr>') + '</tbody>';
  $$('[data-toggle]').forEach(c => c.onchange = async () => { await act(api('/api/admin/promos/' + c.dataset.toggle, 'PATCH', { active: c.checked }), c.checked ? 'Código activado' : 'Código desactivado'); await refresh(); });
  $$('[data-stack]').forEach(c => c.onchange = async () => { await act(api('/api/admin/promos/' + c.dataset.stack, 'PATCH', { exclusive: !c.checked }), c.checked ? 'Se suma a los demás descuentos' : 'Ahora sustituye a los demás descuentos'); await refresh(); });
  $$('[data-pdel]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar el código?') && await act(api('/api/admin/promos/' + b.dataset.pdel, 'DELETE'), 'Código borrado')) { if (promoEditing === Number(b.dataset.pdel)) promoEdit(null); await refresh(); renderPromos(); } });
  $$('[data-pedit]').forEach(b => b.onclick = () => promoEdit(Number(b.dataset.pedit)));
}
let promoEditing = null;
function promoEdit(id) {
  const f = $('#promoForm'); const p = S.promos.find(x => x.id === id);
  promoEditing = p ? id : null;
  f.reset();
  if (p) {
    f.code.value = p.code; f.kind.value = p.kind; f.value.value = p.kind === 'fixed' ? toEuros(p.value) : p.value;
    f.min_nights.value = p.min_nights || 0; f.valid_from.value = p.valid_from || ''; f.valid_to.value = p.valid_to || '';
    f.max_uses.value = p.max_uses || ''; f.note.value = p.note || ''; f.blackout.value = p.blackout || '';
    f.exclusive.checked = !!p.exclusive; f.no_weekend.checked = !!p.no_weekend;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#promoTitle').textContent = p ? `Editar código ${p.code}` : 'Nuevo código promocional';
  $('#promoSave').textContent = p ? 'Guardar cambios' : 'Crear código';
  $('#promoCancel').hidden = !p;
}
$('#promoCancel').onclick = () => promoEdit(null);
$('#promoForm').onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  const id = promoEditing;
  if (await act(api(id ? '/api/admin/promos/' + id : '/api/admin/promos', id ? 'PUT' : 'POST', d), id ? 'Código guardado' : 'Código creado')) { promoEdit(null); await refresh(); renderPromos(); }
};

// ---------- EXTRAS ----------
let extraEditing = null;
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function renderExtras() {
  const list = S.extras || [];
  const f = $('#extraForm');
  const x = list.find(e => e.id === extraEditing) || null;
  if (!x) extraEditing = null;
  f.name.value = x?.name || ''; f.price.value = x ? toEuros(x.price) : ''; f.description.value = x?.description || '';
  f.per.value = x?.per || 'stay'; f.max_qty.value = x?.max_qty || 1; f.needs_free_checkout.checked = !!x?.needs_free_checkout;
  daysPick($('[data-name="extra_checkout_days"]'), String(x?.checkout_days || '').split(',').filter(v => v !== ''));
  $('#extraTitle').textContent = x ? `Editar extra: ${x.name}` : 'Extras al reservar';
  $('#extraSave').textContent = x ? 'Guardar cambios' : 'Añadir extra';
  $('#extraCancel').hidden = !x;
  const cond = e => [String(e.checkout_days || '').split(',').filter(v => v !== '').map(d => 'salida en ' + DAY_NAMES[d]).join(' o '), e.needs_free_checkout ? 'si nadie entra ese día' : ''].filter(Boolean).join(', ') || 'Siempre';
  $('#extraTable').innerHTML = '<thead><tr><th>Extra</th><th class="num">Precio</th><th>Cuándo se ofrece</th><th>Activo</th><th></th></tr></thead><tbody>'
    + (list.length ? list.map(e => `<tr><td><b>${esc(e.name)}</b>${e.description ? `<br><span class="muted small">${esc(e.description)}</span>` : ''}</td>
      <td class="num">${eur(e.price)}${e.per === 'night' ? ' / noche' : ''}${e.max_qty > 1 ? `<br><span class="muted small">hasta ${e.max_qty}</span>` : ''}</td>
      <td class="muted">${esc(cond(e))}</td>
      <td><label class="chk"><input type="checkbox" data-xtoggle="${e.id}" ${e.active ? 'checked' : ''}></label></td>
      <td class="num"><button type="button" class="linkbtn" data-xedit="${e.id}">Editar</button> · <button type="button" class="linkbtn" data-xdel="${e.id}">Borrar</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Aún no hay extras</td></tr>') + '</tbody>';
  $$('[data-xtoggle]').forEach(c => c.onchange = async () => { await act(api('/api/admin/extras/' + c.dataset.xtoggle, 'PATCH', { active: c.checked }), c.checked ? 'Extra activado' : 'Extra desactivado'); await refresh(); renderExtras(); });
  $$('[data-xedit]').forEach(b => b.onclick = () => { extraEditing = Number(b.dataset.xedit); renderExtras(); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $$('[data-xdel]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar este extra?') && await act(api('/api/admin/extras/' + b.dataset.xdel, 'DELETE'), 'Extra borrado')) { if (extraEditing === Number(b.dataset.xdel)) extraEditing = null; await refresh(); renderExtras(); } });
}
$('#extraCancel').onclick = () => { extraEditing = null; renderExtras(); };
$('#extraForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const cur = (S.extras || []).find(x => x.id === extraEditing);
  const d = { name: f.name.value, price: f.price.value, description: f.description.value, per: f.per.value, max_qty: f.max_qty.value,
    checkout_days: daysValue($('[data-name="extra_checkout_days"]')), needs_free_checkout: f.needs_free_checkout.checked, active: cur ? !!cur.active : true };
  if (await act(api(extraEditing ? '/api/admin/extras/' + extraEditing : '/api/admin/extras', extraEditing ? 'PUT' : 'POST', d), extraEditing ? 'Extra guardado' : 'Extra añadido')) { extraEditing = null; await refresh(); renderExtras(); }
};


// ---------- EMAILS ----------
function renderMail() {
  const c = $('#mailCard');
  if (S.mail) {
    c.innerHTML = `<div class="card-h"><h2>Emails a los huéspedes</h2></div>
      <div class="stripe-ok">✓ Activados${S.mailUser ? ' · se envían desde ' + esc(S.mailUser) : ''}</div>
      <p class="hint">Cada reserva pagada envía al huésped la confirmación con el resumen${S.invoices ? ' y su factura' : ''}, y a ti un aviso. Desde cada reserva puedes reenviarla.</p>
      ${S.mailUser && S.mailUser !== 'Resend' ? '<div class="row-btns"><button class="btn primary" id="mailSample">Enviarme un email de muestra</button><button class="btn" id="mailChange">Cambiar cuenta</button><button class="btn danger-ghost" id="mailOff">Desactivar</button></div>' : ''}
      <div id="mailFormBox"></div>`;
    $('#mailChange') && ($('#mailChange').onclick = mailForm);
    $('#mailSample') && ($('#mailSample').onclick = async () => { const bt = $('#mailSample'); bt.disabled = true; bt.textContent = 'Enviando…'; const r = await api('/api/admin/mail/sample', 'POST', {}); bt.disabled = false; bt.textContent = 'Enviarme un email de muestra'; r.ok ? toast('Muestra enviada a ' + r.to) : toast(r.error, true); });
    $('#mailOff') && ($('#mailOff').onclick = async () => { if (confirm('¿Desactivar los emails? Los huéspedes dejarán de recibir la confirmación.') && await act(api('/api/admin/mail', 'DELETE'), 'Emails desactivados')) { await refresh(); renderPagos(); } });
  } else {
    c.innerHTML = `<div class="card-h"><h2>Emails a los huéspedes</h2></div><div id="mailFormBox"></div>`;
    mailForm();
  }
}
function mailForm() {
  $('#mailFormBox').innerHTML = `<ol class="steps">
      <li>Entra en <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Contraseñas de aplicación de Google</a> con la cuenta desde la que quieres enviar (p. ej. ${esc(S.settings.email || 'tu Gmail')}). <span class="muted">Si te dice que no está disponible, activa antes la <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">verificación en dos pasos</a>.</span></li>
      <li>Escribe un nombre, por ejemplo <b>Web reservas</b>, y pulsa <b>Crear</b>. Google te enseña una clave de 16 letras.</li>
      <li>Pega aquí tu Gmail y esa clave y pulsa <b>Activar</b>. Te llegará un email de prueba.</li>
    </ol>
    <div class="fgrid" style="grid-template-columns:1fr 1fr auto;align-items:end">
      <label>Gmail<input id="mailUser" type="email" value="${esc(S.settings.email || '')}" autocomplete="off"></label>
      <label>Contraseña de aplicación<input id="mailPass" placeholder="abcd efgh ijkl mnop" autocomplete="off" spellcheck="false"></label>
      <button class="btn primary" id="mailGo" type="button">Activar</button>
    </div>`;
  $('#mailGo').onclick = async () => {
    const btn = $('#mailGo'); btn.disabled = true; btn.textContent = 'Probando…';
    const r = await api('/api/admin/mail', 'POST', { user: $('#mailUser').value, pass: $('#mailPass').value });
    btn.disabled = false; btn.textContent = 'Activar';
    if (!r.ok) return toast(r.error, true);
    toast('Emails activados. Revisa tu bandeja: te he enviado una prueba'); await refresh(); renderPagos();
  };
}
function renderBilling() {
  const f = $('#billingForm');
  for (const k of ['legal_name', 'legal_id', 'invoice_prefix', 'fiscal_address', 'vat_rate', 'vat_note']) f[k].value = S.settings[k] ?? '';
}
$('#billingForm').onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  if (await act(api('/api/admin/settings', 'PUT', d), 'Datos de facturación guardados')) { await refresh(); renderPagos(); }
};

// ---------- SINCRONIZACIÓN ----------
function renderSync() {
  const u = unit();
  $('#exportUrl').value = `${S.origin}/ical/${u.ical_token}.ics`;
  const feeds = S.feeds.filter(f => f.unit_id === u.id);
  $('#feedTable').innerHTML = '<thead><tr><th>Canal</th><th>Enlace</th><th>Última sincronización</th><th>Estado</th><th></th></tr></thead><tbody>'
    + (feeds.length ? feeds.map(f => `<tr><td><b>${esc(f.name)}</b></td><td class="muted small" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.url)}</td><td>${esc(f.last_sync || '—')}</td>
      <td><span class="tag ${String(f.last_status).startsWith('OK') ? 't-confirmed' : 't-pending'}">${esc(f.last_status || 'Pendiente')}</span></td><td class="num"><button type="button" class="linkbtn" data-fdel="${f.id}">Quitar</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">Sin calendarios conectados</td></tr>') + '</tbody>';
  $$('[data-fdel]').forEach(b => b.onclick = async () => { if (confirm('¿Quitar este calendario? Sus bloqueos desaparecerán.') && await act(api('/api/admin/feeds/' + b.dataset.fdel, 'DELETE'), 'Calendario quitado')) { await refresh(); renderSync(); } });
}
$('#copyExport').onclick = () => { navigator.clipboard.writeText($('#exportUrl').value); toast('Enlace copiado'); };
$('#feedForm').onsubmit = async e => {
  e.preventDefault();
  const d = { ...Object.fromEntries(new FormData(e.target).entries()), unit_id: unitId };
  const r = await act(api('/api/admin/feeds', 'POST', d));
  if (r) { toast(r.sync.ok ? `Conectado · ${r.sync.count} bloqueos importados` : 'Añadido, pero falló: ' + r.sync.error, !r.sync.ok); e.target.url.value = ''; await refresh(); renderSync(); }
};
$('#syncNow').onclick = async () => {
  const r = await act(api('/api/admin/feeds/sync', 'POST', {}));
  if (r) { const bad = r.results.filter(x => !x.ok); toast(bad.length ? `Errores en: ${bad.map(x => x.name).join(', ')}` : 'Sincronizado', !!bad.length); await refresh(); renderSync(); }
};

// ---------- WEB Y FOTOS ----------
function renderWeb() {
  const f = $('#settingsForm');
  for (const el of f.elements) if (el.name && S.settings[el.name] != null) el.value = S.settings[el.name];
  const u = unit(); const uf = $('#unitInfoForm');
  for (const k of ['name', 'bedrooms', 'beds', 'bathrooms', 'summary', 'description']) uf[k].value = u[k] ?? '';
  uf.active.value = String(u.active);
  renderPhotos();
}
const PHOTO_CATS = [['salon', 'Salón'], ['cocina', 'Cocina'], ['dormitorio', 'Dormitorio'], ['bano', 'Baño'], ['exterior', 'Alberca y patio'], ['', 'Sin sección']];
function renderPhotos() {
  const hero = Number(S.settings.hero_photo) || S.photos[0]?.id;
  const heroP = S.photos.find(p => p.id === hero);
  const opts = sel => PHOTO_CATS.map(([k, l]) => `<option value="${k}" ${k === (sel || '') ? 'selected' : ''}>${l}</option>`).join('');
  const card = (p, i, n) => `<div class="photo ${p.id === hero ? 'hero' : ''}" data-pid="${p.id}"><img src="/foto/${p.id}" alt="" loading="lazy">
    ${p.id === hero ? '<span class="idx">★ Portada</span>' : ''}
    <div class="acts"><button type="button" data-mv="-1" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} title="Mover antes">◀</button><button type="button" data-mv="1" data-id="${p.id}" ${i === n - 1 ? 'disabled' : ''} title="Mover después">▶</button><span class="sp"></span><button type="button" data-hero="${p.id}" class="${p.id === hero ? 'on' : ''}" title="Usar de portada">★</button><button type="button" data-cap="${p.id}" title="Pie de foto">✎</button><button type="button" data-pdel="${p.id}" title="Borrar">🗑</button></div>
    <select data-catsel="${p.id}" title="Sección">${opts(p.category)}</select>
    ${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ''}</div>`;
  let html = heroP ? `<div class="ph-group hero-pick"><h3>Portada de la web</h3><div class="hero-prev"><img src="/foto/${heroP.id}" alt=""><p class="muted small">Pulsa ★ en cualquier foto de abajo para cambiarla.</p></div></div>` : '';
  for (const [k, l] of PHOTO_CATS) {
    const list = S.photos.filter(p => (p.category || '') === k);
    if (!list.length) continue;
    html += `<div class="ph-group"><h3>${l} <span class="muted small">${list.length}</span></h3><div class="photos">${list.map((p, i) => card(p, i, list.length)).join('')}</div></div>`;
  }
  $('#photos').innerHTML = html || '<p class="muted">Aún no hay fotos. La web muestra un fondo de color hasta que subas alguna.</p>';
  const reload = async () => { await refresh(); renderPhotos(); };
  $$('[data-hero]').forEach(b => b.onclick = async () => { await act(api('/api/admin/settings', 'PUT', { hero_photo: b.dataset.hero }), 'Portada cambiada'); await reload(); });
  $$('#photos [data-pdel]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar esta foto?') && await act(api('/api/admin/photos/' + b.dataset.pdel, 'DELETE'), 'Foto borrada')) await reload(); });
  $$('[data-cap]').forEach(b => b.onclick = async () => {
    const p = S.photos.find(x => x.id === Number(b.dataset.cap));
    const cap = prompt('Pie de foto (se ve al ampliarla)', p.caption || ''); if (cap === null) return;
    await act(api('/api/admin/photos/' + p.id, 'PATCH', { caption: cap }), 'Guardado'); await reload();
  });
  $$('[data-catsel]').forEach(s => s.onchange = async () => { await act(api('/api/admin/photos/' + s.dataset.catsel, 'PATCH', { category: s.value }), 'Sección cambiada'); await reload(); });
  $$('[data-mv]').forEach(b => b.onclick = async () => {
    const p = S.photos.find(x => x.id === Number(b.dataset.id));
    const same = S.photos.filter(x => (x.category || '') === (p.category || ''));
    const j = same.indexOf(p) + Number(b.dataset.mv);
    if (j < 0 || j >= same.length) return;
    const other = same[j];
    const ids = S.photos.map(x => x.id);
    const a = ids.indexOf(p.id), c = ids.indexOf(other.id);
    [ids[a], ids[c]] = [ids[c], ids[a]];
    await api('/api/admin/photos/order', 'PUT', { ids }); await reload();
  });
}
function resizeImage(file, max = 2000, quality = .84) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = quality, data = c.toDataURL('image/jpeg', q);
      while (data.length > 2200000 && q > .5) { q -= .08; data = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src); res(data);
    };
    img.onerror = () => rej(new Error('No se pudo leer ' + file.name));
    img.src = URL.createObjectURL(file);
  });
}
$('#photoInput').onchange = async e => {
  const files = [...e.target.files]; let n = 0;
  for (const file of files) {
    $('#uploadStatus').textContent = `Subiendo ${++n} de ${files.length}…`;
    try {
      const data = await resizeImage(file);
      const r = await api('/api/admin/photos', 'POST', { data });
      if (!r.ok) toast(r.error, true);
    } catch (err) { toast(err.message, true); }
  }
  $('#uploadStatus').textContent = ''; e.target.value = '';
  await refresh(); renderPhotos(); toast('Fotos subidas');
};
$('#settingsForm').onsubmit = async e => {
  e.preventDefault();
  if (await act(api('/api/admin/settings', 'PUT', Object.fromEntries(new FormData(e.target).entries())), 'Textos guardados')) await refresh();
};
$('#unitInfoForm').onsubmit = async e => {
  e.preventDefault();
  if (await act(api('/api/admin/units/' + unitId, 'PUT', Object.fromEntries(new FormData(e.target).entries())), 'Alojamiento guardado')) { await refresh(); renderWeb(); }
};
$('#addUnit').onclick = async () => {
  const name = prompt('Nombre de la nueva suite', 'Suite 2'); if (!name) return;
  const r = await act(api('/api/admin/units', 'POST', { name, base_price: toEuros(unit().base_price) }), 'Suite creada');
  if (r) { unitId = r.id; localStorage.setItem('ts_unit', unitId); await refresh(); go('tarifas'); }
};

// ---------- VISITAS ----------
let vDaysRange = 7;
$('#vRange').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; vDaysRange = Number(b.dataset.d); $$('#vRange button').forEach(x => x.classList.toggle('on', x === b)); renderVisits(); };
const SECTION_NAMES = { alojamiento: 'El alojamiento', galeria: 'Galería', incluye: 'Qué incluye', reservar: 'Calendario y precios', ubicacion: 'Ubicación', faq: 'Preguntas frecuentes' };
const CAT_NAMES = { todas: 'Todas', salon: 'Salón', cocina: 'Cocina', dormitorio: 'Dormitorio', bano: 'Baño', exterior: 'Alberca y patio' };
function hbars(rows, empty = 'Aún no hay datos') {
  if (!rows.length) return `<p class="muted">${empty}</p>`;
  const max = Math.max(...rows.map(r => r.n), 1);
  return rows.map(r => `<div class="hbar"><span class="lbl" title="${esc(r.name)}">${esc(r.name)}</span><span class="trk"><i style="width:${(r.n / max) * 100}%"></i></span><b>${r.n}</b></div>`).join('');
}
function fmtTime(sec) { if (!sec) return '—'; const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`; }
async function renderVisits() {
  const d = await api('/api/admin/analytics?days=' + vDaysRange);
  if (!d.ok) return;
  const f = d.funnel, t = d.totals;
  const conv = f.visita ? ((f.reservas / f.visita) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %' : '—';
  $('#vKpis').innerHTML = [['Visitantes', t.visitors || 0], ['Visitas', t.sessions || 0], ['Tiempo medio', fmtTime(d.avgTime)], ['Reservas web', `${f.reservas}${f.reservas ? ' · ' + eur(f.ingresos) : ''}`]]
    .map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join('');
  // por día (rellena días sin visitas)
  const map = new Map(d.perDay.map(x => [x.day, x.v]));
  const daysList = []; for (let x = d.from; x <= S.today; x = addDays(x, 1)) daysList.push(x);
  const shown = daysList.length > 60 ? null : daysList;
  if (shown) {
    const max = Math.max(1, ...shown.map(x => map.get(x) || 0));
    const every = Math.ceil(shown.length / 15);
    $('#vDays').innerHTML = `<div class="daybars">${shown.map(x => { const v = map.get(x) || 0; return `<div title="${fd(x, { weekday: 'short', day: 'numeric', month: 'short' })}: ${v}">${v ? `<em>${v}</em>` : ''}<i style="height:${(v / max) * 100}%"></i></div>`; }).join('')}</div>
      <div class="daylabels">${shown.map((x, i) => `<span>${i % every === 0 ? Number(x.slice(8)) + '/' + Number(x.slice(5, 7)) : ''}</span>`).join('')}</div>`;
  } else {
    const byMonth = {}; for (const r of d.perDay) byMonth[r.day.slice(0, 7)] = (byMonth[r.day.slice(0, 7)] || 0) + r.v;
    $('#vDays').innerHTML = hbars(Object.entries(byMonth).map(([m, n]) => ({ name: fd(m + '-01', { month: 'long', year: 'numeric' }), n })));
  }
  const pct = (a, b) => b ? `<small>${Math.round((a / b) * 100)} %</small>` : '';
  const steps = [['Entran en la web', f.visita], ['Llegan al calendario', f.calendario], ['Eligen fechas y ven el precio', f.fechas], ['Pulsan «Reservar»', f.reservar], ['Van a pagar', f.pago], ['Reservas confirmadas', f.reservas]];
  const fmax = Math.max(1, f.visita);
  $('#vFunnel').innerHTML = `<div class="funnel">${steps.map(([k, v], i) => `<div class="hbar"><span class="lbl">${k}</span><span class="trk"><i style="width:${(v / fmax) * 100}%"></i></span><b>${v}${i ? pct(v, f.visita) : ''}</b></div>`).join('')}</div><p class="hint">Conversión: <b>${conv}</b> de las visitas acaban en reserva directa.</p>`;
  $('#vSources').innerHTML = hbars(d.sources);
  $('#vSections').innerHTML = hbars(d.sections.map(x => ({ name: SECTION_NAMES[x.detail] || x.detail, n: x.n }))) +
    (d.gallery.length ? `<h3>Pestañas de la galería</h3>${hbars(d.gallery.map(x => ({ name: CAT_NAMES[x.detail] || x.detail, n: x.n })))}` : '');
  $('#vMonths').innerHTML = hbars(d.months.map(x => ({ name: fd(x.m + '-01', { month: 'long', year: 'numeric' }), n: x.n })), 'Nadie ha elegido fechas todavía') +
    (d.nights.length ? `<h3>Noches que miran</h3>${hbars(d.nights.map(x => ({ name: `${x.nights} ${x.nights === 1 ? 'noche' : 'noches'}`, n: x.n })))}` : '');
  $('#vPhotos').innerHTML = d.photos.length ? `<div class="vphotos">${d.photos.map(p => `<figure title="${esc(p.caption || '')}"><img src="${esc(p.src || '/foto/' + p.detail)}" loading="lazy" alt=""><figcaption>${p.n} veces</figcaption></figure>`).join('')}</div>` : '<p class="muted">Nadie ha ampliado fotos todavía</p>';
  $('#vFaqs').innerHTML = hbars(d.faqs.map(x => ({ name: x.detail, n: x.n })), 'Nadie ha abierto preguntas todavía');
  $('#vGeo').innerHTML = hbars(d.countries) + (d.devices.length ? `<h3>Dispositivo</h3>${hbars(d.devices.map(x => ({ name: x.device[0].toUpperCase() + x.device.slice(1), n: x.n })))}` : '');
  $('#vContact').innerHTML = hbars(d.contact.map(x => ({ name: x.type === 'whatsapp' ? `WhatsApp (${x.detail})` : x.detail[0].toUpperCase() + x.detail.slice(1), n: x.n })), 'Nadie ha contactado desde la web todavía');
}

// ---------- CLIENTES Y EMAILS ----------
const SRC_NAMES = { web: 'Se apuntó en la web', reserva: 'Al reservar', 'huésped': 'Huésped' };
async function renderClientes() {
  const d = await api('/api/admin/marketing');
  if (!d.ok) return;
  $('#mkWarn').innerHTML = S.mail === false ? '<div class="warn">Los emails no están activados: configúralos en «Pagos y cuenta» para que esto funcione.</div>' : '';
  const sub = d.subscribers;
  $('#mkKpis').innerHTML = [
    ['En tu lista', sub.active || 0],
    ['Reservas a medias avisadas', d.recoverySent],
    ['Recuperadas', `${d.recovered.n}${d.recovered.n ? ' · ' + eur(d.recovered.total) : ''}`],
    ['Códigos para volver usados', `${d.returnCodes.used} de ${d.returnCodes.n}`],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join('');
  const f = $('#mkAuto');
  f.mk_recovery.checked = S.settings.mk_recovery !== '0';
  f.mk_poststay.checked = S.settings.mk_poststay !== '0';
  f.mk_return_pct.value = S.settings.mk_return_pct ?? '10';
  f.review_url.value = S.settings.review_url || '';
  $('#mkCount').textContent = `Se enviará a ${sub.active || 0} ${sub.active === 1 ? 'persona' : 'personas'}`;
  $('#mkCamps').innerHTML = d.campaigns.length ? `<h3>Enviados</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Asunto</th><th class="num">Enviados</th></tr></thead><tbody>${d.campaigns.map(c => `<tr><td>${esc(c.created_at.slice(0, 16))}</td><td>${esc(c.subject)}</td><td class="num">${c.sent}${c.failed ? ` <span class="muted">(${c.failed} fallidos)</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  $('#mkList').innerHTML = '<thead><tr><th>Email</th><th>Nombre</th><th>Origen</th><th>Alta</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (d.list.length ? d.list.map(x => `<tr><td>${esc(x.email)}</td><td>${esc(x.name || '')}</td><td>${esc(SRC_NAMES[x.source] || x.source)}</td><td>${esc((x.created_at || '').slice(0, 10))}</td>
      <td>${x.unsubscribed_at ? '<span class="tag t-cancelled">De baja</span>' : '<span class="tag t-confirmed">Activo</span>'}</td><td class="num"><button class="linkbtn" data-sdel="${x.id}">Borrar</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Aún no hay nadie. Se irá llenando con quien se apunte en la web, al reservar y con tus huéspedes.</td></tr>') + '</tbody>';
  $$('[data-sdel]').forEach(b => b.onclick = async () => { if (confirm('¿Borrar este contacto de la lista?') && await act(api('/api/admin/subscribers/' + b.dataset.sdel, 'DELETE'), 'Borrado')) renderClientes(); });
}
$('#mkAuto').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const d = { mk_recovery: f.mk_recovery.checked ? '1' : '0', mk_poststay: f.mk_poststay.checked ? '1' : '0', mk_return_pct: String(Math.max(0, Math.min(50, parseInt(f.mk_return_pct.value || '0', 10)))), review_url: f.review_url.value.trim() };
  if (await act(api('/api/admin/settings', 'PUT', d), 'Guardado')) { await refresh(); renderClientes(); }
};
async function campaign(test) {
  const f = $('#mkCampaign');
  if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f).entries());
  if (!test && !confirm(`¿Enviar «${d.subject}» a toda tu lista? No se puede deshacer.`)) return;
  const btn = test ? $('#mkTest') : $('#mkSend'); const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Enviando…';
  const r = await api('/api/admin/campaign', 'POST', { ...d, test });
  btn.disabled = false; btn.textContent = label;
  if (!r.ok) return toast(r.error || 'No se pudo enviar', true);
  toast(test ? 'Prueba enviada a tu email' : `Enviado a ${r.sent} ${r.sent === 1 ? 'persona' : 'personas'}${r.failed ? ` (${r.failed} fallidos)` : ''}`);
  if (!test) { f.reset(); renderClientes(); }
}
$('#mkTest').onclick = () => campaign(true);
$('#mkSend').onclick = () => campaign(false);

// ---------- PAGOS ----------
function renderPagos() {
  const c = $('#stripeCard');
  if (S.stripe) {
    c.innerHTML = `<div class="card-h"><h2>Pagos con tarjeta (Stripe)</h2></div>
      <div class="stripe-ok">✓ Conectado${S.stripeAccount ? ' a ' + esc(S.stripeAccount) : ''} · ${S.stripeMode === 'live' ? 'MODO REAL: se cobra de verdad' : 'modo de prueba'}</div>
      ${S.stripeMode === 'test' ? '<p class="hint">Haz una reserva de prueba en tu web con la tarjeta <b>4242 4242 4242 4242</b>, caducidad cualquiera futura y CVC cualquiera. Cuando funcione, conecta la clave real (sk_live_…) para empezar a cobrar.</p>' : ''}
      ${S.stripeFromPanel ? `<div class="row-btns"><button class="btn" id="stripeChange">${S.stripeMode === 'test' ? 'Pasar a modo real (clave live)' : 'Cambiar clave'}</button><button class="btn danger-ghost" id="stripeOff">Desconectar</button></div>` : '<p class="hint">Configurado desde Cloudflare.</p>'}
      <div id="stripeFormBox"></div>`;
    $('#stripeChange') && ($('#stripeChange').onclick = () => stripeForm(S.stripeMode === 'test' ? 'live' : S.stripeMode));
    $('#stripeOff') && ($('#stripeOff').onclick = async () => { if (confirm('¿Desconectar Stripe? Las reservas pasarán a ser solicitudes sin pago.') && await act(api('/api/admin/stripe', 'DELETE'), 'Stripe desconectado')) { await refresh(); renderPagos(); } });
  } else {
    c.innerHTML = `<div class="card-h"><h2>Pagos con tarjeta (Stripe)</h2></div><div id="stripeFormBox"></div>`;
    stripeForm('test');
  }
  $('#pwForm').hidden = S.passwordInCloudflare;
  renderMail(); renderBilling();
}
function stripeForm(mode) {
  const live = mode === 'live';
  $('#stripeFormBox').innerHTML = `<ol class="steps">
      <li>Abre <a href="https://dashboard.stripe.com/${live ? '' : 'test/'}apikeys" target="_blank" rel="noopener">tus claves de Stripe${live ? '' : ' (modo de prueba)'}</a> e inicia sesión.</li>
      <li>En <b>Clave secreta</b> pulsa <b>Revelar</b> y cópiala (empieza por <b>${live ? 'sk_live_' : 'sk_test_'}</b>).</li>
      <li>Pégala aquí abajo y pulsa <b>Conectar</b>. Yo configuro el resto (el aviso de pagos se crea solo).</li>
    </ol>
    <div class="copy"><input id="stripeKey" placeholder="${live ? 'sk_live_…' : 'sk_test_…'}" autocomplete="off" spellcheck="false"><button class="btn primary" id="stripeGo">Conectar</button></div>`;
  $('#stripeGo').onclick = async () => {
    const btn = $('#stripeGo'); btn.disabled = true; btn.textContent = 'Conectando…';
    const r = await api('/api/admin/stripe', 'POST', { key: $('#stripeKey').value });
    btn.disabled = false; btn.textContent = 'Conectar';
    if (!r.ok) return toast(r.error, true);
    toast(`Stripe conectado (${r.mode === 'live' ? 'modo real' : 'modo prueba'})`); await refresh(); renderPagos();
  };
}
$('#pwForm').onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  if (d.password !== d.password2) return toast('Las contraseñas nuevas no coinciden', true);
  if (await act(api('/api/admin/password', 'POST', d), 'Contraseña cambiada')) e.target.reset();
};

boot();
