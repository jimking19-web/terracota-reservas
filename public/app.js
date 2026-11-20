// Terracota Suites · web pública
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c, dec) => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec ?? (c % 100 ? 2 : 0), maximumFractionDigits: 2 });
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const fdate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(s + 'T00:00:00Z').toLocaleDateString('es-ES', { ...opts, timeZone: 'UTC' });

const ICONS = {
  cafe: '<path d="M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M7 2v3M11 2v3M15 2v3"/>',
  agua: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  vino: '<path d="M8 2h8l-.5 6a3.5 3.5 0 0 1-7 0zM12 12v8M8 21h8"/>',
  alberca: '<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 14c2 0 2-1.5 4-1.5S8 14 10 14s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 12V5a2 2 0 0 1 4 0M16 12V5a2 2 0 0 0-4 0"/>',
  vela: '<path d="M9 10h6v11H9zM12 3c1.5 2 1.5 3.5 0 5-1.5-1.5-1.5-3 0-5z"/>',
  limpieza: '<path d="M3 21l7-7M14 4l6 6-7 7-6-6zM5 3v4M3 5h4M19 15v4M17 17h4"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  aire: '<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  parking: '<path d="M4 3h16v18H4zM9 17V7h4a3 3 0 0 1 0 6H9"/>',
  cocina: '<path d="M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 0-3 3-3 7h3v11"/>',
  lena: '<path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2.5 3 2.5-1-2-.5-4.5 0-7zM5 21l14-3M5 18l14 3"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
};
function iconFor(text) {
  const t = text.toLowerCase();
  const k = t.includes('café') || t.includes('cafe') || t.includes('infusi') ? 'cafe' : t.includes('agua') ? 'agua' : t.includes('vino') ? 'vino'
    : t.includes('alberca') || t.includes('piscina') ? 'alberca' : t.includes('vela') ? 'vela' : t.includes('limpi') ? 'limpieza' : t.includes('wifi') ? 'wifi'
    : t.includes('aire') || t.includes('clima') ? 'aire' : t.includes('aparca') || t.includes('parking') ? 'parking' : t.includes('cocina') ? 'cocina' : t.includes('leña') || t.includes('chimenea') ? 'lena' : 'check';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
}

const state = { site: null, unit: null, cal: new Map(), calFrom: null, monthOffset: 0, checkin: null, checkout: null, guests: 2, promo: '', extras: {}, quote: null, today: null, picking: 'checkin' };

// ---------- estadísticas (sin cookies ni almacenamiento) ----------
const SID = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const T0 = Date.now();
const sentOnce = new Set();
function track(t, d, once = false) {
  try {
    const key = t + '|' + (typeof d === 'object' ? '' : d);
    if (once) { if (sentOnce.has(key)) return; sentOnce.add(key); }
    const body = JSON.stringify({ t, d, s: SID });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'text/plain' })))) fetch('/api/t', { method: 'POST', body, keepalive: true });
  } catch {}
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return res.json();
}

