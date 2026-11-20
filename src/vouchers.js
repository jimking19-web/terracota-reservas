// Vales regalo: se compran por número de noches, sin fecha; se canjean al reservar con su código.
import { stripeRequest } from './stripe.js';
import { sendMail, mailEnabled } from './mail.js';
import { mkEmail, siteOrigin } from './marketing.js';
import { money } from './pricing.js';
import { addDays, todayMadrid } from './dates.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sqlNow = (ms = 0) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
const fdate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const isVoucherCode = c => /^REGALO-[A-Z0-9]{6}$/.test(String(c || '').trim().toUpperCase());

export function voucherConfig(site) {
  return {
    enabled: site.vouchers_enabled !== '0',
    price: Math.round(Number(String(site.voucher_price ?? '180').replace(',', '.')) * 100),
    maxNights: Math.max(1, parseInt(site.voucher_max_nights ?? '7', 10) || 7),
    months: Math.max(1, parseInt(site.voucher_months ?? '12', 10) || 12),
    includes: site.voucher_includes ?? 'Botella de vino incluida',
    prices: parsePrices(site.voucher_prices ?? '2|375'),
  };
}

// Precios especiales por número de noches ("2|375" por línea). Sin precio propio: precio por noche;
// por encima del mayor tramo especial se mantiene su precio medio por noche.
function parsePrices(txt) {
  const m = new Map();
  for (const l of String(txt || '').split('\n')) { const [n, p] = l.split('|').map(x => x.trim()); const ni = parseInt(n, 10), pc = Math.round(Number(String(p || '').replace(',', '.')) * 100); if (ni > 0 && pc > 0) m.set(ni, pc); }
  return m;
}
export function voucherPrice(cfg, nights) {
  if (cfg.prices.has(nights)) return cfg.prices.get(nights);
  const keys = [...cfg.prices.keys()].filter(k => k < nights);
  if (keys.length) { const k = Math.max(...keys); return Math.round(cfg.prices.get(k) / k * nights); }
  return cfg.price * nights;
}

function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'REGALO-' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => a[b % a.length]).join('');
}
function addMonths(day, n) {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10);
}

// ¿Se puede usar este vale para esta estancia? Devuelve { ok, voucher } o { error }
export async function checkVoucher(db, code, { checkin, excludeBookingId = null } = {}) {
  code = String(code || '').trim().toUpperCase();
  const v = await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
  if (!v || v.status === 'pending' || v.status === 'cancelled') return { error: 'Vale regalo no válido' };
  if (v.status === 'used') return { error: 'Este vale regalo ya se ha usado' };
  if (v.expires_at && checkin && checkin > v.expires_at) return { error: `El vale es para estancias hasta el ${fdate(v.expires_at)}` };
  if (v.booking_id && v.booking_id !== excludeBookingId) {
    const b = await db.prepare("SELECT status, expires_at FROM bookings WHERE id = ?").bind(v.booking_id).first();
    if (b && (b.status === 'confirmed' || (b.status === 'pending' && (!b.expires_at || b.expires_at > sqlNow())))) return { error: 'Este vale regalo ya está en uso en otra reserva' };
  }
  return { ok: true, voucher: v };
}

