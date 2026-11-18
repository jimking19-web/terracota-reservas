// Motor de precios y disponibilidad. Todos los importes en céntimos (enteros).
import { addDays, diffDays, eachNight, isDate, todayMadrid, weekday } from './dates.js';

export async function getUnit(db, slugOrId) {
  const q = typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))
    ? db.prepare('SELECT * FROM units WHERE id = ?').bind(Number(slugOrId))
    : db.prepare('SELECT * FROM units WHERE slug = ?').bind(slugOrId);
  return q.first();
}

// Carga todo lo que afecta a un rango de noches [from, to)
export async function loadContext(db, unit, from, to, { excludeBookingId = null } = {}) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const [seasons, rules, bookings, blocks] = await db.batch([
    db.prepare('SELECT * FROM seasons WHERE unit_id = ? AND end_date >= ? AND start_date < ? ORDER BY priority DESC, id DESC').bind(unit.id, from, to),
    db.prepare('SELECT * FROM day_rules WHERE unit_id = ? AND date >= ? AND date < ?').bind(unit.id, from, to),
    db.prepare(`SELECT id, checkin, checkout, status, source, name FROM bookings
      WHERE unit_id = ? AND checkout > ? AND checkin < ?
      AND (status = 'confirmed' OR (status = 'pending' AND (expires_at IS NULL OR expires_at > ?)))`).bind(unit.id, from, to, now),
    db.prepare('SELECT * FROM external_blocks WHERE unit_id = ? AND end_date > ? AND start_date < ?').bind(unit.id, from, to),
  ]);
  const ruleMap = new Map(rules.results.map(r => [r.date, r]));
  const busy = new Set();
  for (const b of bookings.results) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    for (const d of eachNight(b.checkin, b.checkout)) busy.add(d);
  }
  for (const b of blocks.results) for (const d of eachNight(b.start_date, b.end_date)) busy.add(d);
  return { unit, seasons: seasons.results, ruleMap, busy, bookings: bookings.results, blocks: blocks.results };
}

const weekendSet = unit => new Set(String(unit.weekend_nights || '').split(',').filter(Boolean).map(Number));
const checkinSet = unit => new Set(String(unit.checkin_days ?? '0,1,2,3,4,5,6').split(',').filter(x => x !== '').map(Number));

// Información de una noche concreta
export function night(ctx, date) {
  const { unit } = ctx;
  const rule = ctx.ruleMap.get(date);
  const season = ctx.seasons.find(s => s.start_date <= date && s.end_date >= date) || null;
  const isWeekend = weekendSet(unit).has(weekday(date));

  let price, source;
  if (rule && rule.price != null) { price = rule.price; source = 'día'; }
  else if (season) {
    price = isWeekend && season.weekend_price != null ? season.weekend_price : season.price;
    source = season.name;
  } else {
    price = isWeekend && unit.weekend_price != null ? unit.weekend_price : unit.base_price;
    source = isWeekend && unit.weekend_price != null ? 'fin de semana' : 'base';
  }
  let minNights = unit.min_nights;
  if (season && season.min_nights != null) minNights = season.min_nights;
  if (rule && rule.min_nights != null) minNights = rule.min_nights;

  const closed = !!(rule && rule.closed);
  const busy = ctx.busy.has(date);
  const noCheckin = !!(rule && rule.no_checkin) || !checkinSet(unit).has(weekday(date));
  return { date, price, source, season: season ? season.name : null, isWeekend, minNights, closed, busy, free: !closed && !busy, noCheckin };
}