// ---------- contenido ----------
function fillSettings(s) {
  $$('[data-s]').forEach(el => {
    const k = el.dataset.s;
    if (k === 'site_name_short') el.textContent = (s.site_name || 'Terracota').split(' ')[0];
    else if (s[k] != null) el.textContent = s[k];
  });
  document.title = `${s.site_name} · ${s.address}`;
  const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
  $('#description').innerHTML = String(s.description || '').split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join('');
  const welcome = Number(String(s.welcome_amount || '0').replace(',', '.'));
  if (welcome > 0) {
    const w = eur(Math.round(welcome * 100));
    $('#newsTitle').textContent = `Llévate ${w} de descuento`;
    $('#newsText').textContent = `Apúntate y te enviamos por email un código de ${w} para tu primera reserva directa. Después, solo algún aviso de fechas libres y ofertas.`;
  }
  fillGiftCard(s);
  const giftN = parseInt(s.gift_min_nights || '0', 10);
  if (giftN > 0 && s.gift_text) {
    $('#gift').hidden = false;
    $('#giftTitle').textContent = `Regalo en estancias de ${giftN} noches o más`;
    $('#giftText').textContent = `${s.gift_text}, incluidas sin coste.`;
  }
  $('#amenities').innerHTML = lines(s.amenities).map(a => `<li class="reveal">${iconFor(a)}${esc(a)}</li>`).join('');
  $('#rules').innerHTML = lines(s.house_rules).map(r => `<li>${esc(r)}</li>`).join('');
  $('#highlights').innerHTML = lines(s.highlights).map(h => { const [a, b] = h.split('|'); return `<div><b>${esc(a)}</b><span>${esc(b || '')}</span></div>`; }).join('');
  const badges = [];
  if (s.reviews_rating) badges.push(`★ ${s.reviews_rating} en Google${s.reviews_count ? ` (${s.reviews_count} reseñas)` : ''}`);
  if (s.superhost === '1') badges.push('★ Superanfitriones en Airbnb');
  badges.push('Reserva directa sin comisiones');
  $('#heroBadges').innerHTML = badges.map(b => `<span class="badge">${esc(b)}</span>`).join('');
  const c = [];
  if (s.phone) c.push(`<li>Tel. <a href="tel:${esc(s.phone.replace(/\s/g, ''))}">${esc(s.phone)}</a></li>`);
  if (s.whatsapp) c.push(`<li><a href="https://wa.me/${esc(s.whatsapp.replace(/\D/g, '').replace(/^(?=[67]\d{8}$)/, '34'))}" target="_blank" rel="noopener">WhatsApp</a></li>`);
  if (s.email) c.push(`<li><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`);
  if (s.instagram) c.push(`<li><a href="https://instagram.com/${esc(s.instagram.replace('@', ''))}" target="_blank" rel="noopener">@${esc(s.instagram.replace('@', ''))}</a></li>`);
  $('#contact').innerHTML = c.join('') || '<li>Escríbenos desde el formulario de reserva</li>';
  const waNum = (s.whatsapp || '').replace(/\D/g, '').replace(/^(?=[67]\d{8}$)/, '34');
  if (waNum) {
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(`Hola, tengo una consulta sobre ${s.site_name || 'Terracota Suites'}`)}`;
    for (const id of ['#waFloat', '#faqWa']) { $(id).href = waUrl; $(id).hidden = false; }
  }
  const faqs = lines(s.faq).map(l => l.split('|')).filter(([q, a]) => q && a);
  $('#faq').hidden = !faqs.length;
  $('#faqList').innerHTML = faqs.map(([q, ...a]) => `<details><summary>${esc(q)}</summary><p>${esc(a.join('|'))}</p></details>`).join('');
  // Opiniones de Google
  const revs = lines(s.reviews).map(l => l.split('|').map(x => x.trim())).filter(([n, t]) => n && t);
  if (revs.length || s.reviews_rating) {
    $('#opiniones').hidden = false;
    const gUrl = s.google_maps_url || '#';
    for (const id of ['#gBadge', '#gAll']) $(id).href = gUrl;
    $('#gAll').hidden = !s.google_maps_url;
    $('#gWrite').href = s.review_url || gUrl; $('#gWrite').hidden = !s.review_url;
    $('#gRating').textContent = s.reviews_rating || '';
    $('#gCount').textContent = s.reviews_count ? `${s.reviews_count} reseñas en Google` : 'en Google';
    $('#reviewGrid').innerHTML = revs.map(([n, t, when]) => `<article class="review"><span class="g-stars">★★★★★</span><blockquote>«${esc(t)}»</blockquote>
      <footer><span class="av">${esc(n.charAt(0).toUpperCase())}</span><span><b>${esc(n)}</b>Reseña de Google${when ? ' · ' + esc(when) : ''}</span></footer></article>`).join('');
  }
  const legal = [s.license && `Nº registro turístico: ${s.license}`, s.legal_name, s.legal_id].filter(Boolean);
  $('#legal').textContent = legal.join(' · ');
  $('#year').textContent = new Date().getFullYear();
  const mapQ = s.street ? `${s.street}, ${s.map_query || s.address}` : (s.map_query || s.address);
  $('#map').innerHTML = `<iframe loading="lazy" title="Mapa" src="https://www.google.com/maps?q=${encodeURIComponent(mapQ)}&z=${s.street ? 16 : 13}&output=embed"></iframe>`;
  if (s.street) { $('#street').hidden = false; $('#streetText').textContent = s.street; $('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapQ)}`; }
}

