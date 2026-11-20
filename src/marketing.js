// Seguimiento de clientes por email:
//  1) Recuperar reservas a medias (rellenó sus datos pero no pagó)
//  2) Lista de interesados con permiso (ofertas y fechas libres) + envíos desde el panel
//  3) Email tras la estancia con agradecimiento, reseña y código para volver
import { sendMail, mailEnabled } from './mail.js';
import { getUnit, quote, money } from './pricing.js';
import { addDays, todayMadrid } from './dates.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const sqlNow = (ms = 0) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
const fdate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const madridHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()));
export const siteOrigin = site => (site.site_url || 'https://terracota-reservas.podium-cloud.workers.dev').replace(/\/+$/, '');

export const CONSENT_TEXT = 'Acepto recibir emails con ofertas y fechas libres. Puedo darme de baja cuando quiera.';

// ---------- lista ----------
export async function addSubscriber(db, { email, name = '', source, consent = null }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const cur = await db.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  if (cur) {
    // Un consentimiento nuevo y explícito reactiva a quien se dio de baja; un huésped dado de baja sigue de baja
    if (cur.unsubscribed_at && consent) await db.prepare('UPDATE subscribers SET unsubscribed_at = NULL, consent = ?, source = ? WHERE id = ?').bind(consent, source, cur.id).run();
    else if (consent && !cur.consent) await db.prepare('UPDATE subscribers SET consent = ? WHERE id = ?').bind(consent, cur.id).run();
    if (name && !cur.name) await db.prepare('UPDATE subscribers SET name = ? WHERE id = ?').bind(name.slice(0, 120), cur.id).run();
    return (cur.unsubscribed_at && !consent) ? null : cur.token;
  }
  const t = token();
  await db.prepare('INSERT INTO subscribers (email, name, source, consent, token) VALUES (?,?,?,?,?)').bind(email, String(name).slice(0, 120), source, consent, t).run();
  return t;
}

async function isUnsubscribed(db, email) {
  const r = await db.prepare('SELECT unsubscribed_at FROM subscribers WHERE email = ?').bind(String(email).toLowerCase()).first();
  return !!r?.unsubscribed_at;
}