export function money(c) {
  return (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

// Validación y cálculo completo de una estancia
export async function quote(db, unit, { checkin, checkout, guests, promo }, opts = {}) {
  const errors = [];
  if (!isDate(checkin) || !isDate(checkout)) return { ok: false, error: 'Fechas no válidas' };
  const nights = diffDays(checkin, checkout);
  if (nights <= 0) return { ok: false, error: 'La salida debe ser posterior a la entrada' };
  guests = Math.max(1, parseInt(guests || 1, 10));
  if (guests > unit.max_guests) return { ok: false, error: `Máximo ${unit.max_guests} huéspedes` };

  const today = todayMadrid();
  const ahead = diffDays(today, checkin);
  if (!opts.admin) {
    if (ahead < 0) return { ok: false, error: 'La fecha de entrada ya ha pasado' };
    if (ahead < unit.min_advance_days) return { ok: false, error: `Se reserva con al menos ${unit.min_advance_days} días de antelación` };
    if (ahead > unit.max_advance_days) return { ok: false, error: 'Fechas aún no disponibles para reservar' };
  }
  if (nights > unit.max_nights) return { ok: false, error: `Estancia máxima de ${unit.max_nights} noches` };

  const ctx = await loadContext(db, unit, checkin, checkout, opts);
  const list = eachNight(checkin, checkout).map(d => night(ctx, d));
  const first = list[0];
  if (!opts.admin) {
    if (first.noCheckin) errors.push('No se admiten entradas ese día');
    if (nights < first.minNights) errors.push(`Estancia mínima de ${first.minNights} noches para esas fechas`);
  }
  if (list.some(n => !n.free)) errors.push('Alguna de las noches no está disponible');
  if (errors.length) return { ok: false, error: errors[0], errors };

  const lines = [];
  // Agrupar noches por precio para que el desglose sea legible
  const groups = [];
  for (const n of list) {
    const g = groups.find(x => x.price === n.price);
    if (g) g.count++; else groups.push({ price: n.price, count: 1 });
  }
  const nightsTotal = list.reduce((a, n) => a + n.price, 0);
  for (const g of groups) lines.push({ type: 'nights', label: `${g.count} ${g.count === 1 ? 'noche' : 'noches'} × ${money(g.price)}`, amount: g.price * g.count });

  const extraGuests = Math.max(0, guests - unit.base_guests);
  const extra = extraGuests * unit.extra_guest_fee * nights;
  if (extra > 0) lines.push({ type: 'extra', label: `${extraGuests} ${extraGuests === 1 ? 'huésped extra' : 'huéspedes extra'} × ${nights} noches × ${money(unit.extra_guest_fee)}`, amount: extra });

  const lodging = nightsTotal + extra;
  let discounts = 0;
  const pct = (label, p) => {
    if (!p || p <= 0) return;
    const amt = -Math.round(lodging * p / 100);
    discounts += amt;
    lines.push({ type: 'discount', label: `${label} (−${p}%)`, amount: amt });
  };
  // Descuento por duración: se aplica el mejor tramo que cumpla (por noches, semanal o mensual)
  const tiers = [];
  try { for (const t of JSON.parse(unit.stay_discounts || '[]')) if (t.nights > 0 && t.pct > 0) tiers.push({ n: Number(t.nights), p: Number(t.pct), label: `Descuento ${t.nights}+ noches` }); } catch {}
  if (unit.weekly_discount > 0) tiers.push({ n: 7, p: unit.weekly_discount, label: 'Descuento estancia semanal' });
  if (unit.monthly_discount > 0) tiers.push({ n: 28, p: unit.monthly_discount, label: 'Descuento estancia mensual' });
  const best = tiers.filter(t => nights >= t.n).sort((a, b) => b.p - a.p || b.n - a.n)[0];
  if (best) pct(best.label, best.p);
  if (unit.last_minute_days > 0 && ahead <= unit.last_minute_days) pct('Oferta última hora', unit.last_minute_discount);
  else if (unit.early_bird_days > 0 && ahead >= unit.early_bird_days) pct('Reserva anticipada', unit.early_bird_discount);

  let promoApplied = null, promoError = null;
  if (promo && String(promo).trim()) {
    const code = String(promo).trim().toUpperCase();
    const p = await db.prepare('SELECT * FROM promo_codes WHERE upper(code) = ? AND active = 1').bind(code).first();
    if (!p) promoError = 'Código no válido';
    else if (p.unit_id && p.unit_id !== unit.id) promoError = 'Código no válido para este alojamiento';
    else if (p.valid_from && checkin < p.valid_from) promoError = 'Código no válido para esas fechas';
    else if (p.valid_to && checkin > p.valid_to) promoError = 'Código caducado para esas fechas';
    else if (p.min_nights && nights < p.min_nights) promoError = `El código requiere mínimo ${p.min_nights} noches`;
    else if (p.max_uses != null && p.uses >= p.max_uses) promoError = 'Código agotado';
    else {
      const base = lodging + discounts;
      let amt = p.kind === 'fixed' ? p.value : Math.round(base * p.value / 100);
      amt = Math.min(amt, base);
      if (amt > 0) {
        discounts -= amt;
        lines.push({ type: 'promo', label: `Código ${p.code}${p.kind === 'pct' ? ` (−${p.value}%)` : ''}`, amount: -amt });
        promoApplied = p.code;
      }
    }
  }

  if (unit.cleaning_fee > 0) lines.push({ type: 'cleaning', label: 'Limpieza', amount: unit.cleaning_fee });
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return {
    ok: true, unit: unit.slug, checkin, checkout, nights, guests, lines, total,
    totalFormatted: money(total), promo: promoApplied, promoError,
    nightly: list.map(n => ({ date: n.date, price: n.price, source: n.source })),
  };
}

// Calendario público: estado y precio de cada día
export async function calendar(db, unit, from, days) {
  const to = addDays(from, days + 1);
  const ctx = await loadContext(db, unit, from, to);
  const today = todayMadrid();
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i);
    const n = night(ctx, d);
    const ahead = diffDays(today, d);
    const bookable = ahead >= unit.min_advance_days && ahead <= unit.max_advance_days;
    out.push({ d, p: n.price, m: n.minNights, f: n.free && ahead >= 0 ? 1 : 0, ci: n.free && bookable && !n.noCheckin ? 1 : 0 });
  }
  return out;
}