// La galería empieza por el dormitorio; el patio y la alberca tienen su propia sección («El patio»)
const PHOTO_CATS = [['dormitorio', 'Dormitorio'], ['bano', 'Baño'], ['salon', 'Salón'], ['cocina', 'Cocina']];
const PATIO_CAT = 'exterior';
const PATIO_DEFAULT = {
  eyebrow: 'El patio y la alberca',
  title: 'Un lugar para perderse',
  text: 'El corazón de Terracota Suites. Un patio único, levantado entre arcos de piedra, con una alberca privada con cascada, ducha exterior y rincones de sombra pensados para no hacer nada.\n\nCada detalle de la decoración está elegido a mano: barro, piedra, fibras naturales y una luz cálida que lo cambia todo al caer la tarde. Un espacio solo para vosotros, para bañaros, leer, tomar un vino al atardecer o simplemente dejar pasar el tiempo.',
  points: 'Arcos de piedra\nAlberca privada con cascada\nDucha exterior\nPorche con sofá\nTumbonas al sol',
};
function fillPatio(gen) {
  const s = state.site.settings;
  const list = gen.filter(p => p.category === PATIO_CAT);
  state.patioPhotos = list;
  $('#patio').hidden = !list.length;
  if (!list.length) return;
  $('#patioEyebrow').textContent = s.patio_eyebrow || PATIO_DEFAULT.eyebrow;
  $('#patioTitle').textContent = s.patio_title || PATIO_DEFAULT.title;
  $('#patioBody').innerHTML = String(s.patio_text || PATIO_DEFAULT.text).split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join('');
  $('#patioPoints').innerHTML = String(s.patio_points ?? PATIO_DEFAULT.points).split('\n').map(x => x.trim()).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
  const shown = list.slice(0, 6);
  $('#patioMosaic').innerHTML = shown.map((p, i) => `<button data-pi="${i}" aria-label="Ver foto"><img src="/foto/${p.id}" alt="${esc(p.caption || '')}" loading="lazy">${i === shown.length - 1 && list.length > shown.length ? `<span class="more">+${list.length - shown.length} fotos</span>` : ''}</button>`).join('');
  $('#patioAll').textContent = `Ver las ${list.length} fotos del patio`;
}
function fillPhotos(photos) {
  const gen = photos.filter(p => !p.unit_id || p.unit_id === state.unit.id);
  state.allPhotos = gen;
  const hero = state.site.settings.hero_photo ? Number(state.site.settings.hero_photo) : gen[0]?.id;
  const bg = $('#heroBg');
  if (hero) { bg.style.backgroundImage = `url(/foto/${hero})`; bg.classList.remove('placeholder'); } else bg.classList.add('placeholder');
  const intro = gen.find(p => p.id !== hero) || gen[0];
  $('#introPhoto').innerHTML = intro ? `<img src="/foto/${intro.id}" alt="${esc(intro.caption || state.unit.name)}" loading="lazy">` : '<div class="ph">Terracota</div>';
  fillPatio(gen);
  const gcP = gen.find(p => /suite con bañera/i.test(p.caption || '')) || gen.find(p => p.category === 'dormitorio') || gen[0];
  if (gcP) $('#gcPhoto').innerHTML = `<img src="/foto/${gcP.id}" alt="" loading="lazy">`;
  const cats = PHOTO_CATS.filter(([k]) => gen.some(p => p.category === k));
  const inside = gen.filter(p => p.category !== PATIO_CAT);
  $('#galTabs').innerHTML = cats.length ? [['', 'Todas'], ...cats].map(([k, l]) => `<button type="button" role="tab" data-cat="${k}">${esc(l)} <small>${k ? gen.filter(p => p.category === k).length : inside.length}</small></button>`).join('') : '';
  $('#galTabs').hidden = !cats.length;
  showGallery(state.galCat || '');
  $('#openGallery').hidden = !gen.length;
}
function showGallery(cat) {
  state.galCat = cat;
  const gen = (state.allPhotos || []).filter(p => p.category !== PATIO_CAT);
  // "Todas": por secciones (dormitorio, baño, salón, cocina) y dentro de cada una en el orden del panel
  const rank = k => { const i = PHOTO_CATS.findIndex(c => c[0] === k); return i < 0 ? 99 : i; };
  const list = cat ? gen.filter(p => p.category === cat) : [...gen].sort((a, b) => rank(a.category) - rank(b.category));
  state.photos = list;
  $$('#galTabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.cat === cat)));
  const slots = 5;
  let html = '';
  for (let i = 0; i < slots; i++) {
    const p = list[i];
    html += `<button data-i="${i}" aria-label="Ver foto">${p ? `<img src="/foto/${p.id}" alt="${esc(p.caption || '')}" loading="lazy">` : '<div class="ph"></div>'}${i === slots - 1 && list.length > slots ? `<span class="more">+${list.length - slots} fotos</span>` : ''}</button>`;
  }
  $('#gallery').innerHTML = html;
  $('#gallery').classList.toggle('few', list.length < slots);
}

function fillUnit(u) {
  $('#unitTitle').textContent = u.name;
  const f = [];
  f.push(`Hasta ${u.max_guests} huéspedes`);
  if (u.bedrooms) f.push(`${u.bedrooms} ${u.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}`);
  if (u.beds) f.push(`${u.beds} ${u.beds === 1 ? 'cama' : 'camas'}`);
  if (u.bathrooms) f.push(`${u.bathrooms} ${u.bathrooms === 1 ? 'baño' : 'baños'}`);
  if (u.min_nights > 1) f.push(`Mínimo ${u.min_nights} noches`);
  $('#facts').innerHTML = f.map(x => `<li>${esc(x)}</li>`).join('');
  if (u.description) $('#description').innerHTML = String(u.description).split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join('');
  state.guests = Math.min(state.guests, u.max_guests);
}

// ---------- lightbox ----------
let lbIndex = 0;
function openLightbox(i) {
  if (!state.photos.length) return;
  lbIndex = (i + state.photos.length) % state.photos.length;
  const p = state.photos[lbIndex];
  $('#lbImg').src = `/foto/${p.id}`; $('#lbCap').textContent = p.caption || '';
  track('foto', p.id);
  if (!$('#lightbox').open) $('#lightbox').showModal();
}

// ---------- calendario ----------
async function loadCalendar() {
  const from = state.today.slice(0, 8) + '01';
  const days = Math.min(400, (state.unit.max_advance_days || 365) + 45);
  const r = await api(`/api/calendar?unit=${state.unit.slug}&from=${from}&days=${days}`);
  state.calFrom = from;
  state.cal = new Map(r.days.map(d => [d.d, d]));
  const prices = r.days.filter(d => d.f).map(d => d.p);
  state.minPrice = prices.length ? Math.min(...prices) : state.unit.base_price;
  renderCalendar(); renderSummary();
}

function monthStart(offset) { const d = new Date(state.calFrom + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 10); }

// ¿Se puede salir este día con la entrada elegida?
function canCheckout(d) {
  const ci = state.checkin;
  if (!ci || d <= ci) return false;
  const first = state.cal.get(ci);
  if (diff(ci, d) < (first?.m || 1)) return false;
  for (let x = ci; x < d; x = addDays(x, 1)) { const c = state.cal.get(x); if (!c || !c.f) return false; }
  return true;
}
function firstBlockedAfter(ci) {
  for (let x = ci; ; x = addDays(x, 1)) { const c = state.cal.get(x); if (!c || !c.f) return x; }
}

function renderCalendar() {
  const wrap = $('#calMonths');
  const months = [0, 1].map(i => monthStart(state.monthOffset + i));
  const limit = firstBlockedAfter(state.checkin || state.today);
  let html = '';
  for (const m of months) {
    const d0 = new Date(m + 'T00:00:00Z');
    const t0 = d0.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(' de ', ' ');
    const title = t0.charAt(0).toUpperCase() + t0.slice(1);
    const lead = (d0.getUTCDay() + 6) % 7;
    const dim = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)).getUTCDate();
    html += `<div class="cal-month"><h4>${title}</h4><div class="cal-grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => `<div class="cal-dow">${x}</div>`).join('')}`;
    html += '<div></div>'.repeat(lead);
    for (let i = 1; i <= dim; i++) {
      const d = m.slice(0, 8) + String(i).padStart(2, '0');
      const c = state.cal.get(d);
      const cls = ['day'];
      let enabled = false;
      const past = d < state.today;
      if (past || !c) cls.push('past');
      else if (state.picking === 'checkout' && state.checkin && d > state.checkin) {
        if (canCheckout(d)) { enabled = true; cls.push('free'); if (!c.f) cls.push('checkout-only'); }
        else if (c.f) { cls.push('free'); enabled = !!c.ci; if (!c.ci) cls.push('nocheck'); if (d > limit) cls.push('dim'); }
        else cls.push('busy');
      } else {
        if (c.f) { cls.push('free'); enabled = !!c.ci; if (!c.ci) cls.push('nocheck'); } else cls.push('busy');
      }
      if (d === state.today) cls.push('today');
      if (d === state.checkin) { cls.push('start'); if (state.checkout) cls.push('hasEnd'); enabled = true; }
      if (d === state.checkout) cls.push('end');
      if (state.checkin && state.checkout && d > state.checkin && d < state.checkout) cls.push('inrange');
      const showPrice = c && c.f && !past;
      html += `<button class="${cls.join(' ')}" data-d="${d}" ${enabled ? '' : 'disabled'} title="${c && c.f && c.m > 1 ? `Mín. ${c.m} noches` : ''}"><span class="n">${i}</span><span class="p">${showPrice ? eur(c.p, 0).replace(/\s?€/, '€') : '&nbsp;'}</span></button>`;
    }
    html += '</div></div>';
  }
  wrap.innerHTML = html;
  $('#calPrev').disabled = state.monthOffset <= 0;
  const maxOffset = Math.floor((state.cal.size || 365) / 31) - 1;
  $('#calNext').disabled = state.monthOffset >= maxOffset;
  const c = state.checkin && state.cal.get(state.checkin);
  $('#calHint').textContent = !state.checkin ? 'Selecciona el día de entrada'
    : !state.checkout ? (c?.m > 1 ? `Ahora el día de salida · mínimo ${c.m} noches` : 'Ahora elige el día de salida')
    : `${diff(state.checkin, state.checkout)} noches · ${fdate(state.checkin)} → ${fdate(state.checkout)}`;
}