// ---------- compra ----------
export async function buyVoucher(env, site, url, b) {
  const db = env.DB;
  const cfg = voucherConfig(site);
  if (!cfg.enabled) return { ok: false, error: 'Los vales regalo no están disponibles ahora mismo' };
  if (!env.STRIPE_SECRET_KEY) return { ok: false, error: 'El pago con tarjeta no está activado' };
  const nights = parseInt(b.nights, 10);
  if (!(nights >= 1 && nights <= cfg.maxNights)) return { ok: false, error: `Elige entre 1 y ${cfg.maxNights} noches` };
  const buyer = String(b.buyer_name || '').trim(), email = String(b.buyer_email || '').trim().toLowerCase();
  if (buyer.length < 2) return { ok: false, error: 'Indica tu nombre' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Revisa tu email' };
  const sendTo = b.send_to === 'recipient' ? 'recipient' : 'buyer';
  const rEmail = String(b.recipient_email || '').trim().toLowerCase();
  if (sendTo === 'recipient' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rEmail)) return { ok: false, error: 'Revisa el email de la persona que recibe el regalo' };
  if (!b.accept) return { ok: false, error: 'Acepta las condiciones del vale' };
  const amount = voucherPrice(cfg, nights);
  let code; for (let i = 0; i < 5; i++) { code = newCode(); if (!(await db.prepare('SELECT 1 FROM vouchers WHERE code = ?').bind(code).first())) break; }
  const ins = await db.prepare(`INSERT INTO vouchers (code, nights, amount, buyer_name, buyer_email, recipient_name, recipient_email, message, send_to, status)
    VALUES (?,?,?,?,?,?,?,?,?, 'pending')`).bind(code, nights, amount, buyer.slice(0, 120), email, String(b.recipient_name || '').trim().slice(0, 120),
    rEmail || null, String(b.message || '').trim().slice(0, 600), sendTo).run();
  const origin = url.origin;
  try {
    const s = await stripeRequest(env, 'POST', '/checkout/sessions', {
      mode: 'payment', customer_email: email, locale: 'es', client_reference_id: code,
      expires_at: Math.floor((Date.now() + 31 * 60000) / 1000),
      success_url: `${origin}/vale?c=${code}&pago=ok`, cancel_url: `${origin}/?vale=cancelado#regalo`,
      metadata: { kind: 'voucher', voucher: code },
      payment_intent_data: { description: `${site.site_name} · Vale regalo ${nights} ${nights === 1 ? 'noche' : 'noches'} · ${code}`, metadata: { voucher: code } },
      line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: amount,
        product_data: { name: `Vale regalo · ${nights} ${nights === 1 ? 'noche' : 'noches'} en ${site.site_name}`, description: `Sin fecha: se reserva cuando queráis. ${cfg.includes}.` } } } },
    });
    await db.prepare('UPDATE vouchers SET stripe_session = ? WHERE id = ?').bind(s.id, ins.meta.last_row_id).run();
    return { ok: true, redirect: s.url };
  } catch (e) {
    await db.prepare("UPDATE vouchers SET status = 'cancelled' WHERE id = ?").bind(ins.meta.last_row_id).run();
    return { ok: false, error: 'No se pudo iniciar el pago: ' + e.message };
  }
}

// Activa un vale pagado (desde el webhook o al volver de Stripe). Solo la primera vez envía los emails.
export async function activateVoucher(env, code, paymentId, origin) {
  const db = env.DB;
  const site = Object.fromEntries((await db.prepare('SELECT key, value FROM settings').all()).results.map(r => [r.key, r.value]));
  const cfg = voucherConfig(site);
  const today = todayMadrid();
  const upd = await db.prepare("UPDATE vouchers SET status = 'active', paid_at = ?, expires_at = ?, stripe_payment = ? WHERE code = ? AND status = 'pending'")
    .bind(sqlNow(), addMonths(today, cfg.months), paymentId || null, code).run();
  if (!upd.meta.changes) return;
  const v = await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
  await sendVoucherEmails(env, { ...site, site_name: site.site_name || 'Terracota Suites' }, v, origin);
}