export async function unsubscribePage(db, t, site) {
  const sub = t ? await db.prepare('SELECT * FROM subscribers WHERE token = ?').bind(t).first() : null;
  if (sub && !sub.unsubscribed_at) await db.prepare('UPDATE subscribers SET unsubscribed_at = ? WHERE id = ?').bind(sqlNow(), sub.id).run();
  const msg = sub ? 'Te hemos dado de baja. No volverás a recibir emails de ofertas.' : 'El enlace no es válido o ya no existe.';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Baja · ${esc(site.site_name)}</title>
<link rel="stylesheet" href="/styles.css"></head><body style="min-height:100svh;display:grid;place-items:center;background:var(--sand);text-align:center;padding:24px">
<div style="background:#fff;border-radius:24px;padding:36px;max-width:460px;box-shadow:var(--shadow)"><p class="eyebrow">${esc(site.site_name)}</p><h1 class="display small">${sub ? 'Hecho' : 'Vaya'}</h1><p class="muted">${msg}</p><a class="btn btn-ghost" href="/">Volver a la web</a></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---------- plantilla de email ----------
export function mkEmail(site, origin, { title, html, link, label, unsubToken, image }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4ede4;font-family:Manrope,'Helvetica Neue',Arial,sans-serif;color:#2a211c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
<tr><td align="center" style="padding-bottom:18px"><a href="${origin}"><img src="${origin}/img/logo-email.png" width="140" alt="${esc(site.site_name)}" style="display:block;width:140px;height:auto;border:0"></a></td></tr>
${image ? `<tr><td><img src="${image}" width="580" alt="" style="display:block;width:100%;height:auto;border-radius:22px 22px 0 0"></td></tr>` : ''}
<tr><td style="background:#fff;border-radius:${image ? '0 0 22px 22px' : '22px'};padding:30px 34px;font-size:15.5px;line-height:1.65;color:#57493f">
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:28px;line-height:1.15;color:#2a211c;margin-bottom:12px">${esc(title)}</div>${html}
  ${link ? `<div style="text-align:center;margin-top:24px"><a href="${link}" style="display:inline-block;background:#b5573b;color:#fff;border-radius:999px;padding:13px 28px;font-weight:700;text-decoration:none">${esc(label)}</a></div>` : ''}
</td></tr>
<tr><td align="center" style="padding-top:18px;font-size:12.5px;line-height:1.7;color:#8a7b70">${esc(site.site_name)}${site.address ? ' · ' + esc(site.address) : ''}${site.phone ? ' · ' + esc(site.phone) : ''}
${unsubToken ? `<br><a href="${origin}/baja?t=${unsubToken}" style="color:#8a7b70">Darme de baja de estos emails</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
const p = s => `<p style="margin:0 0 12px">${s}</p>`;
const nl2p = s => String(s || '').split(/\n\s*\n/).map(x => p(esc(x).replace(/\n/g, '<br>'))).join('');

// ---------- 1) reservas a medias ----------
async function runRecovery(env, site, origin) {
  if (site.mk_recovery === '0') return 0;
  const db = env.DB;
  const today = todayMadrid();
  const rows = (await db.prepare(`SELECT b.* FROM bookings b
    WHERE b.source = 'web' AND b.recovery_sent_at IS NULL AND b.email != '' AND b.checkin > ?
      AND (b.status = 'expired' OR (b.status = 'pending' AND b.expires_at IS NOT NULL AND b.expires_at < ?))
      AND b.created_at <= ? AND b.created_at >= ?
      AND NOT EXISTS (SELECT 1 FROM bookings o WHERE lower(o.email) = lower(b.email) AND o.id != b.id AND o.created_at >= b.created_at
                      AND (o.status = 'confirmed' OR (o.status = 'pending' AND (o.expires_at IS NULL OR o.expires_at > ?))))
      AND NOT EXISTS (SELECT 1 FROM bookings r WHERE lower(r.email) = lower(b.email) AND r.recovery_sent_at > ? AND r.recovery_sent_at NOT LIKE 'omitido%')
    ORDER BY b.created_at DESC LIMIT 10`).bind(today, sqlNow(), sqlNow(-60 * 60000), sqlNow(-72 * 3600000), sqlNow(), sqlNow(-7 * 86400000)).all()).results;
  let sent = 0;
  const seen = new Set();
  for (const b of rows) {
    const key = b.email.toLowerCase();
    if (seen.has(key)) { await db.prepare("UPDATE bookings SET recovery_sent_at = 'omitido: duplicado' WHERE id = ?").bind(b.id).run(); continue; }
    seen.add(key);
    if (await isUnsubscribed(db, b.email)) { await db.prepare("UPDATE bookings SET recovery_sent_at = 'omitido: baja' WHERE id = ?").bind(b.id).run(); continue; }
    const unit = await getUnit(db, b.unit_id);
    const q = unit ? await quote(db, unit, { checkin: b.checkin, checkout: b.checkout, guests: b.guests }) : { ok: false };
    if (!q.ok) { await db.prepare("UPDATE bookings SET recovery_sent_at = 'omitido: fechas ocupadas' WHERE id = ?").bind(b.id).run(); continue; }
    const link = `${origin}/?entrada=${b.checkin}&salida=${b.checkout}&huespedes=${b.guests}&utm_source=email-recuperar#reservar`;
    const first = (b.name || '').split(' ')[0];
    const html = p(`Hola${first ? ' ' + esc(first) : ''}:`) +
      p(`Vimos que empezaste a reservar <b>${esc(unit.name)}</b> del <b>${fdate(b.checkin)}</b> al <b>${fdate(b.checkout)}</b> pero no llegaste a terminar.`) +
      p(`<b>Esas fechas siguen libres</b>, ahora mismo por <b>${money(q.total)}</b>. Si quieres, puedes terminar la reserva en un minuto desde aquí:`) +
      `<p style="margin:16px 0 0;font-size:13.5px;color:#8a7b70">¿Tienes alguna duda? Responde a este email${site.phone ? ' o escríbenos al ' + esc(site.phone) : ''} y te ayudamos. Si ya no te interesa, ignora este mensaje: no te escribiremos más por esto.</p>`;
    const r = await sendMail(env, { to: b.email, fromName: site.site_name, replyTo: site.email || undefined,
      subject: `Tus fechas en ${site.site_name} siguen libres`,
      html: mkEmail(site, origin, { title: 'Te quedaste a un paso', html, link, label: 'Terminar mi reserva', image: site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '' }) });
    await db.prepare('UPDATE bookings SET recovery_sent_at = ? WHERE id = ?').bind(r?.ok === false ? 'error: ' + String(r.error).slice(0, 80) : sqlNow(), b.id).run();
    if (r?.ok !== false) sent++;
  }
  return sent;
}

// ---------- 3) después de la estancia ----------
function returnCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'VUELVE-' + [...crypto.getRandomValues(new Uint8Array(5))].map(b => a[b % a.length]).join('');
}
async function runPostStay(env, site, origin) {
  if (site.mk_poststay === '0') return 0;
  if (madridHour() < 10 || madridHour() > 21) return 0;
  const db = env.DB;
  const today = todayMadrid();
  const rows = (await db.prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND source IN ('web','manual') AND email != ''
    AND poststay_sent_at IS NULL AND checkout < ? AND checkout >= ? ORDER BY checkout LIMIT 10`).bind(today, addDays(today, -10)).all()).results;
  const pct = Math.max(0, Math.min(50, parseInt(site.mk_return_pct ?? '10', 10) || 0));
  let sent = 0;
  for (const b of rows) {
    const unsub = await addSubscriber(db, { email: b.email, name: b.name, source: 'huésped' });
    if (!unsub) { await db.prepare("UPDATE bookings SET poststay_sent_at = 'omitido: baja' WHERE id = ?").bind(b.id).run(); continue; }
    let code = '';
    if (pct > 0) {
      code = returnCode();
      await db.prepare(`INSERT INTO promo_codes (code, kind, value, valid_from, valid_to, max_uses, note, exclusive) VALUES (?, 'pct', ?, ?, ?, 1, ?, 0)`)
        .bind(code, pct, today, addDays(today, 365), `Para volver · ${b.name || b.email} (${b.ref})`).run();
    }
    const first = (b.name || '').split(' ')[0];
    const review = site.review_url ? `<p style="margin:0 0 12px">Si te ha gustado, nos ayudaría muchísimo que dejaras una reseña: <a href="${esc(site.review_url)}" style="color:#b5573b;font-weight:700">escribir una reseña</a>. Solo es un minuto.</p>` : '';
    const codeHtml = code ? `<div style="margin:18px 0;padding:18px;border:1.5px dashed #b5573b;border-radius:16px;text-align:center;background:#fbf8f4">
        <div style="font-size:13px;color:#8a7b70">Para tu próxima escapada, un <b>${pct} % de descuento</b> reservando en nuestra web</div>
        <div style="font-family:Georgia,serif;font-size:28px;letter-spacing:.08em;color:#2a211c;margin-top:6px">${code}</div>
        <div style="font-size:12.5px;color:#8a7b70;margin-top:4px">Válido un año · un solo uso · se suma a los demás descuentos</div></div>` : '';
    const html = p(`Hola${first ? ' ' + esc(first) : ''}:`) +
      p(`Gracias por alojarte en <b>${esc(site.site_name)}</b>. Esperamos que hayas descansado y que la alberca, el vino y la calma de Bullas te hayan sentado tan bien como a nosotros.`) +
      review + codeHtml + p('Te esperamos de vuelta cuando quieras.');
    const r = await sendMail(env, { to: b.email, fromName: site.site_name, replyTo: site.email || undefined,
      subject: `Gracias por tu estancia en ${site.site_name}`,
      html: mkEmail(site, origin, { title: '¡Gracias por venir!', html, link: `${origin}/?utm_source=email-gracias#reservar`, label: 'Ver fechas libres', unsubToken: unsub }) });
    await db.prepare('UPDATE bookings SET poststay_sent_at = ?, return_code = ? WHERE id = ?').bind(r?.ok === false ? 'error: ' + String(r.error).slice(0, 80) : sqlNow(), code || null, b.id).run();
    if (r?.ok !== false) sent++;
  }
  return sent;
}

