// Facturas: numeración correlativa por año, enlace firmado y página imprimible (Guardar como PDF).
import { money, getUnit } from './pricing.js';
import { todayMadrid } from './dates.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fd = d => new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export const invoiceReady = s => !!(s.legal_name && s.legal_id && s.vat_rate !== '' && s.vat_rate != null);

async function linkSecret(db) {
  let row = await db.prepare("SELECT value FROM settings WHERE key = 'link_secret'").first();
  if (!row) {
    const v = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('link_secret', ?)").bind(v).run();
    row = await db.prepare("SELECT value FROM settings WHERE key = 'link_secret'").first();
  }
  return row.value;
}
export async function refToken(db, ref) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await linkSecret(db)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('factura:' + ref));
  return [...new Uint8Array(sig)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function invoiceUrl(db, origin, ref) { return `${origin}/factura/${ref}?t=${await refToken(db, ref)}`; }

// Asigna número de factura (una sola vez) a una reserva confirmada con importe
export async function ensureInvoice(db, b, site) {
  if (b.invoice_no) return b;
  if (!invoiceReady(site) || b.status !== 'confirmed' || b.source === 'bloqueo' || !(b.total > 0)) return b;
  const today = todayMadrid();
  const year = today.slice(0, 4);
  const key = 'invoice_seq_' + year;
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '0')").bind(key).run();
  const r = await db.prepare('UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = ? RETURNING value').bind(key).first();
  const no = `${(site.invoice_prefix || 'F').trim()}${year}-${String(r.value).padStart(4, '0')}`;
  await db.prepare('UPDATE bookings SET invoice_no = ?, invoice_date = ? WHERE id = ? AND invoice_no IS NULL').bind(no, today, b.id).run();
  const fresh = await db.prepare('SELECT invoice_no, invoice_date FROM bookings WHERE id = ?').bind(b.id).first();
  return { ...b, ...fresh };
}