export async function sendVoucherEmails(env, site, v, origin) {
  if (!mailEnabled(env)) return;
  origin = origin || siteOrigin(site);
  const cfg = voucherConfig(site);
  const link = `${origin}/vale?c=${v.code}`;
  const n = `${v.nights} ${v.nights === 1 ? 'noche' : 'noches'}`;
  const card = `<div style="margin:18px 0;padding:22px;border:1.5px dashed #b5573b;border-radius:18px;text-align:center;background:#fbf8f4">
    <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#b5573b;font-weight:700">Vale regalo</div>
    <div style="font-family:Georgia,serif;font-size:30px;color:#2a211c;margin:6px 0">${n} en ${esc(site.site_name)}</div>
    ${v.recipient_name ? `<div style="color:#57493f">Para <b>${esc(v.recipient_name)}</b>${v.buyer_name ? ` · de parte de <b>${esc(v.buyer_name)}</b>` : ''}</div>` : ''}
    ${v.message ? `<div style="font-style:italic;color:#57493f;margin-top:10px">«${esc(v.message)}»</div>` : ''}
    <div style="font-family:Georgia,serif;font-size:26px;letter-spacing:.08em;color:#2a211c;margin-top:14px">${v.code}</div>
    <div style="font-size:12.5px;color:#8a7b70;margin-top:4px">Sin fecha · Válido para estancias hasta el ${fdate(v.expires_at)}</div>
    ${site.voucher_list ? `<div style="font-size:13px;color:#57493f;margin-top:12px;line-height:1.7"><b>Incluye:</b> ${esc(String(site.voucher_list).split('\n').map(x => x.trim()).filter(Boolean).join(' · '))}</div>` : `<div style="font-size:12.5px;color:#8a7b70">${esc(cfg.includes)}</div>`}</div>`;
  const how = '<p style="margin:0 0 12px">Para usarlo, elegid las fechas en nuestra web y escribid el código en «¿Tienes un código promocional o vale regalo?» al reservar. Si queréis, también podéis escribirnos y os lo reservamos nosotros.</p>';
  const toRecipient = v.send_to === 'recipient' && v.recipient_email;
  const hero = site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '';
  const tasks = [];
  if (toRecipient) {
    tasks.push(sendMail(env, { to: v.recipient_email, fromName: site.site_name, replyTo: site.email || undefined,
      subject: `${v.buyer_name || 'Alguien'} te regala una escapada a ${site.site_name}`,
      html: mkEmail(site, origin, { title: '¡Tienes un regalo!', image: hero, link, label: 'Ver e imprimir mi vale',
        html: `<p style="margin:0 0 12px"><b>${esc(v.buyer_name)}</b> te regala ${n} en ${esc(site.site_name)}, un refugio con alberca en Bullas (Murcia).</p>${card}${how}` }) }));
  }
  tasks.push(sendMail(env, { to: v.buyer_email, fromName: site.site_name, replyTo: site.email || undefined,
    subject: `Tu vale regalo de ${n} · ${site.site_name}`,
    html: mkEmail(site, origin, { title: 'Gracias por tu regalo', image: hero, link, label: 'Ver e imprimir el vale',
      html: `<p style="margin:0 0 12px">Hemos recibido tu pago de <b>${money(v.amount)}</b>. ${toRecipient ? `Le hemos enviado el vale a <b>${esc(v.recipient_email)}</b>. ` : 'Puedes imprimirlo o reenviarlo desde el botón de abajo. '}Aquí lo tienes:</p>${card}${how}` }) }));
  const owner = env.OWNER_EMAIL || site.email;
  if (owner) tasks.push(sendMail(env, { to: owner, fromName: site.site_name, replyTo: v.buyer_email,
    subject: `Nuevo vale regalo vendido · ${n} · ${money(v.amount)}`,
    html: mkEmail(site, origin, { title: 'Vale regalo vendido', link: `${origin}/admin/#codigos`, label: 'Ver en el panel',
      html: `<p style="margin:0 0 12px"><b>${esc(v.buyer_name)}</b> (${esc(v.buyer_email)}) ha comprado un vale de ${n} por ${money(v.amount)}${v.recipient_name ? ` para <b>${esc(v.recipient_name)}</b>` : ''}.</p>${card}` }) }));
  await Promise.all(tasks).catch(() => {});
}

// Página pública del vale (datos para imprimir)
export async function voucherPublic(env, code, origin) {
  const db = env.DB;
  let v = await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(String(code).toUpperCase()).first();
  if (!v || v.status === 'cancelled') return { ok: false, error: 'Vale no encontrado' };
  if (v.status === 'pending' && v.stripe_session && env.STRIPE_SECRET_KEY) {
    try {
      const s = await stripeRequest(env, 'GET', `/checkout/sessions/${v.stripe_session}`);
      if (s.payment_status === 'paid') { await activateVoucher(env, v.code, s.payment_intent, origin); v = await db.prepare('SELECT * FROM vouchers WHERE id = ?').bind(v.id).first(); }
    } catch {}
  }
  return { ok: true, code: v.code, nights: v.nights, status: v.status, recipient: v.recipient_name, buyer: v.buyer_name, message: v.message, expires: v.expires_at };
}

// ---------- panel ----------
export async function adminVouchers(db) {
  return (await db.prepare(`SELECT v.*, b.ref AS booking_ref, b.checkin AS booking_checkin FROM vouchers v LEFT JOIN bookings b ON b.id = v.booking_id
    WHERE v.status != 'pending' OR v.created_at > datetime('now', '-1 day') ORDER BY v.id DESC LIMIT 300`).all()).results;
}
export async function createManualVoucher(db, site, b) {
  const cfg = voucherConfig(site);
  const nights = parseInt(b.nights, 10);
  if (!(nights >= 1 && nights <= 30)) return { ok: false, error: 'Noches no válidas' };
  let code; for (let i = 0; i < 5; i++) { code = newCode(); if (!(await db.prepare('SELECT 1 FROM vouchers WHERE code = ?').bind(code).first())) break; }
  const amount = b.amount !== '' && b.amount != null ? Math.round(Number(String(b.amount).replace(',', '.')) * 100) : voucherPrice(cfg, nights);
  await db.prepare(`INSERT INTO vouchers (code, nights, amount, buyer_name, buyer_email, recipient_name, message, send_to, status, paid_at, expires_at, note)
    VALUES (?,?,?,?,?,?,?, 'buyer', 'active', ?, ?, ?)`).bind(code, nights, amount, String(b.buyer_name || '').slice(0, 120), String(b.buyer_email || '').trim().toLowerCase(),
    String(b.recipient_name || '').slice(0, 120), String(b.message || '').slice(0, 600), sqlNow(), addMonths(todayMadrid(), cfg.months), 'Creado a mano en el panel').run();
  return { ok: true, code };
}
