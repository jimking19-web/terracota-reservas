// Envío de emails: Gmail (SMTP, configurado desde el panel) o Resend (RESEND_API_KEY). Si no hay ninguno, no se envía nada.
import { money } from './pricing.js';
import { smtpSend } from './smtp.js';

export const mailEnabled = env => !!((env.SMTP_USER && env.SMTP_PASS) || env.RESEND_API_KEY);

export async function sendMail(env, { to, subject, html, replyTo, fromName }) {
  if (!to) return { skipped: true };
  try {
    if (env.SMTP_USER && env.SMTP_PASS) {
      return await smtpSend({ ...(env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), secure: env.SMTP_SECURE || 'on' } : {}), user: env.SMTP_USER, pass: env.SMTP_PASS, fromName: fromName || 'Terracota Suites', to, replyTo, subject, html });
    }
    if (env.RESEND_API_KEY) {
      const from = env.MAIL_FROM || `${fromName || 'Terracota Suites'} <reservas@resend.dev>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo }),
      });
      return res.ok ? { ok: true } : { ok: false, error: 'Resend: ' + (await res.text()).slice(0, 200) };
    }
    return { skipped: true };
  } catch (e) {
    console.error('mail', e);
    return { ok: false, error: e.message };
  }
}

// ---------- plantillas ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fdate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const C = { terra: '#b5573b', terraD: '#8e3f28', terraL: '#f3e2d8', ink: '#2a211c', ink2: '#57493f', muted: '#8a7b70', sand: '#f4ede4', cream: '#fbf8f4', line: '#e8dfd5', olive: '#6b6b4a' };
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "Manrope,'Helvetica Neue',Arial,sans-serif";

function shell(site, origin, inner, preheader = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<title>${esc(site.site_name)}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;600;700&display=swap');
@media (max-width:620px){.px{padding-left:22px!important;padding-right:22px!important}.h1{font-size:30px!important}.col{display:block!important;width:100%!important}.colr{padding-left:0!important;padding-top:14px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.sand};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sand}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td align="center" style="padding:6px 0 22px"><a href="${origin}" style="text-decoration:none"><img src="${origin}/img/logo-email.png" width="150" alt="${esc(site.site_name)}" style="display:block;width:150px;height:auto;border:0"></a></td></tr>
${inner}
${footer(site, origin)}
</table></td></tr></table></body></html>`;
}