function pickDay(d) {
  if (state.picking === 'checkout' && state.checkin && canCheckout(d)) {
    state.checkout = d; state.picking = 'checkin';
    track('fechas', `${state.checkin}|${diff(state.checkin, d)}`);
    getQuote();
  } else {
    const c = state.cal.get(d);
    if (!c || !c.f || !c.ci) return;
    state.checkin = d; state.checkout = null; state.quote = null; state.picking = 'checkout';
  }
  renderCalendar(); renderSummary();
}

// ---------- presupuesto ----------
let quoteSeq = 0;
async function getQuote() {
  if (!state.checkin || !state.checkout) return;
  const seq = ++quoteSeq;
  $('#bookBtn').disabled = true; $('#bookBtn').textContent = 'Calculando…';
  const q = await api('/api/quote', { method: 'POST', body: { unit: state.unit.slug, checkin: state.checkin, checkout: state.checkout, guests: state.guests, promo: state.promo, extras: state.extras } });
  if (seq !== quoteSeq) return;
  state.quote = q;
  renderSummary();
}

// ---------- vales regalo ----------
const gc = { nights: 2 };
function fillGiftCard(s) {
  if (s.vouchers_enabled === '0' || !state.site.payments) return;
  gc.price = Math.round(Number(String(s.voucher_price || '180').replace(',', '.')) * 100);
  gc.max = parseInt(s.voucher_max_nights || '7', 10) || 7;
  gc.prices = new Map();
  for (const l of String(s.voucher_prices ?? '').split('\n')) { const [n, p] = l.split('|').map(x => x.trim()); const ni = parseInt(n, 10), pc = Math.round(Number(String(p || '').replace(',', '.')) * 100); if (ni > 0 && pc > 0) gc.prices.set(ni, pc); }
  if (!(gc.price > 0)) return;
  $('#regalo').hidden = false;
  const months = parseInt(s.voucher_months || '12', 10) || 12;
  $('#gcPoints').innerHTML = [`${eur(gc.price, 0)} por noche${s.voucher_includes ? ' · ' + s.voucher_includes.toLowerCase() : ''}`, 'Sin fecha: lo usan cuando quieran', `Válido durante ${months === 12 ? 'un año' : months + ' meses'}`, 'Lo recibes al momento por email, listo para imprimir']
    .map(x => `<li>${esc(x)}</li>`).join('');
  const incl = String(s.voucher_list || '').split('\n').map(x => x.trim()).filter(Boolean);
  $('#gcIncl').hidden = !incl.length;
  $('#gcList').innerHTML = incl.map(x => `<li>${iconFor(x)}${esc(x)}</li>`).join('');
  drawGiftCard();
}
function giftPrice(n) {
  if (gc.prices?.has(n)) return gc.prices.get(n);
  const keys = [...(gc.prices?.keys() || [])].filter(k => k < n);
  if (keys.length) { const k = Math.max(...keys); return Math.round(gc.prices.get(k) / k * n); }
  return gc.price * n;
}
function drawGiftCard() {
  const total = giftPrice(gc.nights), full = gc.price * gc.nights;
  $('#gcNights').textContent = gc.nights;
  $('#gcTotal').innerHTML = (total < full ? `<s style="font-size:22px;color:var(--muted);font-weight:500;margin-right:8px">${eur(full)}</s>` : '') + eur(total);
  $('#gcPer').textContent = `${gc.nights} ${gc.nights === 1 ? 'noche' : 'noches'} · ${eur(Math.round(total / gc.nights))}/noche`;
  $('#gcBuy').textContent = `Comprar vale de ${eur(total)}`;
}
function bindGiftCard() {
  $$('[data-gn]').forEach(b => b.onclick = () => { gc.nights = Math.max(1, Math.min(gc.max || 7, gc.nights + Number(b.dataset.gn))); drawGiftCard(); });
  $$('#gcForm input[name=send_to]').forEach(r => r.onchange = () => { const rec = $('#gcForm input[name=send_to]:checked').value === 'recipient'; $('#gcForm input[name=recipient_email]').hidden = !rec; });
  $('#gcForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('#gcError');
    const d = Object.fromEntries(f.entries()); d.accept = !!f.get('accept'); d.nights = gc.nights;
    err.textContent = '';
    if (!d.buyer_name || d.buyer_name.trim().length < 2) return (err.textContent = 'Indica tu nombre');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.buyer_email || '')) return (err.textContent = 'Revisa tu email');
    if (d.send_to === 'recipient' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.recipient_email || '')) return (err.textContent = 'Revisa el email de quien lo recibe');
    if (!d.accept) return (err.textContent = 'Marca la casilla de condiciones');
    const btn = $('#gcBuy'); btn.disabled = true; btn.textContent = 'Preparando el pago…';
    const r = await api('/api/voucher', { method: 'POST', body: d });
    if (r.ok && r.redirect) { track('pago', giftPrice(gc.nights)); location.href = r.redirect; return; }
    btn.disabled = false; drawGiftCard(); err.textContent = r.error || 'No se pudo iniciar el pago';
  });
  if (new URLSearchParams(location.search).get('vale') === 'cancelado') $('#gcError').textContent = 'El pago del vale se canceló. Puedes intentarlo de nuevo.';
}

