// Utilidades de fecha. Todo se trabaja como 'YYYY-MM-DD' en UTC para evitar líos de horario.
export const DAY = 86400000;

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
}
export function toDate(s) { return new Date(s + 'T00:00:00Z'); }
export function fmt(d) { return d.toISOString().slice(0, 10); }
export function addDays(s, n) { return fmt(new Date(toDate(s).getTime() + n * DAY)); }
export function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
export function weekday(s) { return toDate(s).getUTCDay(); }

// "Hoy" en hora de España
export function todayMadrid() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function eachNight(checkin, checkout) {
  const out = [];
  for (let d = checkin; d < checkout; d = addDays(d, 1)) out.push(d);
  return out;
}
