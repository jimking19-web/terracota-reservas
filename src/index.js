// Terracota Suites · Worker principal (web + API + panel + tareas programadas)
import { addDays, diffDays, isDate, todayMadrid } from './dates.js';
import { calendar, getUnit, loadContext, night, quote, money } from './pricing.js';
import { exportIcal, syncAll, syncFeed } from './ical.js';
import { createCheckout, verifyWebhook } from './stripe.js';
import { bookingEmail, sendMail } from './mail.js';

const HOLD_MINUTES = 31;          // Stripe exige mínimo 30 min de validez en Checkout
const REQUEST_HOLD_HOURS = 48;    // si no hay Stripe: la solicitud bloquea 48 h hasta que la confirmes

export const DEFAULT_SETTINGS = {
  site_name: 'Terracota Suites',
  tagline: 'Descanso, vino y calma en el Noroeste murciano',
  intro: 'Un refugio pensado para desconectar: luz cálida, materiales nobles y una alberca para los días de sol, a un paso de las bodegas de Bullas.',
  description: 'Terracota Suites es un alojamiento rural cuidado al detalle en Bullas (Murcia). Cada estancia empieza con una limpieza a fondo y pequeños detalles de bienvenida para que solo tengas que preocuparte de descansar.\n\nLa zona es perfecta para recorrer la Ruta del Vino de Bullas, el Salto del Usero, Cehegín o Caravaca de la Cruz.',
  amenities: 'Café e infusiones\nBotellitas de agua de cortesía\nBotella de vino de bienvenida\nAlberca privada\nVelas aromáticas\nLimpieza a fondo antes de tu llegada\nWiFi\nAire acondicionado',
  highlights: 'Superanfitriones en Airbnb|Valorados por nuestros huéspedes\nReserva directa|El mejor precio, sin comisiones\nAlberca|Para refrescarte en verano',
  address: 'Bullas, Región de Murcia',
  location_text: 'A 5 minutos del centro de Bullas, capital del vino del Noroeste murciano. Murcia a 50 minutos, Caravaca de la Cruz a 20 minutos.',
  map_query: 'Bullas, Murcia',
  phone: '', email: '', whatsapp: '', instagram: '',
  checkin_time: '16:00', checkout_time: '12:00',
  house_rules: 'No se permite fumar en el interior\nNo se admiten fiestas ni eventos\nRespeta el descanso de los vecinos a partir de las 23:00',
  cancellation: 'Cancelación gratuita hasta 14 días antes de la llegada. Después, no reembolsable.',
  license: '',
  legal_name: '', legal_id: '',
  superhost: '1',
  hero_photo: '',
};

// ---------- utilidades HTTP ----------
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
const body = async req => { try { return await req.json(); } catch { return {}; } };
const cents = v => (v === '' || v == null ? null : Math.round(Number(String(v).replace(',', '.')) * 100));
const intOrNull = v => (v === '' || v == null ? null : parseInt(v, 10));
const randomToken = (n = 24) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
function makeRef() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'TS-' + [...crypto.getRandomValues(new Uint8Array(6))].map(b => a[b % a.length]).join('');
}
const sqlNow = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);

// Claves guardadas en D1 que NUNCA se envían al navegador
const SECRET_KEYS = ['admin_hash', 'setup_code', 'stripe_secret_key', 'stripe_webhook_secret', 'stripe_webhook_id', 'stripe_account'];

async function getSettings(db, withSecrets = false) {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()).results;
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (withSecrets || !SECRET_KEYS.includes(r.key)) s[r.key] = r.value;
  return s;
}
async function setSetting(db, key, value) {
  if (value == null) return db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}

// Mezcla los secretos de Cloudflare con los configurados desde el panel (Cloudflare tiene prioridad)
async function withConfig(env) {
  const rows = (await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${SECRET_KEYS.map(() => '?').join(',')})`).bind(...SECRET_KEYS).all()).results;
  const c = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    ...env,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || c.stripe_secret_key || '',
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || c.stripe_webhook_secret || '',
    ADMIN_HASH: c.admin_hash || '', SETUP_CODE: c.setup_code || '', STRIPE_ACCOUNT: c.stripe_account || '',
    STRIPE_FROM_PANEL: !env.STRIPE_SECRET_KEY && !!c.stripe_secret_key,
  };
}

// Contraseña con PBKDF2 (nunca se guarda en claro)
async function hashPassword(pw, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(bits)}`;
}
async function checkPassword(pw, stored) {
  if (!stored || !pw) return false;
  const [salt] = stored.split(':');
  return safeEqual(await hashPassword(pw, salt), stored);
}

