// Estadísticas de visitas propias: sin cookies, sin guardar IPs ni datos personales.
// El visitante se identifica con un hash diario (IP + navegador + sal secreta), que cambia cada día.

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch|go-http/i;
const TYPES = new Set(['visita', 'seccion', 'galeria', 'foto', 'fechas', 'reservar', 'pago', 'whatsapp', 'contacto', 'faq', 'salida', 'codigo']);

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function getSalt(db) {
  let row = await db.prepare("SELECT value FROM settings WHERE key = 'analytics_salt'").first();
  if (row) return row.value;
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('analytics_salt', ?)").bind(salt).run();
  return (await db.prepare("SELECT value FROM settings WHERE key = 'analytics_salt'").first()).value;
}

function refDomain(ref, host) {
  try { const u = new URL(ref); if (u.host === host) return ''; return u.host.replace(/^www\./, '').replace(/^l\.|^lm\.|^m\./, ''); } catch { return ''; }
}

export async function track(req, env, url) {
  const ua = req.headers.get('User-Agent') || '';
  if (BOT.test(ua) || /(?:^|; )ts_admin=/.test(req.headers.get('Cookie') || '')) return new Response(null, { status: 204 });
  let events;
  try { const j = JSON.parse(await req.text()); events = Array.isArray(j) ? j : [j]; } catch { return new Response(null, { status: 204 }); }
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
  const ts = now.toISOString().replace('T', ' ').slice(0, 19);
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const visitor = await sha(`${day}|${ip}|${ua}|${await getSalt(env.DB)}`);
  const country = req.cf?.country || '';
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'móvil' : 'ordenador';
  const stmts = [];
  for (const e of events.slice(0, 20)) {
    if (!e || !TYPES.has(e.t)) continue;
    const session = String(e.s || '').slice(0, 24);
    if (!session) continue;
    let detail = e.d == null ? '' : String(e.d).slice(0, 160);
    let ref = '';
    if (e.t === 'visita') {
      const p = e.d && typeof e.d === 'object' ? e.d : {};
      ref = (p.utm ? `utm:${String(p.utm).slice(0, 40)}` : refDomain(p.ref || '', url.host)).slice(0, 80);
      detail = String(p.lang || '').slice(0, 10);
    }
    stmts.push(env.DB.prepare('INSERT INTO analytics (ts, day, visitor, session, type, detail, ref, country, device) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(ts, day, visitor, session, e.t, detail, ref, country, device));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return new Response(null, { status: 204 });
}

const COUNTRY = { ES: 'España', GB: 'Reino Unido', FR: 'Francia', DE: 'Alemania', IT: 'Italia', PT: 'Portugal', NL: 'Países Bajos', BE: 'Bélgica', US: 'Estados Unidos', IE: 'Irlanda', CH: 'Suiza', MX: 'México', AR: 'Argentina', CO: 'Colombia' };
const SOURCE = { 'google.com': 'Google', 'google.es': 'Google', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'airbnb.es': 'Airbnb', 'airbnb.com': 'Airbnb', 'booking.com': 'Booking', 'bing.com': 'Bing', 't.co': 'X / Twitter', 'wa.me': 'WhatsApp', 'web.whatsapp.com': 'WhatsApp', 'tiktok.com': 'TikTok', 'duckduckgo.com': 'DuckDuckGo' };

export async function stats(db, days) {
  days = Math.min(400, Math.max(1, days));
  const from = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() - (days - 1) * 86400000));
  const q = (sql, ...a) => db.prepare(sql).bind(from, ...a);
  const [perDay, totals, time, funnel, sources, countries, devices, sections, gallery, photos, faqs, months, nightsQ, contact, bookings] = await db.batch([
    q("SELECT day, count(DISTINCT visitor) v, count(DISTINCT CASE WHEN type='visita' THEN session END) s FROM analytics WHERE day >= ? GROUP BY day ORDER BY day"),
    q("SELECT count(DISTINCT visitor) visitors, count(DISTINCT CASE WHEN type='visita' THEN session END) sessions FROM analytics WHERE day >= ?"),
    q("SELECT avg(m) avg, count(*) n FROM (SELECT session, max(CAST(detail AS INTEGER)) m FROM analytics WHERE day >= ? AND type='salida' GROUP BY session) WHERE m BETWEEN 1 AND 7200"),
    q(`SELECT
        count(DISTINCT CASE WHEN type='visita' THEN session END) visita,
        count(DISTINCT CASE WHEN type='seccion' AND detail='reservar' THEN session END) calendario,
        count(DISTINCT CASE WHEN type='fechas' THEN session END) fechas,
        count(DISTINCT CASE WHEN type='reservar' THEN session END) reservar,
        count(DISTINCT CASE WHEN type='pago' THEN session END) pago
      FROM analytics WHERE day >= ?`),
    q("SELECT ref, count(*) n FROM analytics WHERE day >= ? AND type='visita' GROUP BY ref ORDER BY n DESC LIMIT 12"),
    q("SELECT country, count(DISTINCT visitor) n FROM analytics WHERE day >= ? GROUP BY country ORDER BY n DESC LIMIT 10"),
    q("SELECT device, count(DISTINCT session) n FROM analytics WHERE day >= ? AND type='visita' GROUP BY device ORDER BY n DESC"),
    q("SELECT detail, count(DISTINCT session) n FROM analytics WHERE day >= ? AND type='seccion' GROUP BY detail ORDER BY n DESC"),
    q("SELECT detail, count(*) n FROM analytics WHERE day >= ? AND type='galeria' GROUP BY detail ORDER BY n DESC"),
    q("SELECT a.detail, p.caption, p.src, count(*) n FROM analytics a LEFT JOIN photos p ON p.id = CAST(a.detail AS INTEGER) WHERE a.day >= ? AND a.type='foto' GROUP BY a.detail ORDER BY n DESC LIMIT 8"),
    q("SELECT detail, count(*) n FROM analytics WHERE day >= ? AND type='faq' GROUP BY detail ORDER BY n DESC LIMIT 10"),
    q("SELECT substr(detail,1,7) m, count(DISTINCT session) n FROM analytics WHERE day >= ? AND type='fechas' GROUP BY m ORDER BY m"),
    q("SELECT CAST(substr(detail, instr(detail,'|')+1) AS INTEGER) nights, count(*) n FROM analytics WHERE day >= ? AND type='fechas' GROUP BY nights ORDER BY nights"),
    q("SELECT type, detail, count(*) n FROM analytics WHERE day >= ? AND type IN ('whatsapp','contacto') GROUP BY type, detail ORDER BY n DESC"),
    db.prepare("SELECT count(*) n, coalesce(sum(total),0) total FROM bookings WHERE source='web' AND status='confirmed' AND substr(created_at,1,10) >= ?").bind(from),
  ]);
  const r = x => x.results;
  return {
    ok: true, days, from,
    perDay: r(perDay), totals: r(totals)[0], avgTime: Math.round(r(time)[0]?.avg || 0),
    funnel: { ...r(funnel)[0], reservas: r(bookings)[0].n, ingresos: r(bookings)[0].total },
    sources: r(sources).map(x => ({ name: !x.ref ? 'Directo / enlace guardado' : x.ref.startsWith('utm:') ? `Campaña: ${x.ref.slice(4)}` : (SOURCE[x.ref] || x.ref), n: x.n })),
    countries: r(countries).map(x => ({ name: COUNTRY[x.country] || x.country || 'Desconocido', n: x.n })),
    devices: r(devices), sections: r(sections), gallery: r(gallery), photos: r(photos), faqs: r(faqs),
    months: r(months), nights: r(nightsQ), contact: r(contact),
  };
}

export async function cleanup(db) {
  await db.prepare("DELETE FROM analytics WHERE day < date('now', '-400 days')").run();
}
