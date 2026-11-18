// Emails opcionales con Resend (https://resend.com). Si no hay RESEND_API_KEY, no se envía nada.
import { money } from './pricing.js';

export async function sendMail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY || !to) return { skipped: true };
  const from = env.MAIL_FROM || 'Terracota Suites <reservas@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo }),
  });
  return { ok: res.ok };
}

const fdate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function bookingEmail(site, unit, b, forOwner = false) {
  const lines = JSON.parse(b.breakdown || '[]');
  const rows = lines.map(l => `<tr><td style="padding:4px 0;color:#57534e">${l.label}</td><td style="padding:4px 0;text-align:right">${money(l.amount)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f7f3ee;font-family:Georgia,serif;color:#292524">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#b5573b">${site.site_name || 'Terracota Suites'}</div>
    <h1 style="font-weight:normal;font-size:28px;margin:8px 0 20px">${forOwner ? 'Nueva reserva confirmada' : `¡Gracias, ${(b.name || '').split(' ')[0]}! Tu reserva está confirmada`}</h1>
    <div style="background:#fff;border-radius:14px;padding:22px;font-family:Arial,sans-serif;font-size:15px">
      <p style="margin:0 0 4px"><b>Referencia:</b> ${b.ref}</p>
      <p style="margin:0 0 4px"><b>Alojamiento:</b> ${unit.name}</p>
      <p style="margin:0 0 4px"><b>Entrada:</b> ${fdate(b.checkin)} ${site.checkin_time ? '· desde las ' + site.checkin_time : ''}</p>
      <p style="margin:0 0 4px"><b>Salida:</b> ${fdate(b.checkout)} ${site.checkout_time ? '· antes de las ' + site.checkout_time : ''}</p>
      <p style="margin:0 0 14px"><b>Huéspedes:</b> ${b.guests}</p>
      ${forOwner ? `<p style="margin:0 0 14px"><b>Cliente:</b> ${b.name} · ${b.email} · ${b.phone || ''} ${b.country ? '· ' + b.country : ''}<br>${b.notes ? '<i>' + b.notes + '</i>' : ''}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
        <tr><td style="padding-top:10px;border-top:1px solid #e7e5e4"><b>Total pagado</b></td><td style="padding-top:10px;border-top:1px solid #e7e5e4;text-align:right"><b>${money(b.total)}</b></td></tr></table>
    </div>
    ${forOwner ? '' : `<p style="font-family:Arial,sans-serif;font-size:14px;color:#57534e;line-height:1.6;margin-top:22px">Unos días antes de tu llegada te enviaremos las indicaciones para llegar y el acceso. Para cualquier cosa, responde a este email${site.phone ? ' o llámanos al ' + site.phone : ''}.</p>`}
  </div></body></html>`;
}