const PUBLIC_UNIT_FIELDS = ['id', 'slug', 'name', 'summary', 'description', 'max_guests', 'base_guests', 'bedrooms', 'beds', 'bathrooms', 'base_price', 'min_nights', 'cleaning_fee', 'extra_guest_fee', 'max_advance_days'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

// ---------- autenticación del panel ----------
function getCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function isAdmin(req, env) {
  const t = getCookie(req, 'ts_admin');
  if (!t) return false;
  const row = await env.DB.prepare('SELECT token FROM sessions WHERE token = ? AND expires_at > ?').bind(t, sqlNow()).first();
  return !!row;
}
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------- confirmación de reservas ----------
async function confirmBooking(env, booking, paymentId) {
  const db = env.DB;
  const unit = await getUnit(db, booking.unit_id);
  // ¿Se ha solapado mientras pagaba? (p. ej. llegó una reserva por iCal)
  const ctx = await loadContext(db, unit, booking.checkin, booking.checkout, { excludeBookingId: booking.id });
  const conflict = [];
  for (let d = booking.checkin; d < booking.checkout; d = addDays(d, 1)) if (!night(ctx, d).free) conflict.push(d);
  const note = conflict.length ? `⚠️ CONFLICTO: noches ocupadas por otra reserva/bloqueo (${conflict.join(', ')}). Revisar.` : booking.internal_note;
  await db.prepare("UPDATE bookings SET status = 'confirmed', paid = 1, stripe_payment = ?, internal_note = ?, expires_at = NULL WHERE id = ?")
    .bind(paymentId || booking.stripe_payment, note, booking.id).run();
  if (booking.promo_code) await db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE upper(code) = upper(?)').bind(booking.promo_code).run();
  const site = await getSettings(db);
  const b = { ...booking, status: 'confirmed' };
  const ownerMail = env.OWNER_EMAIL || site.email;
  await Promise.all([
    sendMail(env, { to: b.email, subject: `Reserva confirmada · ${site.site_name} · ${b.ref}`, html: bookingEmail(site, unit, b), replyTo: ownerMail || undefined }),
    sendMail(env, { to: ownerMail, subject: `${conflict.length ? '⚠️ ' : ''}Nueva reserva ${b.ref} · ${b.checkin} → ${b.checkout} · ${money(b.total)}`, html: bookingEmail(site, unit, b, true), replyTo: b.email }),
  ]).catch(() => {});
}

// ---------- API pública ----------
async function publicApi(req, env, url, path) {
  const db = env.DB;

  if (path === '/api/site' && req.method === 'GET') {
    const [settings, units, photos] = await Promise.all([
      getSettings(db),
      db.prepare('SELECT * FROM units WHERE active = 1 ORDER BY sort, id').all(),
      db.prepare('SELECT id, unit_id, caption FROM photos ORDER BY sort, id').all(),
    ]);
    return json({ settings, units: units.results.map(u => pick(u, PUBLIC_UNIT_FIELDS)), photos: photos.results, payments: !!env.STRIPE_SECRET_KEY, today: todayMadrid() },
      200, { 'Cache-Control': 'public, max-age=30' });
  }

  if (path === '/api/calendar' && req.method === 'GET') {
    const unit = await getUnit(db, url.searchParams.get('unit') || 1);
    if (!unit || !unit.active) return bad('Alojamiento no encontrado', 404);
    let from = url.searchParams.get('from');
    if (!isDate(from)) from = todayMadrid().slice(0, 8) + '01';
    const days = Math.min(400, Math.max(1, parseInt(url.searchParams.get('days') || '62', 10)));
    return json({ ok: true, from, days: await calendar(db, unit, from, days) });
  }

  if (path === '/api/quote' && req.method === 'POST') {
    const b = await body(req);
    const unit = await getUnit(db, b.unit || 1);
    if (!unit || !unit.active) return bad('Alojamiento no encontrado', 404);
    return json(await quote(db, unit, b));
  }

  if (path === '/api/book' && req.method === 'POST') {
    const b = await body(req);
    if (b.website) return bad('Error');                              // honeypot anti-bots
    const name = String(b.name || '').trim(), email = String(b.email || '').trim(), phone = String(b.phone || '').trim();
    if (name.length < 3) return bad('Indica tu nombre completo');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Email no válido');
    if (phone.replace(/\D/g, '').length < 6) return bad('Indica un teléfono de contacto');
    if (!b.accept) return bad('Debes aceptar las condiciones');
    const unit = await getUnit(db, b.unit || 1);
    if (!unit || !unit.active) return bad('Alojamiento no encontrado', 404);
    const q = await quote(db, unit, b);
    if (!q.ok) return json(q, 409);
    if (b.promo && q.promoError) return bad(q.promoError);
    if (b.expectedTotal != null && Number(b.expectedTotal) !== q.total) return json({ ok: false, error: 'El precio ha cambiado, revisa el nuevo importe', quote: q }, 409);

    const usingStripe = !!env.STRIPE_SECRET_KEY;
    const expiresMs = Date.now() + (usingStripe ? HOLD_MINUTES * 60000 : REQUEST_HOLD_HOURS * 3600000);
    const booking = {
      ref: makeRef(), unit_id: unit.id, checkin: q.checkin, checkout: q.checkout, nights: q.nights, guests: q.guests,
      name: name.slice(0, 120), email: email.slice(0, 160), phone: phone.slice(0, 40), country: String(b.country || '').slice(0, 60),
      notes: String(b.notes || '').slice(0, 1000), total: q.total, breakdown: JSON.stringify(q.lines), promo_code: q.promo,
    };
    const ins = await db.prepare(`INSERT INTO bookings (ref, unit_id, checkin, checkout, nights, guests, name, email, phone, country, notes, total, breakdown, promo_code, status, source, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 'web', ?)`).bind(booking.ref, booking.unit_id, booking.checkin, booking.checkout, booking.nights, booking.guests,
      booking.name, booking.email, booking.phone, booking.country, booking.notes, booking.total, booking.breakdown, booking.promo_code, sqlNow(expiresMs - Date.now())).run();
    booking.id = ins.meta.last_row_id;

    // Doble comprobación contra carreras: si otra reserva entró a la vez, anulamos esta
    const ctx = await loadContext(db, unit, booking.checkin, booking.checkout, { excludeBookingId: booking.id });
    for (let d = booking.checkin; d < booking.checkout; d = addDays(d, 1)) {
      if (!night(ctx, d).free) {
        const other = ctx.bookings.find(x => x.checkin <= d && x.checkout > d);
        if (!other || other.id < booking.id) {
          await db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").bind(booking.id).run();
          return bad('Estas fechas se acaban de reservar. Elige otras, por favor.', 409);
        }
      }
    }

    if (!usingStripe) {
      const site = await getSettings(db);
      await sendMail(env, { to: env.OWNER_EMAIL || site.email, subject: `Solicitud de reserva ${booking.ref} · ${booking.checkin} → ${booking.checkout}`, html: bookingEmail(site, unit, booking, true), replyTo: booking.email }).catch(() => {});
      return json({ ok: true, ref: booking.ref, mode: 'request', redirect: `/reserva?ref=${booking.ref}` });
    }
    try {
      const site = await getSettings(db);
      const session = await createCheckout(env, { booking, unit, origin: url.origin, siteName: site.site_name, expiresAt: expiresMs });
      await db.prepare('UPDATE bookings SET stripe_session = ? WHERE id = ?').bind(session.id, booking.id).run();
      return json({ ok: true, ref: booking.ref, mode: 'stripe', redirect: session.url });
    } catch (e) {
      await db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").bind(booking.id).run();
      return bad('No se pudo iniciar el pago: ' + e.message, 502);
    }
  }

  let m;
  if ((m = path.match(/^\/api\/booking\/(TS-[A-Z0-9]{6})$/)) && req.method === 'GET') {
    const b = await db.prepare('SELECT b.*, u.name AS unit_name FROM bookings b JOIN units u ON u.id = b.unit_id WHERE ref = ?').bind(m[1]).first();
    if (!b) return bad('Reserva no encontrada', 404);
    // Si el huésped vuelve de Stripe antes que el webhook, consultamos la sesión directamente
    if (b.status === 'pending' && b.stripe_session && env.STRIPE_SECRET_KEY) {
      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${b.stripe_session}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
        const s = await r.json();
        if (s.payment_status === 'paid') { await confirmBooking(env, b, s.payment_intent); b.status = 'confirmed'; }
      } catch {}
    }
    const isExpired = b.status === 'pending' && b.expires_at && b.expires_at < sqlNow();
    return json({ ok: true, ref: b.ref, unit: b.unit_name, checkin: b.checkin, checkout: b.checkout, nights: b.nights, guests: b.guests,
      name: (b.name || '').split(' ')[0], total: b.total, lines: JSON.parse(b.breakdown || '[]'),
      status: isExpired ? 'expired' : b.status, mode: b.stripe_session ? 'stripe' : 'request' });
  }

  if (path === '/api/stripe/webhook' && req.method === 'POST') {
    const payload = await req.text();
    if (!(await verifyWebhook(env, payload, req.headers.get('Stripe-Signature')))) return bad('Firma no válida', 400);
    const evt = JSON.parse(payload);
    const s = evt.data?.object || {};
    const ref = s.metadata?.ref || s.client_reference_id;
    if (ref) {
      const b = await db.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
      if (b) {
        if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid' && b.status !== 'confirmed') {
          await confirmBooking(env, b, s.payment_intent);
        } else if ((evt.type === 'checkout.session.expired' || evt.type === 'checkout.session.async_payment_failed') && b.status === 'pending') {
          await db.prepare("UPDATE bookings SET status = 'expired' WHERE id = ?").bind(b.id).run();
        }
      }
    }
    return json({ received: true });
  }

  return null;
}