function giftLine(nights) {
  const s = state.site.settings, n = parseInt(s.gift_min_nights || '0', 10);
  if (!n || !s.gift_text) return '';
  return nights >= n ? `<div class="sum-gift">🎁 Incluido: ${esc(s.gift_text.charAt(0).toLowerCase() + s.gift_text.slice(1))}</div>`
    : `<div class="sum-gift hint">🎁 Quédate ${n} noches y te regalamos ${esc(s.gift_text.charAt(0).toLowerCase() + s.gift_text.slice(1))}</div>`;
}
function renderSummary() {
  const u = state.unit, q = state.quote;
  $('#sumFrom').textContent = q?.ok ? eur(q.total) : `desde ${eur(state.minPrice ?? u.base_price, 0)}`;
  $('#sumFromLabel').textContent = q?.ok ? `· ${q.nights} noches` : '/ noche';
  $('#mbPrice').textContent = $('#sumFrom').textContent;
  $('#mbSub').textContent = q?.ok ? `${fdate(q.checkin, { day: 'numeric', month: 'short' })} – ${fdate(q.checkout, { day: 'numeric', month: 'short' })}` : 'por noche';
  $('#sumIn').textContent = state.checkin ? fdate(state.checkin) : 'Añadir';
  $('#sumOut').textContent = state.checkout ? fdate(state.checkout) : 'Añadir';
  $('#sbIn').textContent = state.checkin ? fdate(state.checkin) : 'Añadir fecha';
  $('#sbOut').textContent = state.checkout ? fdate(state.checkout) : 'Añadir fecha';
  $('#sumGuests').textContent = $('#sbGuests').textContent = state.guests;
  const btn = $('#bookBtn');
  $('#sumError').textContent = '';
  if (q && !q.ok) { $('#sumError').textContent = q.error; }
  const pm = $('#promoMsg');
  pm.className = 'promo-msg';
  pm.textContent = '';
  if (q?.ok && state.promo) { if (q.promo) { pm.textContent = q.promo.startsWith('REGALO-') ? `Vale regalo ${q.promo} aplicado` : `Código ${q.promo} aplicado`; pm.classList.add('ok'); } else if (q.promoError) { pm.textContent = q.promoError; pm.classList.add('err'); } }
  renderExtras(q);
  if (q?.ok) {
    $('#sumLines').innerHTML = q.lines.map(l => `<div class="row ${l.type}"><span>${esc(l.label)}</span><span>${eur(l.amount, 2)}</span></div>`).join('')
      + `<div class="row total"><span>Total</span><span>${eur(q.total, 2)}</span></div>`
      + giftLine(q.nights)
      + (q.deposit > 0 ? `<div class="deposit-note"><b>Fianza ${eur(q.deposit)}</b> · no se cobra: se retiene en tu tarjeta el día antes de llegar y se libera automáticamente tras la salida.</div>` : '')
      + (q.nightly.length > 1 ? `<details><summary>Precio por noche</summary><ul>${q.nightly.map(n => `<li>${fdate(n.date, { day: 'numeric', month: 'short' })} · ${eur(n.price)}</li>`).join('')}</ul></details>` : '');
    btn.disabled = false; btn.textContent = 'Reservar';
  } else {
    $('#sumLines').innerHTML = '';
    btn.disabled = true;
    btn.textContent = !state.checkin ? 'Selecciona fechas' : !state.checkout ? 'Selecciona la salida' : 'Fechas no disponibles';
  }
}