function footer(site, origin) {
  const contact = [
    site.phone && `<a href="tel:${esc(site.phone.replace(/\s/g, ''))}" style="color:${C.ink2};text-decoration:none">${esc(site.phone)}</a>`,
    site.email && `<a href="mailto:${esc(site.email)}" style="color:${C.ink2};text-decoration:none">${esc(site.email)}</a>`,
    site.instagram && `<a href="https://instagram.com/${esc(site.instagram.replace('@', ''))}" style="color:${C.ink2};text-decoration:none">${esc(site.instagram)}</a>`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const legal = [site.legal_name, site.legal_id && 'NIF ' + site.legal_id, site.license && 'Reg. turístico ' + site.license].filter(Boolean).map(esc).join(' · ');
  return `<tr><td align="center" style="padding:28px 20px 0;font-family:${SANS};font-size:13px;line-height:1.7;color:${C.muted}">
  <div style="font-family:${SERIF};font-size:20px;color:${C.ink};margin-bottom:4px">${esc(site.site_name)}</div>
  ${esc(site.address || '')}<br>${contact}
  ${legal ? `<div style="font-size:11.5px;margin-top:10px;color:${C.muted}">${legal}</div>` : ''}
  <div style="margin-top:10px"><a href="${origin}" style="color:${C.terra};font-weight:600;text-decoration:none">${esc(origin.replace(/^https?:\/\//, ''))}</a></div></td></tr>`;
}

const btn = (href, label, primary = true) => `<a href="${href}" style="display:inline-block;background:${primary ? C.terra : '#fff'};color:${primary ? '#fff' : C.terraD};border:1.5px solid ${primary ? C.terra : C.line};border-radius:999px;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:700;text-decoration:none;margin:4px">${label}</a>`;

function linesTable(b, paidLabel) {
  const lines = JSON.parse(b.breakdown || '[]');
  const rows = lines.map(l => `<tr><td style="padding:7px 0;color:${C.ink2}">${esc(l.label)}</td><td align="right" style="padding:7px 0;white-space:nowrap;color:${l.amount < 0 ? '#3f7a3a' : C.ink2};${l.amount < 0 ? 'font-weight:700' : ''}">${money(l.amount)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${SANS};font-size:14.5px">${rows}
    <tr><td style="padding:14px 0 0;border-top:1.5px solid ${C.line};font-weight:800;font-size:16px;color:${C.ink}">${paidLabel}</td>
    <td align="right" style="padding:14px 0 0;border-top:1.5px solid ${C.line};font-weight:800;font-size:18px;color:${C.ink};white-space:nowrap">${money(b.total)}</td></tr></table>`;
}

const kv = (k, v) => `<tr><td style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};width:120px;vertical-align:top">${k}</td><td style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};font-weight:600">${v}</td></tr>`;

export function guestEmail(site, unit, b, { origin, heroUrl, bookingUrl, invoiceUrl, kind = 'confirmed' } = {}) {
  const first = esc((b.name || '').trim().split(/\s+/)[0] || '');
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.map_query || site.address || site.site_name)}`;
  const isRequest = kind === 'request';
  const title = isRequest ? `Hemos recibido tu solicitud${first ? ', ' + first : ''}` : `¡Te esperamos${first ? ', ' + first : ''}!`;
  const intro = isRequest
    ? 'Hemos bloqueado tus fechas. En breve te contactaremos para confirmar la reserva y el pago.'
    : `Tu reserva en ${esc(site.site_name)} está <b>confirmada</b>. Aquí tienes el resumen. Guárdalo, que lo necesitarás a la llegada.`;
  const amen = String(site.amenities || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const rules = String(site.house_rules || '').split('\n').map(s => s.trim()).filter(Boolean);
  const wa = site.whatsapp || site.phone;
  const waUrl = wa ? `https://wa.me/${String(wa).replace(/\D/g, '').replace(/^(?!34)(\d{9})$/, '34$1')}` : '';

  const inner = `
<tr><td style="background:#fff;border-radius:26px 26px 0 0;overflow:hidden;line-height:0">${heroUrl ? `<img src="${heroUrl}" width="600" alt="" style="display:block;width:100%;height:auto;max-height:340px;object-fit:cover;border-radius:26px 26px 0 0">` : ''}</td></tr>
<tr><td class="px" style="background:#fff;padding:34px 44px 8px">
  <div style="font-family:${SANS};font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:${C.terra};font-weight:700">${isRequest ? 'Solicitud recibida' : 'Reserva confirmada'} · ${esc(b.ref)}</div>
  <h1 class="h1" style="margin:10px 0 12px;font-family:${SERIF};font-weight:500;font-size:38px;line-height:1.1;color:${C.ink}">${title}</h1>
  <p style="margin:0;font-family:${SANS};font-size:15.5px;line-height:1.65;color:${C.ink2}">${intro}</p>
</td></tr>
<tr><td class="px" style="background:#fff;padding:22px 44px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border:1px solid ${C.line};border-radius:18px"><tr>
    <td class="col" width="50%" style="padding:18px 20px;vertical-align:top">
      <div style="font-family:${SANS};font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.muted}">Entrada</div>
      <div style="font-family:${SERIF};font-size:23px;color:${C.ink};margin-top:4px">${cap(fdate(b.checkin))}</div>
      <div style="font-family:${SANS};font-size:13.5px;color:${C.ink2};margin-top:2px">${site.checkin_time ? 'a partir de las ' + esc(site.checkin_time) : ''}</div></td>
    <td class="col colr" width="50%" style="padding:18px 20px;vertical-align:top;border-left:1px solid ${C.line}">
      <div style="font-family:${SANS};font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.muted}">Salida</div>
      <div style="font-family:${SERIF};font-size:23px;color:${C.ink};margin-top:4px">${cap(fdate(b.checkout))}</div>
      <div style="font-family:${SANS};font-size:13.5px;color:${C.ink2};margin-top:2px">${site.checkout_time ? 'antes de las ' + esc(site.checkout_time) : ''}</div></td>
  </tr></table>
</td></tr>
<tr><td class="px" style="background:#fff;padding:14px 44px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${kv('Alojamiento', esc(unit.name))}
    ${kv('Huéspedes', `${b.guests} · ${b.nights} ${b.nights === 1 ? 'noche' : 'noches'}`)}
    ${kv('A nombre de', esc(b.name))}
    ${kv('Dónde', `${esc(site.address || '')} · <a href="${mapUrl}" style="color:${C.terra};text-decoration:none">Ver mapa</a>`)}
  </table>
</td></tr>
<tr><td class="px" style="background:#fff;padding:22px 44px 8px">
  <div style="font-family:${SERIF};font-size:24px;color:${C.ink};margin-bottom:6px">Resumen del pago</div>
  ${linesTable(b, isRequest ? 'Total' : (b.paid ? 'Total pagado' : 'Total'))}
  ${!isRequest && b.paid ? `<div style="font-family:${SANS};font-size:13px;color:#3f7a3a;margin-top:8px">✓ Pagado con tarjeta${b.invoice_no ? ` · Factura ${esc(b.invoice_no)}` : ''}</div>` : ''}
</td></tr>
<tr><td class="px" align="center" style="background:#fff;padding:22px 44px 30px">
  ${bookingUrl ? btn(bookingUrl, 'Ver mi reserva') : ''}${invoiceUrl ? btn(invoiceUrl, 'Descargar factura', false) : ''}
</td></tr>
${amen.length ? `<tr><td class="px" style="background:${C.terraL};padding:26px 44px">
  <div style="font-family:${SERIF};font-size:24px;color:${C.ink};margin-bottom:10px">Te estará esperando</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${amen.reduce((rows, a, i) => i % 2 ? rows : rows + `<tr><td width="50%" style="padding:5px 8px 5px 0;font-family:${SANS};font-size:14.5px;color:${C.ink2};vertical-align:top">· ${esc(a)}</td><td width="50%" style="padding:5px 0;font-family:${SANS};font-size:14.5px;color:${C.ink2};vertical-align:top">${amen[i + 1] ? '· ' + esc(amen[i + 1]) : ''}</td></tr>`, '')}</table>
</td></tr>` : ''}
<tr><td class="px" style="background:#fff;padding:26px 44px 10px;font-family:${SANS};font-size:14.5px;line-height:1.7;color:${C.ink2}">
  <div style="font-family:${SERIF};font-size:24px;color:${C.ink};margin-bottom:6px">Antes de llegar</div>
  Unos días antes de tu llegada te enviaremos cómo llegar y el acceso al alojamiento. Si necesitas cualquier cosa, responde a este email${site.phone ? ` o llámanos al <a href="tel:${esc(site.phone.replace(/\s/g, ''))}" style="color:${C.terra};text-decoration:none;font-weight:700">${esc(site.phone)}</a>` : ''}.
  ${waUrl ? `<div style="margin-top:14px">${btn(waUrl, 'Escríbenos por WhatsApp', false)}</div>` : ''}
</td></tr>
${rules.length || site.cancellation ? `<tr><td class="px" style="background:#fff;border-radius:0 0 26px 26px;padding:14px 44px 34px;font-family:${SANS};font-size:13px;line-height:1.65;color:${C.muted}">
  ${rules.length ? `<b style="color:${C.ink2}">Normas de la casa:</b> ${rules.map(esc).join(' · ')}<br>` : ''}
  ${site.cancellation ? `<b style="color:${C.ink2}">Cancelación:</b> ${esc(site.cancellation)}` : ''}
</td></tr>` : `<tr><td style="background:#fff;border-radius:0 0 26px 26px;height:20px"></td></tr>`}`;
  return shell(site, origin, inner, `${isRequest ? 'Solicitud' : 'Reserva confirmada'} ${b.ref} · ${fdate(b.checkin)} → ${fdate(b.checkout)}`);
}