export async function runMarketing(env, site) {
  if (!mailEnabled(env)) return;
  const origin = siteOrigin(site);
  const h = madridHour();
  if (h >= 9 && h <= 22) await runRecovery(env, site, origin);
  await runPostStay(env, site, origin);
}

// ---------- 2) envíos desde el panel ----------
export async function sendCampaign(env, site, { subject, title, message, link, label, test, to }) {
  const db = env.DB;
  const origin = siteOrigin(site);
  if (!subject || !message) return { ok: false, error: 'Falta el asunto o el mensaje' };
  const make = t => mkEmail(site, origin, { title: title || subject, html: nl2p(message), link: link || `${origin}/?utm_source=email-oferta#reservar`, label: label || 'Ver fechas y reservar', unsubToken: t, image: site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '' });
  if (test) {
    const r = await sendMail(env, { to, fromName: site.site_name, replyTo: site.email || undefined, subject: `[PRUEBA] ${subject}`, html: make('prueba') });
    return r?.ok === false ? { ok: false, error: r.error } : { ok: true, sent: 1 };
  }
  const subs = (await db.prepare('SELECT email, token FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY id LIMIT 400').all()).results;
  let sent = 0, failed = 0;
  for (const s of subs) {
    const r = await sendMail(env, { to: s.email, fromName: site.site_name, replyTo: site.email || undefined, subject, html: make(s.token) });
    if (r?.ok === false) failed++; else sent++;
  }
  await db.prepare('INSERT INTO campaigns (subject, message, sent, failed) VALUES (?,?,?,?)').bind(subject, message, sent, failed).run();
  return { ok: true, sent, failed };
}