function renderExtras(q) {
  const box = $('#sumExtras');
  const list = q?.ok ? (q.extras || []) : [];
  box.hidden = !list.length;
  if (!list.length) { box.innerHTML = ''; return; }
  const price = x => `${eur(x.price, x.price % 100 ? 2 : 0)}${x.per === 'night' ? ' / noche' : ''}`;
  box.innerHTML = '<h4>Añade a tu estancia</h4>' + list.map(x => `<div class="extra">
      <div class="extra-t"><b>${esc(x.name)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}<span class="extra-p">${price(x)}</span></div>
      ${x.max_qty > 1
        ? `<div class="stepper sm"><button type="button" data-x="${x.id}" data-d="-1" aria-label="Quitar">−</button><b>${x.qty}</b><button type="button" data-x="${x.id}" data-d="1" aria-label="Añadir">+</button></div>`
        : `<label class="switch"><input type="checkbox" data-x="${x.id}" ${x.qty ? 'checked' : ''}><span></span></label>`}
    </div>`).join('');
  box.querySelectorAll('[data-x]').forEach(el => {
    const ev = el.type === 'checkbox' ? 'change' : 'click';
    el.addEventListener(ev, () => {
      const x = list.find(i => i.id === Number(el.dataset.x));
      const cur = Number(state.extras[x.id] || 0);
      const next = el.type === 'checkbox' ? (el.checked ? 1 : 0) : Math.max(0, Math.min(x.max_qty, cur + Number(el.dataset.d)));
      if (next) state.extras[x.id] = next; else delete state.extras[x.id];
      getQuote();
    });
  });
}

// ---------- reserva ----------
function openGuestForm() {
  const q = state.quote; if (!q?.ok) return;
  track('reservar', q.total);
  $('#trip').innerHTML = `<div><b>${fdate(q.checkin)} → ${fdate(q.checkout)}</b><br>${q.nights} noches · ${q.guests} huéspedes</div><div><b>${eur(q.total, 2)}</b><br><span class="muted">total</span></div>`;
  $('#payBtn').textContent = state.site.payments ? `Pagar ${eur(q.total, 2)}` : 'Enviar solicitud de reserva';
  $('#trip').insertAdjacentHTML('beforeend', q.deposit > 0 ? `<div class="deposit-note full">+ fianza de ${eur(q.deposit)} retenida (no cobrada) en tu tarjeta el día antes de la llegada</div>` : '');
  $('.secure').hidden = !state.site.payments;
  $('#formError').textContent = '';
  $('#guestModal').showModal();
}