export function invoiceHtml(site, unit, b, origin) {
  const lines = JSON.parse(b.breakdown || '[]');
  const rate = Number(site.vat_rate || 0);
  const base = rate > 0 ? Math.round(b.total / (1 + rate / 100)) : b.total;
  const vat = b.total - base;
  let bill = {};
  try { bill = JSON.parse(b.billing || '{}') || {}; } catch {}
  const client = [
    `<b>${esc(bill.name || b.name)}</b>`,
    bill.nif && 'NIF/CIF: ' + esc(bill.nif),
    bill.address && esc(bill.address).replace(/\n/g, '<br>'),
    !bill.name && b.email && esc(b.email),
  ].filter(Boolean).join('<br>');
  const issuer = [`<b>${esc(site.legal_name)}</b>`, 'NIF: ' + esc(site.legal_id), esc(site.fiscal_address || site.address || '').replace(/\n/g, '<br>'), site.license && 'Reg. turístico: ' + esc(site.license), site.email && esc(site.email)].filter(Boolean).join('<br>');
  const rows = lines.map(l => `<tr><td>${esc(l.label)}</td><td class="n">${money(l.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Factura ${esc(b.invoice_no)} · ${esc(site.site_name)}</title><meta name="robots" content="noindex">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
 :root{--terra:#b5573b;--ink:#2a211c;--ink2:#57493f;--muted:#8a7b70;--line:#e8dfd5;--sand:#f4ede4;--cream:#fbf8f4}
 *{box-sizing:border-box} body{margin:0;background:var(--sand);font-family:Manrope,Arial,sans-serif;color:var(--ink);font-size:14px;line-height:1.55}
 .bar{max-width:820px;margin:20px auto 0;display:flex;justify-content:flex-end;gap:10px;padding:0 16px}
 .bar button,.bar a{font:inherit;font-weight:700;border-radius:999px;padding:11px 20px;border:1.5px solid var(--terra);background:var(--terra);color:#fff;cursor:pointer;text-decoration:none}
 .bar a{background:#fff;color:var(--terra);border-color:var(--line)}
 .page{max-width:820px;margin:16px auto 40px;background:#fff;border-radius:22px;padding:54px 58px;box-shadow:0 20px 50px -30px rgba(60,30,10,.35)}
 header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid var(--ink);padding-bottom:22px}
 header img{width:130px;height:auto}
 h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:44px;letter-spacing:.06em;margin:0;text-align:right;line-height:1}
 .meta{text-align:right;color:var(--ink2);margin-top:8px}.meta b{color:var(--ink)}
 .parties{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}
 .lbl{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:6px}
 .stay{background:var(--cream);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:22px;color:var(--ink2)}
 table{width:100%;border-collapse:collapse} th{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:left;padding:0 0 10px;border-bottom:1.5px solid var(--line)}
 td{padding:10px 0;border-bottom:1px solid var(--line)} .n{text-align:right;white-space:nowrap}
 .tot{margin-left:auto;width:min(320px,100%);margin-top:16px} .tot td{border:0;padding:5px 0;color:var(--ink2)}
 .tot tr.big td{border-top:2px solid var(--ink);padding-top:12px;font-size:18px;font-weight:800;color:var(--ink)}
 .note{margin-top:26px;font-size:12.5px;color:var(--muted)} .paid{display:inline-block;margin-top:14px;background:#e6f2e3;color:#3f7a3a;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px}
 @media (max-width:640px){.page{padding:30px 22px;border-radius:0}.parties{grid-template-columns:1fr}h1{font-size:34px}}
 @media print{body{background:#fff}.bar{display:none}.page{box-shadow:none;margin:0;max-width:none;border-radius:0;padding:10mm 4mm}@page{size:A4;margin:12mm}}
</style></head><body>
<div class="bar"><a href="/">${esc(site.site_name)}</a><button onclick="window.print()">Descargar PDF / Imprimir</button></div>
<div class="page">
 <header><img src="/img/logo-email.png" alt="${esc(site.site_name)}"><div><h1>FACTURA</h1><div class="meta">Nº <b>${esc(b.invoice_no)}</b><br>Fecha: <b>${fd(b.invoice_date)}</b><br>Reserva: ${esc(b.ref)}</div></div></header>
 <div class="parties"><div><div class="lbl">Emisor</div>${issuer}</div><div><div class="lbl">Cliente</div>${client}</div></div>
 <div class="stay"><b>${esc(unit.name)}</b> · Estancia del ${fd(b.checkin)} al ${fd(b.checkout)} · ${b.nights} ${b.nights === 1 ? 'noche' : 'noches'} · ${b.guests} huéspedes</div>
 <table><thead><tr><th>Concepto</th><th class="n">Importe${rate > 0 ? ' (IVA incl.)' : ''}</th></tr></thead><tbody>${rows}</tbody></table>
 <table class="tot">
  ${rate > 0 ? `<tr><td>Base imponible</td><td class="n">${money(base)}</td></tr><tr><td>IVA ${String(rate).replace('.', ',')} %</td><td class="n">${money(vat)}</td></tr>` : `<tr><td>Base imponible</td><td class="n">${money(base)}</td></tr><tr><td>IVA</td><td class="n">Exento</td></tr>`}
  <tr class="big"><td>Total</td><td class="n">${money(b.total)}</td></tr>
 </table>
 ${b.paid ? `<div class="paid">✓ Pagado${b.stripe_payment ? ' con tarjeta' : ''}</div>` : ''}
 <div class="note">${rate > 0 ? '' : esc(site.vat_note || 'Operación exenta de IVA.') + '<br>'}${esc(site.legal_name)} · ${esc(site.legal_id)}</div>
</div></body></html>`;
}

// Página /factura/TS-XXXXXX?t=…
export async function serveInvoice(env, ref, token, origin, site) {
  const db = env.DB;
  if (!token || token !== (await refToken(db, ref))) return new Response('Enlace no válido', { status: 403 });
  let b = await db.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
  if (!b) return new Response('Factura no encontrada', { status: 404 });
  if (!invoiceReady(site)) return new Response('La factura aún no está disponible. Escríbenos y te la enviamos.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (b.status !== 'confirmed') return new Response('La factura estará disponible cuando la reserva esté confirmada.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  b = await ensureInvoice(db, b, site);
  if (!b.invoice_no) return new Response('Factura no disponible', { status: 404 });
  const unit = await getUnit(db, b.unit_id);
  return new Response(invoiceHtml(site, unit, b, origin), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Reserva inventada para enseñar el email y la factura (no se guarda ni gasta numeración)
export async function sampleBooking(db, unit, site) {
  const { quote } = await import('./pricing.js');
  const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let checkin = add(todayMadrid(), 21);
  while (new Date(checkin + 'T00:00:00Z').getUTCDay() !== 5) checkin = add(checkin, 1);   // un viernes
  const checkout = add(checkin, 2);
  const extras = (await db.prepare('SELECT id FROM extras WHERE active = 1 ORDER BY sort, id LIMIT 1').all()).results;
  let q = await quote(db, unit, { checkin, checkout, guests: 2, extras: extras.length ? { [extras[0].id]: 1 } : {} }, { admin: true });
  const lines = q.ok ? q.lines : [{ type: 'nights', label: '2 noches × 190,00 €', amount: 38000 }, { type: 'discount', label: 'Descuento 2+ noches (−25%)', amount: -9500 }];
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return { id: 0, ref: 'TS-MUESTRA', unit_id: unit.id, checkin, checkout, nights: 2, guests: 2, name: 'Lucía Martínez Pérez', email: 'lucia@ejemplo.com', phone: '600 000 000',
    total, breakdown: JSON.stringify(lines), status: 'confirmed', paid: 1, stripe_payment: 'pi_muestra', source: 'web',
    invoice_no: `${(site.invoice_prefix || 'F').trim()}${todayMadrid().slice(0, 4)}-MUESTRA`, invoice_date: todayMadrid(), billing: null };
}