export async function marketingStats(db) {
  const [subs, bySource, rec, recWon, post, codes, camps, list] = await db.batch([
    db.prepare('SELECT count(*) total, sum(unsubscribed_at IS NULL) active FROM subscribers'),
    db.prepare('SELECT source, count(*) n FROM subscribers WHERE unsubscribed_at IS NULL GROUP BY source'),
    db.prepare("SELECT count(*) n FROM bookings WHERE recovery_sent_at IS NOT NULL AND recovery_sent_at NOT LIKE 'omitido%' AND recovery_sent_at NOT LIKE 'error%'"),
    db.prepare(`SELECT count(DISTINCT b.id) n, coalesce(sum(o.total),0) total FROM bookings b JOIN bookings o ON lower(o.email) = lower(b.email) AND o.status = 'confirmed' AND o.created_at > b.recovery_sent_at
      WHERE b.recovery_sent_at IS NOT NULL AND b.recovery_sent_at NOT LIKE 'omitido%' AND b.recovery_sent_at NOT LIKE 'error%'`),
    db.prepare("SELECT count(*) n FROM bookings WHERE poststay_sent_at IS NOT NULL AND poststay_sent_at NOT LIKE 'omitido%' AND poststay_sent_at NOT LIKE 'error%'"),
    db.prepare("SELECT count(*) n, coalesce(sum(uses),0) used FROM promo_codes WHERE code LIKE 'VUELVE-%'"),
    db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 10'),
    db.prepare('SELECT id, email, name, source, consent IS NOT NULL AS consent, created_at, unsubscribed_at FROM subscribers ORDER BY id DESC LIMIT 500'),
  ]);
  return { ok: true, subscribers: subs.results[0], bySource: bySource.results, recoverySent: rec.results[0].n, recovered: recWon.results[0],
    postStaySent: post.results[0].n, returnCodes: codes.results[0], campaigns: camps.results, list: list.results };
}

// ---------- regalo por apuntarse a la lista ----------
function welcomeCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'HOLA-' + [...crypto.getRandomValues(new Uint8Array(5))].map(b => a[b % a.length]).join('');
}
// Devuelve { code, sent } o null si no hay regalo configurado
export async function welcomeGift(env, site, email) {
  const db = env.DB;
  const amount = Math.round(Number(String(site.welcome_amount ?? '10').replace(',', '.')) * 100);
  if (!(amount > 0)) return null;
  email = String(email).trim().toLowerCase();
  const sub = await db.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  if (!sub || sub.unsubscribed_at) return null;
  let code = sub.welcome_code;
  if (code) {
    const used = await db.prepare('SELECT uses FROM promo_codes WHERE code = ?').bind(code).first();
    if (!used || used.uses > 0) return { code: null, already: true };
  } else {
    // Un regalo por email, y nunca a quien ya ha reservado con nosotros
    const guest = await db.prepare("SELECT 1 FROM bookings WHERE lower(email) = ? AND status = 'confirmed' AND source != 'bloqueo' LIMIT 1").bind(email).first();
    if (guest) return { code: null, guest: true };
    code = welcomeCode();
    const today = todayMadrid();
    await db.batch([
      db.prepare("INSERT INTO promo_codes (code, kind, value, valid_from, valid_to, max_uses, note, exclusive) VALUES (?, 'fixed', ?, NULL, ?, 1, ?, 0)").bind(code, amount, addDays(today, 365), `Bienvenida lista · ${email}`),
      db.prepare('UPDATE subscribers SET welcome_code = ? WHERE id = ?').bind(code, sub.id),
    ]);
  }
  if (!mailEnabled(env)) return { code, sent: false };
  const origin = siteOrigin(site);
  const html = p('¡Gracias por apuntarte!') +
    p(`Como prometimos, aquí tienes <b>${money(amount)} de descuento</b> para tu primera reserva directa en ${esc(site.site_name)}. Escríbelo en «¿Tienes un código promocional?» al reservar:`) +
    `<div style="margin:18px 0;padding:18px;border:1.5px dashed #b5573b;border-radius:16px;text-align:center;background:#fbf8f4">
      <div style="font-family:Georgia,serif;font-size:28px;letter-spacing:.08em;color:#2a211c">${code}</div>
      <div style="font-size:12.5px;color:#8a7b70;margin-top:4px">Un solo uso · válido un año · se suma a los demás descuentos</div></div>` +
    p('De vez en cuando te avisaremos de fechas libres y ofertas. Nada más.');
  const r = await sendMail(env, { to: email, fromName: site.site_name, replyTo: site.email || undefined, subject: `Tu descuento de ${money(amount)} en ${site.site_name}`,
    html: mkEmail(site, origin, { title: 'Tu regalo de bienvenida', html, link: `${origin}/?utm_source=email-bienvenida#reservar`, label: 'Ver fechas libres', unsubToken: sub.token, image: site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '' }) });
  return { code, sent: r?.ok !== false };
}