async function submitBooking(e) {
  e.preventDefault();
  const f = new FormData($('#guestForm'));
  const data = Object.fromEntries(f.entries());
  data.accept = !!f.get('accept');
  data.marketing = !!f.get('marketing');
  const err = $('#formError');
  if (!data.name || data.name.trim().length < 3) return (err.textContent = 'Indica tu nombre y apellidos');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || '')) return (err.textContent = 'Revisa el email');
  if ((data.phone || '').replace(/\D/g, '').length < 6) return (err.textContent = 'Indica un teléfono de contacto');
  if (!data.accept) return (err.textContent = 'Debes aceptar las condiciones');
  const btn = $('#payBtn'); const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Procesando…'; err.textContent = '';
  const r = await api('/api/book', { method: 'POST', body: { ...data, unit: state.unit.slug, checkin: state.checkin, checkout: state.checkout, guests: state.guests, promo: state.promo, extras: state.extras, expectedTotal: state.quote.total } });
  if (r.ok && r.redirect) { track('pago', state.quote.total); location.href = r.redirect; return; }
  btn.disabled = false; btn.textContent = label;
  err.textContent = r.error || 'No se pudo completar la reserva';
  if (r.quote) { state.quote = r.quote; renderSummary(); openGuestForm(); }
  if (/reservar|disponible/.test(r.error || '')) loadCalendar();
}

// ---------- eventos ----------
function setGuests(delta) {
  state.guests = Math.max(1, Math.min(state.unit.max_guests, state.guests + delta));
  renderSummary();
  if (state.checkin && state.checkout) getQuote();
}
function goToCalendar(which) {
  if (which === 'checkout' && state.checkin) state.picking = 'checkout';
  else if (which === 'checkin') state.picking = 'checkin';
  renderCalendar();
  $('#reservar').scrollIntoView({ behavior: 'smooth' });
}

function bind() {
  $('#calMonths').addEventListener('click', e => { const b = e.target.closest('.day'); if (b && !b.disabled) pickDay(b.dataset.d); });
  $('#calPrev').onclick = () => { state.monthOffset = Math.max(0, state.monthOffset - 1); renderCalendar(); };
  $('#calNext').onclick = () => { state.monthOffset++; renderCalendar(); };
  $('#calClear').onclick = () => { state.checkin = state.checkout = state.quote = null; state.picking = 'checkin'; renderCalendar(); renderSummary(); };
  $$('[data-g]').forEach(b => b.onclick = () => setGuests(Number(b.dataset.g)));
  $$('[data-open]').forEach(b => b.onclick = () => goToCalendar(b.dataset.open));
  $('#sbGo').onclick = () => goToCalendar('checkin');
  $('#promoToggle').onclick = () => { $('#promoRow').hidden = !$('#promoRow').hidden; $('#promoInput').focus(); };
  const applyPromo = () => { state.promo = $('#promoInput').value.trim().toUpperCase(); if (state.promo) track('codigo', state.promo); if (state.checkin && state.checkout) getQuote(); else { $('#promoMsg').textContent = 'Elige fechas para aplicar el código'; } };
  $('#promoApply').onclick = applyPromo;
  $('#promoInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } };
  $('#bookBtn').onclick = openGuestForm;
  $('#guestForm').addEventListener('submit', submitBooking);
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('#gallery').onclick = e => { const b = e.target.closest('button'); if (b && state.photos[Number(b.dataset.i)]) openLightbox(Number(b.dataset.i)); };
  $('#openGallery').onclick = () => { showGallery(state.galCat || ''); openLightbox(0); };
  $('#patioMosaic').onclick = e => { const b = e.target.closest('[data-pi]'); if (!b) return; state.photos = state.patioPhotos; openLightbox(Number(b.dataset.pi)); track('galeria', 'patio'); };
  $('#patioAll').onclick = () => { state.photos = state.patioPhotos; openLightbox(0); track('galeria', 'patio'); };
  $('#lightbox').addEventListener('close', () => { if (state.photos === state.patioPhotos) showGallery(state.galCat || ''); });
  $('#galTabs').onclick = e => { const b = e.target.closest('button'); if (b) { showGallery(b.dataset.cat); track('galeria', b.dataset.cat || 'todas'); } };
  $('#lbPrev').onclick = () => openLightbox(lbIndex - 1);
  $('#lbNext').onclick = () => openLightbox(lbIndex + 1);
  $('#lightbox').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') openLightbox(lbIndex - 1); if (e.key === 'ArrowRight') openLightbox(lbIndex + 1); });
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('#lightbox').close(); });

  // Estadísticas: secciones vistas, WhatsApp, contacto, preguntas y tiempo en la web
  const secIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) track('seccion', e.target.id, true); }), { threshold: .35 });
  ['alojamiento', 'galeria', 'patio', 'incluye', 'reservar', 'ubicacion', 'faq', 'regalo'].forEach(id => { const el = document.getElementById(id); if (el) secIO.observe(el); });
  document.addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    const h = a.getAttribute('href') || '';
    if (h.includes('wa.me')) track('whatsapp', a.id === 'waFloat' ? 'botón flotante' : a.id === 'faqWa' ? 'preguntas' : 'contacto');
    else if (h.startsWith('tel:')) track('contacto', 'teléfono');
    else if (h.startsWith('mailto:')) track('contacto', 'email');
    else if (h.includes('instagram.com')) track('contacto', 'instagram');
    else if (a.id === 'directions') track('contacto', 'cómo llegar');
  }, true);
  $('#faqList').addEventListener('toggle', e => { if (e.target.open) track('faq', e.target.querySelector('summary')?.textContent || '', true); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') track('salida', Math.round((Date.now() - T0) / 1000)); });

  bindGiftCard();
  $('#newsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), msg = $('#newsMsg');
    msg.className = 'news-msg';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.get('email') || '')) { msg.textContent = 'Revisa el email'; msg.classList.add('err'); return; }
    if (!f.get('consent')) { msg.textContent = 'Marca la casilla para poder escribirte'; msg.classList.add('err'); return; }
    const r = await api('/api/subscribe', { method: 'POST', body: { email: f.get('email'), consent: true, website: f.get('website') } });
    if (r.ok) { e.target.reset(); msg.textContent = r.message || '¡Listo! Te avisaremos de fechas libres y ofertas.'; msg.classList.add('ok'); track('contacto', 'lista de ofertas'); }
    else { msg.textContent = r.error || 'No se pudo guardar'; msg.classList.add('err'); }
  });

  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('solid', scrollY > 60);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const vis = new Map();
  const mbio = new IntersectionObserver(es => { es.forEach(e => vis.set(e.target, e.isIntersecting)); $('#mobileBar').classList.toggle('hide', [...vis.values()].some(Boolean)); }, { threshold: .1 });
  mbio.observe($('#reservar')); mbio.observe($('#searchbar'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  $$('.reveal, .section .display, .amenities li').forEach(el => { el.classList.add('reveal'); io.observe(el); });
}

function renderUnitsPicker() {
  const units = state.site.units;
  const el = $('#unitsPicker');
  if (units.length < 2) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = units.map(u => `<button data-u="${u.slug}" class="${u.slug === state.unit.slug ? 'on' : ''}"><b>${esc(u.name)}</b><small>Hasta ${u.max_guests} huéspedes · desde ${eur(u.base_price, 0)}</small></button>`).join('');
  el.onclick = e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    state.unit = units.find(u => u.slug === b.dataset.u);
    state.checkin = state.checkout = state.quote = null; state.picking = 'checkin'; state.monthOffset = 0;
    history.replaceState(null, '', `?suite=${state.unit.slug}#reservar`);
    renderUnitsPicker(); fillUnit(state.unit); fillPhotos(state.site.photos); loadCalendar();
  };
}

