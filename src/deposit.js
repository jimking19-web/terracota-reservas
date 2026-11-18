// Fianza: se retiene (sin cobrar) en la tarjeta del huésped el día antes de la llegada, se renueva si la
// estancia es larga (las retenciones caducan a los 7 días) y se libera sola X días después de la salida.
import { stripeRequest } from './stripe.js';
export { depositFor } from './pricing.js';
import { addDays, todayMadrid } from './dates.js';
import { sendMail } from './mail.js';
import { refToken } from './invoice.js';

const HOLD_DAYS_BEFORE = 1;      // se retiene el día antes de la entrada
const RENEW_AFTER_HOURS = 6 * 24; // Stripe anula las retenciones a los 7 días: renovamos al 6.º

const money = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: c % 100 ? 2 : 0 });
const sqlNow = (ms = 0) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);

export const releaseDate = (b, unit) => addDays(b.checkout, unit?.deposit_release_days ?? 2);
export async function depositLink(db, origin, ref) { return `${origin}/fianza/${ref}?t=${await refToken(db, 'fianza-' + ref)}`; }

// Retiene la fianza con la tarjeta guardada (sin el huésped delante)
export async function placeHold(env, b) {
  if (!b.stripe_customer || !b.stripe_pm) return { ok: false, error: 'No hay tarjeta guardada' };
  try {
    const pi = await stripeRequest(env, 'POST', '/payment_intents', {
      amount: b.deposit, currency: 'eur', customer: b.stripe_customer, payment_method: b.stripe_pm,
      off_session: 'true', confirm: 'true', capture_method: 'manual',
      description: `Fianza · ${b.ref} · ${b.checkin} → ${b.checkout}`,
      metadata: { ref: b.ref, kind: 'deposit' },
    });
    if (pi.status !== 'requires_capture') return { ok: false, error: `Estado inesperado: ${pi.status}`, pi: pi.id };
    return { ok: true, pi: pi.id };
  } catch (e) {
    return { ok: false, error: e.code === 'authentication_required' ? 'El banco pide que el huésped confirme la retención' : e.message, pi: e.paymentIntent };
  }
}
export async function releaseHold(env, piId) {
  try { await stripeRequest(env, 'POST', `/payment_intents/${piId}/cancel`, {}); return { ok: true }; }
  catch (e) { return /cancel|status of canceled|has a status of/.test(e.message) ? { ok: true } : { ok: false, error: e.message }; }
}
export async function captureHold(env, piId, amount) {
  try { const pi = await stripeRequest(env, 'POST', `/payment_intents/${piId}/capture`, { amount_to_capture: amount }); return { ok: true, captured: pi.amount_received }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Checkout para que el propio huésped deje la fianza (si la retención automática falla o no hay tarjeta)
export async function depositCheckout(env, b, origin, siteName) {
  return stripeRequest(env, 'POST', '/checkout/sessions', {
    mode: 'payment', locale: 'es', customer_email: b.email, customer_creation: 'always', client_reference_id: b.ref,
    success_url: `${origin}/reserva?ref=${b.ref}&fianza=ok`, cancel_url: `${origin}/reserva?ref=${b.ref}`,
    metadata: { ref: b.ref, kind: 'deposit' },
    payment_intent_data: { capture_method: 'manual', setup_future_usage: 'off_session', description: `Fianza · ${b.ref}`, metadata: { ref: b.ref, kind: 'deposit' } },
    custom_text: { submit: { message: 'La fianza solo se retiene en tu tarjeta, no se cobra. Se libera automáticamente después de tu salida si todo está bien.' } },
    line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: b.deposit, product_data: { name: `Fianza · ${siteName}`, description: `Estancia ${b.checkin} → ${b.checkout} · se retiene, no se cobra` } } } },
  });
}