// ---------- API del panel ----------
async function adminApi(req, env, url, path) {
  const db = env.DB;
  const newSession = async () => {
    const token = randomToken();
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(sqlNow()),
      db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').bind(token, sqlNow(30 * 86400000)),
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': `ts_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}` });
  };
  const hasPassword = !!(env.ADMIN_PASSWORD || env.ADMIN_HASH);
  if (path === '/api/admin/status' && req.method === 'GET') return json({ ok: true, setup: !hasPassword });
  if (path === '/api/admin/setup' && req.method === 'POST') {
    const { code, password } = await body(req);
    if (hasPassword) return bad('La contraseña ya está creada', 409);
    if (!env.SETUP_CODE || !code || !(await safeEqual(String(code).trim().toUpperCase(), env.SETUP_CODE))) { await new Promise(r => setTimeout(r, 800)); return bad('Código de activación incorrecto', 401); }
    if (!password || String(password).length < 8) return bad('La contraseña debe tener al menos 8 caracteres');
    await setSetting(db, 'admin_hash', await hashPassword(String(password)));
    await setSetting(db, 'setup_code', null);
    return newSession();
  }
  if (path === '/api/admin/login' && req.method === 'POST') {
    const { password } = await body(req);
    if (!hasPassword) return bad('Primero crea tu contraseña', 409);
    const ok = env.ADMIN_PASSWORD ? await safeEqual(String(password || ''), env.ADMIN_PASSWORD) : await checkPassword(String(password || ''), env.ADMIN_HASH);
    if (!ok) { await new Promise(r => setTimeout(r, 800)); return bad('Contraseña incorrecta', 401); }
    return newSession();
  }
  if (path === '/api/admin/logout') {
    const t = getCookie(req, 'ts_admin');
    if (t) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(t).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'ts_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (!(await isAdmin(req, env))) return bad('No autorizado', 401);

  const b = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await body(req) : {};
  let m;

  if (path === '/api/admin/password' && req.method === 'POST') {
    if (env.ADMIN_PASSWORD) return bad('La contraseña está fijada en Cloudflare (ADMIN_PASSWORD); cámbiala allí');
    if (!(await checkPassword(String(b.current || ''), env.ADMIN_HASH))) return bad('La contraseña actual no es correcta', 401);
    if (!b.password || String(b.password).length < 8) return bad('La nueva contraseña debe tener al menos 8 caracteres');
    await setSetting(db, 'admin_hash', await hashPassword(String(b.password)));
    await db.prepare('DELETE FROM sessions WHERE token != ?').bind(getCookie(req, 'ts_admin')).run();
    return json({ ok: true });
  }

  // Conectar Stripe desde el panel: valida la clave y crea el webhook automáticamente
  if (path === '/api/admin/stripe' && req.method === 'POST') {
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_FROM_PANEL) return bad('Stripe ya está configurado en Cloudflare');
    const key = String(b.key || '').trim();
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) return bad('Esa no parece una clave secreta de Stripe (empieza por sk_test_ o sk_live_)');
    const sreq = async (method, p, params) => {
      const r = await fetch('https://api.stripe.com/v1' + p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params ? new URLSearchParams(params) : undefined });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Error de Stripe'); return j;
    };
    try {
      const acct = await sreq('GET', '/account');
      const hookUrl = `${url.origin}/api/stripe/webhook`;
      const existing = await sreq('GET', '/webhook_endpoints?limit=100');
      for (const w of existing.data) if (w.url === hookUrl) await sreq('DELETE', `/webhook_endpoints/${w.id}`);
      const params = new URLSearchParams({ url: hookUrl, description: 'Terracota Suites · reservas web' });
      for (const e of ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']) params.append('enabled_events[]', e);
      const hook = await sreq('POST', '/webhook_endpoints', params);
      const name = acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.email || acct.id;
      await db.batch([
        ...[['stripe_secret_key', key], ['stripe_webhook_secret', hook.secret], ['stripe_webhook_id', hook.id], ['stripe_account', name]]
          .map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)),
      ]);
      return json({ ok: true, account: name, mode: key.includes('_live_') ? 'live' : 'test' });
    } catch (e) { return bad('Stripe no aceptó la clave: ' + e.message); }
  }
  if (path === '/api/admin/stripe' && req.method === 'DELETE') {
    if (env.STRIPE_FROM_PANEL) {
      const s2 = await getSettings(db, true);
      if (s2.stripe_webhook_id) await fetch(`https://api.stripe.com/v1/webhook_endpoints/${s2.stripe_webhook_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${s2.stripe_secret_key}` } }).catch(() => {});
    }
    for (const k of ['stripe_secret_key', 'stripe_webhook_secret', 'stripe_webhook_id', 'stripe_account']) await setSetting(db, k, null);
    return json({ ok: true });
  }

  if (path === '/api/admin/state' && req.method === 'GET') {
    const [units, seasons, promos, feeds, photos, settings, pendingCount] = await Promise.all([
      db.prepare('SELECT * FROM units ORDER BY sort, id').all(),
      db.prepare('SELECT * FROM seasons ORDER BY start_date').all(),
      db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all(),
      db.prepare('SELECT * FROM ical_feeds ORDER BY id').all(),
      db.prepare('SELECT id, unit_id, caption, sort, length(data) AS size FROM photos ORDER BY sort, id').all(),
      getSettings(db),
      db.prepare("SELECT count(*) AS n FROM bookings WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > ?)").bind(sqlNow()).first(),
    ]);
    return json({ ok: true, units: units.results, seasons: seasons.results, promos: promos.results, feeds: feeds.results, photos: photos.results, settings,
      today: todayMadrid(), origin: url.origin, stripe: !!env.STRIPE_SECRET_KEY, stripeMode: (env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : (env.STRIPE_SECRET_KEY ? 'test' : 'off'),
      webhook: !!env.STRIPE_WEBHOOK_SECRET, mail: !!env.RESEND_API_KEY, pending: pendingCount.n,
      stripeAccount: env.STRIPE_ACCOUNT, stripeFromPanel: env.STRIPE_FROM_PANEL, passwordInCloudflare: !!env.ADMIN_PASSWORD });
  }

  // Calendario detallado para el panel
  if (path === '/api/admin/calendar' && req.method === 'GET') {
    const unit = await getUnit(db, url.searchParams.get('unit') || 1);
    if (!unit) return bad('Unidad no encontrada', 404);
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : todayMadrid().slice(0, 8) + '01';
    const days = Math.min(400, parseInt(url.searchParams.get('days') || '42', 10));
    const to = addDays(from, days);
    const ctx = await loadContext(db, unit, from, to);
    const allBookings = (await db.prepare("SELECT id, ref, checkin, checkout, name, status, source, guests, total FROM bookings WHERE unit_id = ? AND checkout > ? AND checkin < ? AND status IN ('confirmed','pending')").bind(unit.id, from, to).all()).results;
    const out = [];
    for (let d = from; d < to; d = addDays(d, 1)) {
      const n = night(ctx, d);
      const rule = ctx.ruleMap.get(d);
      const bk = allBookings.find(x => x.checkin <= d && x.checkout > d && (x.status === 'confirmed' || ctx.bookings.some(y => y.id === x.id)));
      const ext = ctx.blocks.find(x => x.start_date <= d && x.end_date > d);
      out.push({ date: d, price: n.price, source: n.source, season: n.season, minNights: n.minNights, closed: n.closed, noCheckin: n.noCheckin, weekend: n.isWeekend,
        rule: rule ? { price: rule.price, min_nights: rule.min_nights, closed: rule.closed, no_checkin: rule.no_checkin, note: rule.note } : null,
        booking: bk ? { id: bk.id, ref: bk.ref, name: bk.name, status: bk.status, source: bk.source, start: bk.checkin === d } : null,
        external: ext ? { summary: ext.summary, feed_id: ext.feed_id } : null });
    }
    return json({ ok: true, days: out });
  }

  if (path === '/api/admin/bookings' && req.method === 'GET') {
    const filter = url.searchParams.get('filter') || 'upcoming';
    const today = todayMadrid();
    let sql = 'SELECT b.*, u.name AS unit_name FROM bookings b JOIN units u ON u.id = b.unit_id';
    const args = [];
    if (filter === 'upcoming') { sql += " WHERE b.checkout >= ? AND b.status IN ('confirmed','pending') ORDER BY b.checkin"; args.push(today); }
    else if (filter === 'past') { sql += " WHERE b.checkout < ? AND b.status = 'confirmed' ORDER BY b.checkin DESC LIMIT 200"; args.push(today); }
    else if (filter === 'cancelled') sql += " WHERE b.status IN ('cancelled','expired') ORDER BY b.created_at DESC LIMIT 200";
    else sql += ' ORDER BY b.created_at DESC LIMIT 300';
    const rows = (await db.prepare(sql).bind(...args).all()).results;
    const now = sqlNow();
    for (const r of rows) if (r.status === 'pending' && r.expires_at && r.expires_at < now) r.status = 'expired';
    const ext = (await db.prepare('SELECT e.*, f.name AS feed_name FROM external_blocks e JOIN ical_feeds f ON f.id = e.feed_id WHERE e.end_date >= ? ORDER BY e.start_date').bind(today).all()).results;
    return json({ ok: true, bookings: rows, external: filter === 'upcoming' ? ext : [] });
  }

  if (path === '/api/admin/stats' && req.method === 'GET') {
    const year = url.searchParams.get('year') || todayMadrid().slice(0, 4);
    const rows = (await db.prepare("SELECT substr(checkin,1,7) AS month, count(*) AS n, sum(nights) AS nights, sum(total) AS total FROM bookings WHERE status = 'confirmed' AND source != 'bloqueo' AND substr(checkin,1,4) = ? GROUP BY month ORDER BY month").bind(year).all()).results;
    return json({ ok: true, year, months: rows });
  }

  if (path === '/api/admin/quote' && req.method === 'POST') {
    const unit = await getUnit(db, b.unit || 1);
    return json(await quote(db, unit, b, { admin: true }));
  }

  // Reserva manual o bloqueo
  if (path === '/api/admin/bookings' && req.method === 'POST') {
    const unit = await getUnit(db, b.unit_id || 1);
    if (!unit) return bad('Unidad no encontrada');
    const isBlock = b.source === 'bloqueo';
    const q = await quote(db, unit, { checkin: b.checkin, checkout: b.checkout, guests: b.guests || 1 }, { admin: true });
    if (!q.ok && !(b.force && q.error === 'Alguna de las noches no está disponible')) return json(q, 409);
    const total = isBlock ? 0 : (b.total !== '' && b.total != null ? cents(b.total) : q.total);
    const lines = isBlock ? [] : (b.total !== '' && b.total != null ? [{ type: 'manual', label: 'Precio acordado', amount: total }] : q.lines);
    const ref = makeRef();
    await db.prepare(`INSERT INTO bookings (ref, unit_id, checkin, checkout, nights, guests, name, email, phone, country, notes, total, breakdown, status, source, paid, internal_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'confirmed', ?, ?, ?)`).bind(ref, unit.id, b.checkin, b.checkout, diffDays(b.checkin, b.checkout), parseInt(b.guests || 1, 10),
      isBlock ? (b.name || 'Bloqueo') : (b.name || ''), b.email || '', b.phone || '', b.country || '', b.notes || '', total, JSON.stringify(lines),
      isBlock ? 'bloqueo' : 'manual', b.paid ? 1 : 0, b.internal_note || '').run();
    return json({ ok: true, ref });
  }

  if ((m = path.match(/^\/api\/admin\/bookings\/(\d+)$/)) && req.method === 'PATCH') {
    const id = Number(m[1]);
    const cur = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!cur) return bad('No encontrada', 404);
    const fields = ['name', 'email', 'phone', 'country', 'notes', 'internal_note', 'guests', 'paid'];
    const sets = [], args = [];
    for (const f of fields) if (f in b) { sets.push(`${f} = ?`); args.push(f === 'paid' ? (b.paid ? 1 : 0) : b[f]); }
    if ('total' in b && b.total !== '') { sets.push('total = ?'); args.push(cents(b.total)); }
    if (b.status && ['confirmed', 'cancelled'].includes(b.status)) {
      if (b.status === 'confirmed' && cur.status !== 'confirmed') {
        const unit = await getUnit(db, cur.unit_id);
        const ctx = await loadContext(db, unit, cur.checkin, cur.checkout, { excludeBookingId: id });
        for (let d = cur.checkin; d < cur.checkout; d = addDays(d, 1)) if (!night(ctx, d).free && !b.force) return bad(`La noche ${d} ya está ocupada`, 409);
      }
      sets.push('status = ?', 'expires_at = NULL'); args.push(b.status);
    }
    if (!sets.length) return json({ ok: true });
    await db.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
    return json({ ok: true });
  }

  // Unidades (configuración de precios base)
  const unitFields = { name: 's', slug: 's', summary: 's', description: 's', max_guests: 'i', base_guests: 'i', bedrooms: 'i', beds: 'i', bathrooms: 'i',
    base_price: 'c', weekend_price: 'c', weekend_nights: 's', min_nights: 'i', max_nights: 'i', cleaning_fee: 'c', extra_guest_fee: 'c',
    weekly_discount: 'f', monthly_discount: 'f', stay_discounts: 'j', last_minute_days: 'i', last_minute_discount: 'f', early_bird_days: 'i', early_bird_discount: 'f',
    min_advance_days: 'i', max_advance_days: 'i', checkin_days: 's', active: 'i', sort: 'i' };
  const conv = (t, v) => t === 'j' ? JSON.stringify((Array.isArray(v) ? v : []).map(x => ({ nights: parseInt(x.nights, 10), pct: Number(String(x.pct).replace(',', '.')) })).filter(x => x.nights > 0 && x.pct > 0 && x.pct <= 90)) : t === 'c' ? cents(v) : t === 'i' ? intOrNull(v) : t === 'f' ? (v === '' || v == null ? 0 : Number(String(v).replace(',', '.'))) : String(v ?? '');
  if (path === '/api/admin/units' && req.method === 'POST') {
    const slug = (b.slug || b.name || 'suite').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'suite-' + Date.now();
    const r = await db.prepare('INSERT INTO units (slug, name, ical_token, base_price) VALUES (?, ?, ?, ?)').bind(slug, b.name || 'Nueva suite', randomToken(16), cents(b.base_price) ?? 9000).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if ((m = path.match(/^\/api\/admin\/units\/(\d+)$/)) && req.method === 'PUT') {
    const sets = [], args = [];
    for (const [k, t] of Object.entries(unitFields)) if (k in b) {
      let v = conv(t, b[k]);
      if (['base_price', 'min_nights', 'max_nights', 'max_guests', 'base_guests'].includes(k) && v == null) return bad(`El campo ${k} es obligatorio`);
      if (['cleaning_fee', 'extra_guest_fee'].includes(k) && v == null) v = 0;
      if (['last_minute_days', 'early_bird_days', 'min_advance_days'].includes(k) && v == null) v = 0;
      sets.push(`${k} = ?`); args.push(v);
    }
    if (sets.length) await db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).bind(...args, Number(m[1])).run();
    return json({ ok: true });
  }

  // Temporadas
  if (path === '/api/admin/seasons' && req.method === 'POST') {
    if (!isDate(b.start_date) || !isDate(b.end_date) || b.end_date < b.start_date) return bad('Fechas de temporada no válidas');
    if (cents(b.price) == null) return bad('Indica el precio por noche');
    const r = await db.prepare('INSERT INTO seasons (unit_id, name, start_date, end_date, price, weekend_price, min_nights, priority, color) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(b.unit_id || 1, b.name || 'Temporada', b.start_date, b.end_date, cents(b.price), cents(b.weekend_price), intOrNull(b.min_nights), intOrNull(b.priority) || 0, b.color || '#c2410c').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if ((m = path.match(/^\/api\/admin\/seasons\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM seasons WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PUT') {
      if (!isDate(b.start_date) || !isDate(b.end_date) || b.end_date < b.start_date) return bad('Fechas de temporada no válidas');
      await db.prepare('UPDATE seasons SET name=?, start_date=?, end_date=?, price=?, weekend_price=?, min_nights=?, priority=?, color=? WHERE id=?')
        .bind(b.name, b.start_date, b.end_date, cents(b.price), cents(b.weekend_price), intOrNull(b.min_nights), intOrNull(b.priority) || 0, b.color || '#c2410c', Number(m[1])).run();
      return json({ ok: true });
    }
  }

  // Reglas por día (rango)
  if (path === '/api/admin/days' && req.method === 'POST') {
    const { unit_id = 1, from, to } = b;
    if (!isDate(from) || !isDate(to) || to < from) return bad('Rango no válido');
    if (diffDays(from, to) > 400) return bad('Rango demasiado largo');
    const stmts = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (b.weekdays && Array.isArray(b.weekdays) && b.weekdays.length && !b.weekdays.includes(new Date(d + 'T00:00:00Z').getUTCDay())) continue;
      if (b.clear) { stmts.push(db.prepare('DELETE FROM day_rules WHERE unit_id = ? AND date = ?').bind(unit_id, d)); continue; }
      stmts.push(db.prepare(`INSERT INTO day_rules (unit_id, date, price, min_nights, closed, no_checkin, note) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(unit_id, date) DO UPDATE SET
          price = CASE WHEN ?8 THEN excluded.price ELSE day_rules.price END,
          min_nights = CASE WHEN ?9 THEN excluded.min_nights ELSE day_rules.min_nights END,
          closed = CASE WHEN ?10 THEN excluded.closed ELSE day_rules.closed END,
          no_checkin = CASE WHEN ?11 THEN excluded.no_checkin ELSE day_rules.no_checkin END,
          note = CASE WHEN ?12 THEN excluded.note ELSE day_rules.note END`)
        .bind(unit_id, d, cents(b.price), intOrNull(b.min_nights), b.closed ? 1 : 0, b.no_checkin ? 1 : 0, b.note ?? null,
          'price' in b ? 1 : 0, 'min_nights' in b ? 1 : 0, 'closed' in b ? 1 : 0, 'no_checkin' in b ? 1 : 0, 'note' in b ? 1 : 0));
    }
    stmts.push(db.prepare('DELETE FROM day_rules WHERE price IS NULL AND min_nights IS NULL AND closed = 0 AND no_checkin = 0 AND (note IS NULL OR note = \'\')'));
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
    return json({ ok: true });
  }

  // Códigos promocionales
  if (path === '/api/admin/promos' && req.method === 'POST') {
    const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return bad('Código no válido (3-30 letras/números)');
    const value = b.kind === 'fixed' ? cents(b.value) : parseInt(b.value, 10);
    if (!value || value <= 0 || (b.kind !== 'fixed' && value > 100)) return bad('Valor del descuento no válido');
    try {
      await db.prepare('INSERT INTO promo_codes (code, kind, value, unit_id, valid_from, valid_to, min_nights, max_uses, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(code, b.kind === 'fixed' ? 'fixed' : 'pct', value, intOrNull(b.unit_id), b.valid_from || null, b.valid_to || null, intOrNull(b.min_nights) || 0, intOrNull(b.max_uses), b.note || '').run();
    } catch { return bad('Ese código ya existe'); }
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/promos\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM promo_codes WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PATCH') { await db.prepare('UPDATE promo_codes SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, Number(m[1])).run(); return json({ ok: true }); }
  }

  // Calendarios iCal externos
  if (path === '/api/admin/feeds' && req.method === 'POST') {
    if (!/^https?:\/\//.test(b.url || '')) return bad('URL no válida');
    const r = await db.prepare('INSERT INTO ical_feeds (unit_id, name, url) VALUES (?,?,?)').bind(b.unit_id || 1, b.name || 'Calendario', b.url.trim()).run();
    const feed = await db.prepare('SELECT * FROM ical_feeds WHERE id = ?').bind(r.meta.last_row_id).first();
    return json({ ok: true, sync: await syncFeed(db, feed) });
  }
  if ((m = path.match(/^\/api\/admin\/feeds\/(\d+)$/)) && req.method === 'DELETE') {
    await db.batch([db.prepare('DELETE FROM external_blocks WHERE feed_id = ?').bind(Number(m[1])), db.prepare('DELETE FROM ical_feeds WHERE id = ?').bind(Number(m[1]))]);
    return json({ ok: true });
  }
  if (path === '/api/admin/feeds/sync' && req.method === 'POST') return json({ ok: true, results: await syncAll(db) });

  // Ajustes y textos de la web
  if (path === '/api/admin/settings' && req.method === 'PUT') {
    const stmts = Object.entries(b).filter(([k]) => /^[a-z_]{2,40}$/.test(k) && !SECRET_KEYS.includes(k))
      .map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v ?? '')));
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true });
  }

  // Fotos (se guardan en D1, redimensionadas en el navegador)
  if (path === '/api/admin/photos' && req.method === 'POST') {
    const m2 = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(b.data || '');
    if (!m2) return bad('Imagen no válida');
    const bin = Uint8Array.from(atob(m2[2]), c => c.charCodeAt(0));
    if (bin.length > 1800000) return bad('Imagen demasiado grande');
    const max = await db.prepare('SELECT coalesce(max(sort), 0) AS s FROM photos').first();
    const r = await db.prepare('INSERT INTO photos (unit_id, mime, data, caption, sort) VALUES (?,?,?,?,?)').bind(intOrNull(b.unit_id), m2[1], bin, b.caption || '', max.s + 1).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (path === '/api/admin/photos/order' && req.method === 'PUT') {
    await db.batch((b.ids || []).map((id, i) => db.prepare('UPDATE photos SET sort = ? WHERE id = ?').bind(i, id)));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/photos\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM photos WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PATCH') { await db.prepare('UPDATE photos SET caption = ?, unit_id = ? WHERE id = ?').bind(b.caption || '', intOrNull(b.unit_id), Number(m[1])).run(); return json({ ok: true }); }
  }

  return bad('Ruta no encontrada', 404);
}