async function init() {
  { const p = new URLSearchParams(location.search); track('visita', { ref: document.referrer, utm: p.get('utm_source') || p.get('ref') || '', lang: navigator.language }); }
  const site = await api('/api/site');
  state.site = site; state.today = site.today;
  const wanted = new URLSearchParams(location.search).get('suite');
  state.unit = site.units.find(u => u.slug === wanted) || site.units[0];
  if (!state.unit) { document.body.innerHTML = '<p style="padding:40px">Web en preparación.</p>'; return; }
  fillSettings(site.settings);
  fillUnit(state.unit);
  fillPhotos(site.photos);
  renderUnitsPicker();
  bind();
  renderSummary();
  // JSON-LD para Google
  const s = site.settings;
  const ld = { '@context': 'https://schema.org', '@type': 'LodgingBusiness', name: s.site_name, description: s.intro, address: { '@type': 'PostalAddress', addressLocality: 'Bullas', addressRegion: 'Murcia', addressCountry: 'ES' },
    telephone: s.phone || undefined, email: s.email || undefined, url: location.origin, image: site.photos.slice(0, 5).map(p => `${location.origin}/foto/${p.id}`), checkinTime: s.checkin_time, checkoutTime: s.checkout_time };
  const sc = document.createElement('script'); sc.type = 'application/ld+json'; sc.textContent = JSON.stringify(ld); document.head.appendChild(sc);
  await loadCalendar();
  // Enlace con fechas (p. ej. desde el email de «reserva a medias»): ?entrada=AAAA-MM-DD&salida=AAAA-MM-DD&huespedes=2
  const qp = new URLSearchParams(location.search);
  const ci = qp.get('entrada'), co = qp.get('salida');
  if (ci && co && state.cal.get(ci)?.ci) {
    state.guests = Math.max(1, Math.min(state.unit.max_guests, parseInt(qp.get('huespedes') || state.guests, 10) || state.guests));
    state.checkin = ci; state.picking = 'checkout';
    const m0 = new Date(state.calFrom + 'T00:00:00Z'), m1 = new Date(ci + 'T00:00:00Z');
    state.monthOffset = Math.max(0, (m1.getUTCFullYear() - m0.getUTCFullYear()) * 12 + m1.getUTCMonth() - m0.getUTCMonth());
    if (canCheckout(co)) { state.checkout = co; state.picking = 'checkin'; getQuote(); }
    renderCalendar(); renderSummary();
    setTimeout(() => $('#reservar').scrollIntoView({ behavior: 'smooth' }), 300);
  }
}
init();