async function setDeposit(db, id, fields) {
  const keys = Object.keys(fields);
  await db.prepare(`UPDATE bookings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map(k => fields[k]), id).run();
}

// Tarea programada: retener, renovar y liberar fianzas
export async function runDeposits(env, site) {
  if (!env.STRIPE_SECRET_KEY) return;
  const db = env.DB;
  const today = todayMadrid();
  const origin = site.site_url || '';
  const ownerMail = env.OWNER_EMAIL || site.email;
  const rows = (await db.prepare(`SELECT b.*, u.deposit_release_days FROM bookings b JOIN units u ON u.id = b.unit_id
    WHERE b.status = 'confirmed' AND b.deposit > 0 AND (b.deposit_status IS NULL OR b.deposit_status IN ('pending', 'held'))
    AND b.checkin <= ? AND b.checkout >= ?`).bind(addDays(today, HOLD_DAYS_BEFORE), addDays(today, -30)).all()).results;

  for (const b of rows) {
    const release = addDays(b.checkout, b.deposit_release_days ?? 2);
    // 1) Liberar tras la salida (salvo que la hayas marcado para revisar)
    if (b.deposit_status === 'held' && today >= release) {
      if (b.deposit_keep) continue;
      const r = await releaseHold(env, b.deposit_pi);
      if (r.ok) {
        await setDeposit(db, b.id, { deposit_status: 'released', deposit_note: `Liberada automáticamente el ${today}` });
        if (b.email) await sendMail(env, { to: b.email, fromName: site.site_name, replyTo: site.email || undefined, subject: `Fianza liberada · ${site.site_name} · ${b.ref}`,
          html: simpleMail(site, `Hola ${(b.name || '').split(' ')[0]}:`, `Hemos liberado la fianza de <b>${money(b.deposit)}</b> de tu estancia en ${site.site_name}. No se ha cobrado nada; según tu banco, la retención desaparecerá de tu tarjeta en unos días.<br><br>¡Gracias por cuidar la casa y esperamos verte pronto!`) });
      }
      continue;
    }
    if (today >= release) continue;
    // 2) Retener por primera vez el día antes de la llegada
    if (!b.deposit_status || b.deposit_status === 'pending') {
      if (b.deposit_status === 'pending' && b.deposit_note && b.deposit_note.startsWith('Error')) continue; // ya avisado: espera a que el huésped la deje
      const r = await placeHold(env, b);
      if (r.ok) {
        await setDeposit(db, b.id, { deposit_status: 'held', deposit_pi: r.pi, deposit_held_at: sqlNow(), deposit_note: `Retenida el ${today}` });
      } else {
        const link = await depositLink(db, origin, b.ref);
        await setDeposit(db, b.id, { deposit_status: 'pending', deposit_note: `Error al retener: ${r.error}` });
        if (b.email) await sendMail(env, { to: b.email, fromName: site.site_name, replyTo: site.email || undefined, subject: `Falta la fianza de tu estancia · ${site.site_name}`,
          html: simpleMail(site, `Hola ${(b.name || '').split(' ')[0]}:`, `Tu llegada a ${site.site_name} está muy cerca. Tu banco no nos ha dejado retener automáticamente la fianza de <b>${money(b.deposit)}</b>, así que te pedimos que la dejes tú en un momento (solo se retiene, no se cobra, y se libera tras tu salida).`, link, 'Dejar la fianza') });
        if (ownerMail) await sendMail(env, { to: ownerMail, fromName: site.site_name, subject: `⚠️ Fianza no retenida · ${b.ref} · ${b.name}`,
          html: simpleMail(site, 'Fianza no retenida', `No se ha podido retener la fianza de <b>${esc(b.name)}</b> (${b.checkin} → ${b.checkout}): ${esc(r.error)}.<br>Le he enviado un enlace para que la deje. Puedes verlo en el panel.`, origin + '/admin', 'Abrir el panel') });
      }
      continue;
    }
    // 3) Renovar si la retención está a punto de caducar y la estancia sigue
    if (b.deposit_status === 'held' && b.deposit_held_at && b.deposit_held_at <= sqlNow(-RENEW_AFTER_HOURS * 3600000)) {
      const r = await placeHold(env, b);
      if (r.ok) {
        await releaseHold(env, b.deposit_pi);
        await setDeposit(db, b.id, { deposit_pi: r.pi, deposit_held_at: sqlNow(), deposit_note: `Renovada el ${today}` });
      } else {
        await setDeposit(db, b.id, { deposit_note: `No se pudo renovar el ${today}: ${r.error}` });
        if (ownerMail && !String(b.deposit_note || '').startsWith('No se pudo renovar')) await sendMail(env, { to: ownerMail, fromName: site.site_name, subject: `⚠️ Fianza no renovada · ${b.ref}`,
          html: simpleMail(site, 'Fianza no renovada', `La retención de ${esc(b.name)} caduca pronto y no se ha podido renovar: ${esc(r.error)}. Si necesitas cobrar algo, hazlo antes de 24 h desde el panel.`, origin + '/admin', 'Abrir el panel') });
      }
    }
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function simpleMail(site, title, html, link, label) {
  return `<!doctype html><html><body style="margin:0;background:#f4ede4;font-family:Manrope,Arial,sans-serif;color:#2a211c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
  <tr><td align="center" style="padding-bottom:18px">${site.site_url ? `<img src="${site.site_url}/img/logo-email.png" width="120" alt="${esc(site.site_name)}" style="display:block;width:120px;height:auto">` : `<b>${esc(site.site_name)}</b>`}</td></tr>
  <tr><td style="background:#fff;border-radius:22px;padding:30px 34px;font-size:15.5px;line-height:1.65;color:#57493f">
    <div style="font-family:Georgia,serif;font-size:26px;color:#2a211c;margin-bottom:10px">${esc(title)}</div>${html}
    ${link ? `<div style="text-align:center;margin-top:24px"><a href="${link}" style="display:inline-block;background:#b5573b;color:#fff;border-radius:999px;padding:13px 26px;font-weight:700;text-decoration:none">${esc(label)}</a></div>` : ''}
  </td></tr>
  <tr><td align="center" style="padding-top:16px;font-size:12.5px;color:#8a7b70">${esc(site.site_name)}${site.phone ? ' · ' + esc(site.phone) : ''}</td></tr>
  </table></td></tr></table></body></html>`;
}