async function expirePending(db) {
  await db.prepare("UPDATE bookings SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?").bind(sqlNow()).run();
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path.startsWith('/api/')) env = await withConfig(env);
      if (path.startsWith('/api/admin/')) return await adminApi(req, env, url, path);
      if (path.startsWith('/api/')) {
        const r = await publicApi(req, env, url, path);
        return r || bad('Ruta no encontrada', 404);
      }
      let m;
      if ((m = path.match(/^\/foto\/(\d+)(?:\.\w+)?$/))) {
        const p = await env.DB.prepare('SELECT mime, data, src FROM photos WHERE id = ?').bind(Number(m[1])).first();
        if (!p) return new Response('No encontrada', { status: 404 });
        if (p.src) return env.ASSETS.fetch(new Request(new URL(p.src, url), req));
        return new Response(new Uint8Array(p.data), { headers: { 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
      }
      if ((m = path.match(/^\/ical\/([a-f0-9]{16,64})\.ics$/))) {
        const unit = await env.DB.prepare('SELECT * FROM units WHERE ical_token = ?').bind(m[1]).first();
        if (!unit) return new Response('No encontrado', { status: 404 });
        return new Response(await exportIcal(env.DB, unit, url.host), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return bad('Error interno: ' + e.message, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([syncAll(env.DB), expirePending(env.DB)]));
  },
};