export function ownerEmail(site, unit, b, { origin, invoiceUrl, conflict } = {}) {
  const inner = `<tr><td class="px" style="background:#fff;border-radius:26px;padding:32px 40px">
  <div style="font-family:${SANS};font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:${C.terra};font-weight:700">${b.status === 'confirmed' ? 'Nueva reserva pagada' : 'Nueva solicitud'} · ${esc(b.ref)}</div>
  <h1 class="h1" style="margin:10px 0 16px;font-family:${SERIF};font-weight:500;font-size:32px;color:${C.ink}">${esc(b.name)} · ${money(b.total)}</h1>
  ${conflict ? `<div style="background:#fbe6e4;color:#b42318;border-radius:12px;padding:12px 14px;font-family:${SANS};font-size:14px;margin-bottom:14px">⚠️ ${esc(conflict)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${kv('Fechas', `${cap(fdate(b.checkin))} → ${fdate(b.checkout)} (${b.nights} noches)`)}
    ${kv('Huéspedes', b.guests)}
    ${kv('Email', `<a href="mailto:${esc(b.email)}" style="color:${C.terra}">${esc(b.email)}</a>`)}
    ${kv('Teléfono', esc(b.phone || '—'))}
    ${b.country ? kv('País', esc(b.country)) : ''}
    ${b.notes ? kv('Comentarios', esc(b.notes)) : ''}
  </table>
  <div style="height:16px"></div>${linesTable(b, 'Total')}
  <div style="text-align:center;margin-top:22px">${btn(origin + '/admin', 'Abrir el panel')}${invoiceUrl ? btn(invoiceUrl, 'Factura', false) : ''}</div>
</td></tr>`;
  return shell(site, origin, inner, `${b.name} · ${b.checkin} → ${b.checkout} · ${money(b.total)}`);
}

// Compatibilidad con llamadas antiguas
export function bookingEmail(site, unit, b, forOwner = false, opts = {}) {
  const origin = opts.origin || '';
  return forOwner ? ownerEmail(site, unit, b, { origin, ...opts }) : guestEmail(site, unit, b, { origin, ...opts });
}
