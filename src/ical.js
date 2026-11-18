// Importación y exportación iCal (Airbnb, Booking, Google Calendar...)
import { addDays, eachNight, todayMadrid } from './dates.js';

function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }

function parseDate(v) {
  // 20261205 | 20261205T140000Z | 20261205T140000
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseIcal(text) {
  const events = [];
  let cur = null;
  for (const raw of unfold(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; }
    else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const val = line.slice(idx + 1);
      if (key === 'DTSTART') cur.start = parseDate(val);
      else if (key === 'DTEND') cur.end = parseDate(val);
      else if (key === 'SUMMARY') cur.summary = val.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      else if (key === 'UID') cur.uid = val;
      else if (key === 'STATUS') cur.status = val;
    }
  }
  return events
    .filter(e => e.status !== 'CANCELLED')
    .map(e => ({ ...e, end: e.end && e.end > e.start ? e.end : addDays(e.start, 1) }));
}

export async function syncFeed(db, feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'TerracotaReservas/1.0' }, cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('La URL no devuelve un calendario iCal');
    const today = todayMadrid();
    const events = parseIcal(text).filter(e => e.end > today);
    const stmts = [db.prepare('DELETE FROM external_blocks WHERE feed_id = ?').bind(feed.id)];
    for (const e of events) {
      stmts.push(db.prepare('INSERT INTO external_blocks (feed_id, unit_id, start_date, end_date, summary) VALUES (?, ?, ?, ?, ?)')
        .bind(feed.id, feed.unit_id, e.start, e.end, (e.summary || '').slice(0, 120)));
    }
    stmts.push(db.prepare("UPDATE ical_feeds SET last_sync = datetime('now'), last_status = ? WHERE id = ?").bind(`OK · ${events.length} bloqueos`, feed.id));
    await db.batch(stmts);
    return { ok: true, count: events.length };
  } catch (err) {
    await db.prepare("UPDATE ical_feeds SET last_sync = datetime('now'), last_status = ? WHERE id = ?").bind('Error: ' + err.message, feed.id).run();
    return { ok: false, error: err.message };
  }
}

export async function syncAll(db) {
  const feeds = (await db.prepare('SELECT * FROM ical_feeds').all()).results;
  const out = [];
  for (const f of feeds) out.push({ id: f.id, name: f.name, ...(await syncFeed(db, f)) });
  return out;
}

function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n'); }
const ical = d => d.replace(/-/g, '');

// Exporta reservas propias + días cerrados. NO reexporta lo importado de otros canales
// (evita bucles entre Airbnb y Booking; cada canal debe importar el calendario del otro si se quiere).
export async function exportIcal(db, unit, host) {
  const today = todayMadrid();
  const [bookings, closed] = await db.batch([
    db.prepare(`SELECT ref, checkin, checkout, source FROM bookings WHERE unit_id = ? AND checkout >= ?
      AND (status = 'confirmed' OR (status = 'pending' AND (expires_at IS NULL OR expires_at > datetime('now'))))`).bind(unit.id, today),
    db.prepare('SELECT date FROM day_rules WHERE unit_id = ? AND closed = 1 AND date >= ? ORDER BY date').bind(unit.id, today),
  ]);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terracota Suites//Reservas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(unit.name)}`];
  for (const b of bookings.results) {
    lines.push('BEGIN:VEVENT', `UID:${b.ref}@${host}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ical(b.checkin)}`, `DTEND;VALUE=DATE:${ical(b.checkout)}`,
      `SUMMARY:${b.source === 'bloqueo' ? 'Bloqueado' : 'Reservado'}`, 'END:VEVENT');
  }
  // Agrupar días cerrados consecutivos
  let run = null;
  const flush = () => { if (run) lines.push('BEGIN:VEVENT', `UID:closed-${run.s}-${unit.id}@${host}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ical(run.s)}`, `DTEND;VALUE=DATE:${ical(addDays(run.e, 1))}`, 'SUMMARY:Cerrado', 'END:VEVENT'); };
  for (const { date } of closed.results) {
    if (run && addDays(run.e, 1) === date) run.e = date; else { flush(); run = { s: date, e: date }; }
  }
  flush();
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export { eachNight };
