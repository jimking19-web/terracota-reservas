// Terracota Suites · Worker principal (web + API + panel + tareas programadas)
import { addDays, diffDays, isDate, todayMadrid } from './dates.js';
import { calendar, getUnit, loadContext, night, quote, money } from './pricing.js';
import { exportIcal, syncAll, syncFeed } from './ical.js';
import { track, stats, cleanup as cleanupAnalytics } from './analytics.js';
import { addSubscriber, unsubscribePage, runMarketing, sendCampaign, marketingStats, welcomeGift, CONSENT_TEXT } from './marketing.js';
import { createCheckout, verifyWebhook, stripeRequest } from './stripe.js';
import { isVoucherCode, buyVoucher, activateVoucher, voucherPublic, adminVouchers, createManualVoucher, sendVoucherEmails } from './vouchers.js';
import { runDeposits, placeHold, releaseHold, captureHold, depositCheckout, depositLink, releaseDate } from './deposit.js';
import { guestEmail, ownerEmail, sendMail, mailEnabled } from './mail.js';
import { ensureInvoice, invoiceReady, invoiceUrl, serveInvoice, sampleBooking, refToken, invoiceHtml } from './invoice.js';

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
  gift_min_nights: '2',
  vouchers_enabled: '1', voucher_price: '180', voucher_max_nights: '7', voucher_months: '12', voucher_includes: 'Botella de vino incluida',
  voucher_list: 'Botella de vino\nLeña para la chimenea\nCafé e infusiones\nBotellitas de agua de cortesía\nVelas aromáticas\nAlberca privada\nLimpieza a fondo antes de la llegada\nWiFi y aire acondicionado',
  welcome_amount: '10',
  gift_text: 'Botella de vino y leña para la chimenea',
  faq: '¿A qué hora es la entrada y la salida?|La entrada es a partir de las 16:00 y la salida antes de las 10:30. Si necesitas otro horario, escríbenos y lo intentamos.\n¿Qué incluye la estancia?|Café e infusiones, agua de cortesía, alberca privada, velas aromáticas y limpieza a fondo antes de tu llegada. Y si te quedas 2 noches o más, te regalamos una botella de vino y leña para la chimenea.\n¿Cuántas personas caben?|El alojamiento es para un máximo de 3 personas.\n¿Hay descuento por quedarse más noches?|Sí. Al reservar 2 noches o más se aplica un descuento automático; lo verás en el desglose antes de pagar.\n¿Cómo se paga?|Con tarjeta a través de Stripe, una pasarela de pago segura. Recibirás la confirmación por email al momento.\n¿Puedo cancelar?|Consulta la política de cancelación más abajo. Si tienes cualquier duda, escríbenos por WhatsApp.\n¿Cómo llego?|Estamos en Bullas (Murcia). Tras reservar te enviamos la ubicación exacta y las indicaciones de acceso.',
  checkin_time: '16:00', checkout_time: '12:00',
  house_rules: 'No se permite fumar en el interior\nNo se admiten fiestas ni eventos\nRespeta el descanso de los vecinos a partir de las 23:00',
  cancellation: 'Cancelación gratuita hasta 14 días antes de la llegada. Después, no reembolsable.',
  license: '',
  legal_name: '', legal_id: '', fiscal_address: '', vat_rate: '', vat_note: '', invoice_prefix: 'F',
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
const SECRET_KEYS = ['admin_hash', 'setup_code', 'stripe_secret_key', 'stripe_webhook_secret', 'stripe_webhook_id', 'stripe_account', 'smtp_user', 'smtp_pass', 'link_secret', 'analytics_salt'];

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
    SMTP_USER: c.smtp_user || '', SMTP_PASS: c.smtp_pass || '',
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
async function confirmBooking(env, booking, paymentId, origin) {
  const db = env.DB;
  // Solo la primera confirmación sigue (evita emails dobles si webhook y página llegan a la vez)
  const upd = await db.prepare("UPDATE bookings SET status = 'confirmed', paid = 1, stripe_payment = ?, expires_at = NULL WHERE id = ? AND status != 'confirmed'")
    .bind(paymentId || booking.stripe_payment, booking.id).run();
  if (!upd.meta.changes) return;
  const unit = await getUnit(db, booking.unit_id);
  // ¿Se ha solapado mientras pagaba? (p. ej. llegó una reserva por iCal)
  const ctx = await loadContext(db, unit, booking.checkin, booking.checkout, { excludeBookingId: booking.id });
  const conflict = [];
  for (let d = booking.checkin; d < booking.checkout; d = addDays(d, 1)) if (!night(ctx, d).free) conflict.push(d);
  if (conflict.length) await db.prepare('UPDATE bookings SET internal_note = ? WHERE id = ?').bind(`⚠️ CONFLICTO: noches ocupadas por otra reserva/bloqueo (${conflict.join(', ')}). Revisar.`, booking.id).run();
  if (booking.promo_code && isVoucherCode(booking.promo_code)) await db.prepare("UPDATE vouchers SET status = 'used', used_at = ?, booking_id = ? WHERE code = ?").bind(sqlNow(), booking.id, booking.promo_code.toUpperCase()).run();
  else if (booking.promo_code) await db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE upper(code) = upper(?)').bind(booking.promo_code).run();
  if (booking.deposit > 0 && paymentId && env.STRIPE_SECRET_KEY) {
    try {
      const pi = await stripeRequest(env, 'GET', `/payment_intents/${paymentId}`);
      await db.prepare("UPDATE bookings SET stripe_customer = ?, stripe_pm = ?, deposit_status = coalesce(deposit_status, 'pending') WHERE id = ?").bind(pi.customer || null, pi.payment_method || null, booking.id).run();
    } catch (e) { console.error('deposit card', e); }
  }
  await notifyConfirmed(env, booking.id, origin, { owner: true, conflict: conflict.length ? `Noches ocupadas por otra reserva o bloqueo: ${conflict.join(', ')}. Revísalo.` : '' });
}

// Envía el email de confirmación al huésped (y opcionalmente el aviso al propietario). Asigna factura si procede.
async function notifyConfirmed(env, bookingId, origin, { owner = false, guest = true, conflict = '' } = {}) {
  const db = env.DB;
  const site = await getSettings(db);
  origin = origin || site.site_url || '';
  let b = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!b) return { ok: false, error: 'Reserva no encontrada' };
  const unit = await getUnit(db, b.unit_id);
  b = await ensureInvoice(db, b, site);
  const inv = b.invoice_no ? await invoiceUrl(db, origin, b.ref) : '';
  const hero = site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '';
  const ownerMail = env.OWNER_EMAIL || site.email;
  const jobs = [];
  if (guest && b.email) jobs.push(sendMail(env, { to: b.email, fromName: site.site_name, replyTo: ownerMail || undefined,
    subject: `Reserva confirmada · ${site.site_name} · ${b.ref}`,
    html: guestEmail(site, unit, b, { origin, heroUrl: hero, bookingUrl: `${origin}/reserva?ref=${b.ref}`, invoiceUrl: inv }) }));
  if (owner && ownerMail) jobs.push(sendMail(env, { to: ownerMail, fromName: site.site_name, replyTo: b.email,
    subject: `${conflict ? '⚠️ ' : ''}Nueva reserva ${b.ref} · ${b.checkin} → ${b.checkout} · ${money(b.total)}`,
    html: ownerEmail(site, unit, b, { origin, invoiceUrl: inv, conflict }) }));
  const res = await Promise.all(jobs);
  const err = res.find(r => r && r.ok === false);
  if (guest && b.email && res[0]?.ok) await db.prepare("UPDATE bookings SET mail_sent_at = datetime('now') WHERE id = ?").bind(b.id).run();
  return err ? { ok: false, error: err.error } : { ok: true, skipped: res.every(r => r?.skipped) };
}

// ---------- API pública ----------
async function publicApi(req, env, url, path) {
  const db = env.DB;

  if (path === '/api/site' && req.method === 'GET') {
    const [settings, units, photos] = await Promise.all([
      getSettings(db),
      db.prepare('SELECT * FROM units WHERE active = 1 ORDER BY sort, id').all(),
      db.prepare('SELECT id, unit_id, caption, category FROM photos ORDER BY sort, id').all(),
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

  if (path === '/api/subscribe' && req.method === 'POST') {
    const b = await body(req);
    if (b.website) return json({ ok: true });                       // honeypot
    if (!b.consent) return bad('Marca la casilla para aceptar recibir emails');
    const t = await addSubscriber(db, { email: b.email, name: b.name, source: 'web', consent: `${CONSENT_TEXT} (${sqlNow()} UTC)` });
    if (!t) return bad('Revisa el email');
    const site = await getSettings(db);
    const g = await welcomeGift(env, site, b.email).catch(() => null);
    if (!g) return json({ ok: true });
    if (g.already) return json({ ok: true, message: 'Ya estabas apuntado. Tu código de bienvenida ya se usó o caducó.' });
    if (g.guest) return json({ ok: true, message: '¡Listo! Ya eres de casa: te avisaremos de fechas libres y ofertas.' });
    // Si el email funciona, el código solo va al correo (así nos aseguramos de que el email es real)
    return json({ ok: true, sent: g.sent, code: g.sent ? undefined : g.code,
      message: g.sent ? '¡Listo! Te hemos enviado tu código de descuento por email (mira también en spam).' : `¡Listo! Tu código de descuento es ${g.code}` });
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
      deposit: q.deposit || 0,
      billing: b.bill_name || b.bill_nif ? JSON.stringify({ name: String(b.bill_name || '').slice(0, 120), nif: String(b.bill_nif || '').slice(0, 30), address: String(b.bill_address || '').slice(0, 240) }) : null,
    };
    const ins = await db.prepare(`INSERT INTO bookings (ref, unit_id, checkin, checkout, nights, guests, name, email, phone, country, notes, total, breakdown, promo_code, billing, deposit, status, source, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 'web', ?)`).bind(booking.ref, booking.unit_id, booking.checkin, booking.checkout, booking.nights, booking.guests,
      booking.name, booking.email, booking.phone, booking.country, booking.notes, booking.total, booking.breakdown, booking.promo_code, booking.billing, booking.deposit, sqlNow(expiresMs - Date.now())).run();
    booking.id = ins.meta.last_row_id;
    if (b.marketing) await addSubscriber(db, { email: booking.email, name: booking.name, source: 'reserva', consent: `${CONSENT_TEXT} (${sqlNow()} UTC)` }).catch(() => {});

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

    // Vale regalo: queda apartado para esta reserva; si cubre todo, la reserva se confirma sin pasar por el pago
    if (booking.promo_code && isVoucherCode(booking.promo_code)) {
      await db.batch([
        db.prepare('UPDATE vouchers SET booking_id = ? WHERE code = ?').bind(booking.id, booking.promo_code),
        db.prepare("UPDATE bookings SET internal_note = trim(coalesce(internal_note, '') || ' Vale regalo ' || ? || ': incluye botella de vino.') WHERE id = ?").bind(booking.promo_code, booking.id),
      ]);
      if (booking.total === 0) {
        await confirmBooking(env, { ...booking, stripe_payment: null }, null, url.origin);
        return json({ ok: true, ref: booking.ref, mode: 'voucher', redirect: `/reserva?ref=${booking.ref}` });
      }
    }

    if (!usingStripe) {
      const site = await getSettings(db);
      const o = url.origin;
      await Promise.all([
        sendMail(env, { to: env.OWNER_EMAIL || site.email, fromName: site.site_name, subject: `Solicitud de reserva ${booking.ref} · ${booking.checkin} → ${booking.checkout}`, html: ownerEmail(site, unit, { ...booking, status: 'pending' }, { origin: o }), replyTo: booking.email }),
        sendMail(env, { to: booking.email, fromName: site.site_name, subject: `Solicitud recibida · ${site.site_name} · ${booking.ref}`, html: guestEmail(site, unit, booking, { origin: o, kind: 'request', heroUrl: site.hero_photo ? `${o}/foto/${site.hero_photo}` : '', bookingUrl: `${o}/reserva?ref=${booking.ref}` }), replyTo: site.email || undefined }),
      ]);
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

  if (path === '/api/voucher' && req.method === 'POST') {
    const b = await body(req);
    if (b.website) return json({ ok: true });
    const r = await buyVoucher(env, await getSettings(db), url, b);
    return r.ok ? json(r) : bad(r.error);
  }

  let m;
  if ((m = path.match(/^\/api\/voucher\/(REGALO-[A-Z0-9]{6})$/i)) && req.method === 'GET') {
    const r = await voucherPublic(env, m[1], url.origin);
    return r.ok ? json(r) : bad(r.error, 404);
  }
  if ((m = path.match(/^\/api\/booking\/(TS-[A-Z0-9]{6})$/)) && req.method === 'GET') {
    const b = await db.prepare('SELECT b.*, u.name AS unit_name FROM bookings b JOIN units u ON u.id = b.unit_id WHERE ref = ?').bind(m[1]).first();
    if (!b) return bad('Reserva no encontrada', 404);
    // Si el huésped vuelve de Stripe antes que el webhook, consultamos la sesión directamente
    if (b.status === 'pending' && b.stripe_session && env.STRIPE_SECRET_KEY) {
      try {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${b.stripe_session}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
        const s = await r.json();
        if (s.payment_status === 'paid') { await confirmBooking(env, b, s.payment_intent, url.origin); b.status = 'confirmed'; }
      } catch {}
    }
    const isExpired = b.status === 'pending' && b.expires_at && b.expires_at < sqlNow();
    return json({ ok: true, ref: b.ref, unit: b.unit_name, checkin: b.checkin, checkout: b.checkout, nights: b.nights, guests: b.guests,
      name: (b.name || '').split(' ')[0], total: b.total, lines: JSON.parse(b.breakdown || '[]'),
      status: isExpired ? 'expired' : b.status, mode: b.stripe_session ? 'stripe' : 'request',
      invoice: b.status === 'confirmed' && invoiceReady(await getSettings(db)) ? await invoiceUrl(db, url.origin, b.ref) : null,
      deposit: b.deposit || 0, depositStatus: b.deposit_status || null,
      depositLink: b.deposit > 0 && b.status === 'confirmed' && !['held', 'captured', 'released'].includes(b.deposit_status) && b.checkout >= todayMadrid() ? await depositLink(db, url.origin, b.ref) : null });
  }

  if (path === '/api/stripe/webhook' && req.method === 'POST') {
    const payload = await req.text();
    if (!(await verifyWebhook(env, payload, req.headers.get('Stripe-Signature')))) return bad('Firma no válida', 400);
    const evt = JSON.parse(payload);
    const s = evt.data?.object || {};
    const ref = s.metadata?.ref || s.client_reference_id;
    if (s.metadata?.kind === 'voucher' && s.metadata.voucher) {
      if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid') await activateVoucher(env, s.metadata.voucher, s.payment_intent, url.origin);
      else if (evt.type === 'checkout.session.expired') await db.prepare("UPDATE vouchers SET status = 'cancelled' WHERE code = ? AND status = 'pending'").bind(s.metadata.voucher).run();
      return json({ received: true });
    }
    if (ref && s.metadata?.kind === 'deposit') {
      // El huésped ha dejado la fianza él mismo (retención manual)
      if (evt.type === 'checkout.session.completed' && s.payment_intent) {
        const pi = await stripeRequest(env, 'GET', `/payment_intents/${s.payment_intent}`);
        if (pi.status === 'requires_capture') {
          const old = await db.prepare('SELECT id, deposit_pi, deposit_status FROM bookings WHERE ref = ?').bind(ref).first();
          if (old?.deposit_status === 'held' && old.deposit_pi && old.deposit_pi !== pi.id) await releaseHold(env, old.deposit_pi);
          await db.prepare("UPDATE bookings SET deposit_status = 'held', deposit_pi = ?, deposit_held_at = ?, stripe_customer = coalesce(?, stripe_customer), stripe_pm = coalesce(?, stripe_pm), deposit_note = ? WHERE ref = ?")
            .bind(pi.id, sqlNow(), pi.customer || null, pi.payment_method || null, `Dejada por el huésped el ${todayMadrid()}`, ref).run();
        }
      }
      return json({ received: true });
    }
    if (ref) {
      const b = await db.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
      if (b) {
        if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid' && b.status !== 'confirmed') {
          await confirmBooking(env, b, s.payment_intent, url.origin);
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

  // Emails (Gmail con contraseña de aplicación)
  if (path === '/api/admin/mail' && req.method === 'POST') {
    const user = String(b.user || '').trim().toLowerCase(), pass = String(b.pass || '').replace(/\s+/g, '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return bad('Email no válido');
    if (pass.length < 8) return bad('Pega la contraseña de aplicación de 16 letras');
    const site = await getSettings(db);
    const test = await sendMail({ ...env, SMTP_USER: user, SMTP_PASS: pass }, { to: user, fromName: site.site_name, subject: `✓ Emails activados · ${site.site_name}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#2a211c"><p>¡Listo! Tu web de reservas ya puede enviar emails desde <b>${user}</b>.</p><p>A partir de ahora cada huésped recibirá su confirmación con el resumen y la factura, y tú un aviso de cada reserva.</p></div>` });
    if (!test.ok) return bad('No he podido enviar con esos datos: ' + (test.error || 'error desconocido').replace(/^SMTP 535.*$/, 'Google rechaza el usuario o la contraseña de aplicación (535). Revisa que sea una contraseña de aplicación, no tu contraseña normal.'));
    await setSetting(db, 'smtp_user', user); await setSetting(db, 'smtp_pass', pass);
    return json({ ok: true });
  }
  if (path === '/api/admin/mail/sample' && req.method === 'POST') {
    if (!mailEnabled(env)) return bad('Primero activa los emails');
    const site = await getSettings(db);
    const unit = await getUnit(db, 1);
    const sb = await sampleBooking(db, unit, site);
    const to = String(b.to || site.email || env.SMTP_USER).trim();
    const origin = url.origin;
    const r = await sendMail(env, { to, fromName: site.site_name, replyTo: site.email || undefined, subject: `[MUESTRA] Reserva confirmada · ${site.site_name} · ${sb.ref}`,
      html: guestEmail(site, unit, sb, { origin, heroUrl: site.hero_photo ? `${origin}/foto/${site.hero_photo}` : '', bookingUrl: origin, invoiceUrl: invoiceReady(site) ? `${origin}/factura/muestra?t=${await refToken(db, 'muestra')}` : '' }) });
    return r.ok ? json({ ok: true, to }) : bad('No se pudo enviar: ' + (r.error || ''));
  }
  if (path === '/api/admin/mail' && req.method === 'DELETE') {
    await setSetting(db, 'smtp_user', null); await setSetting(db, 'smtp_pass', null);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/bookings\/(\d+)\/email$/)) && req.method === 'POST') {
    if (!mailEnabled(env)) return bad('Primero activa los emails en «Pagos y cuenta»');
    const bk = await db.prepare('SELECT status, email FROM bookings WHERE id = ?').bind(Number(m[1])).first();
    if (!bk) return bad('No encontrada', 404);
    if (bk.status !== 'confirmed') return bad('Solo se envía la confirmación de reservas confirmadas');
    if (!bk.email) return bad('La reserva no tiene email');
    const r = await notifyConfirmed(env, Number(m[1]), url.origin);
    return r.ok ? json({ ok: true }) : bad('No se pudo enviar: ' + r.error);
  }
  if ((m = path.match(/^\/api\/admin\/bookings\/(\d+)\/deposit$/)) && req.method === 'POST') {
    const id = Number(m[1]);
    const bk = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!bk) return bad('No encontrada', 404);
    const a = b.action;
    if (a === 'set') {
      const amt = cents(b.amount) || 0;
      if (bk.deposit_status === 'held' || bk.deposit_status === 'captured') return bad('La fianza ya está retenida; libérala antes de cambiar el importe');
      await db.prepare("UPDATE bookings SET deposit = ?, deposit_status = CASE WHEN ? > 0 THEN 'pending' ELSE NULL END, deposit_note = NULL WHERE id = ?").bind(amt, amt, id).run();
      return json({ ok: true });
    }
    if (a === 'link') return json({ ok: true, url: await depositLink(db, url.origin, bk.ref) });
    if (a === 'keep') { await db.prepare('UPDATE bookings SET deposit_keep = ? WHERE id = ?').bind(b.keep ? 1 : 0, id).run(); return json({ ok: true }); }
    if (!env.STRIPE_SECRET_KEY) return bad('Stripe no está conectado');
    if (a === 'hold') {
      if (bk.deposit_status === 'held') return bad('Ya está retenida');
      const r = await placeHold(env, bk);
      if (!r.ok) { await db.prepare("UPDATE bookings SET deposit_status = 'pending', deposit_note = ? WHERE id = ?").bind('Error al retener: ' + r.error, id).run(); return bad('No se pudo retener: ' + r.error + '. Envíale el enlace para que la deje él.'); }
      await db.prepare("UPDATE bookings SET deposit_status = 'held', deposit_pi = ?, deposit_held_at = ?, deposit_note = ? WHERE id = ?").bind(r.pi, sqlNow(), `Retenida a mano el ${todayMadrid()}`, id).run();
      return json({ ok: true });
    }
    if (bk.deposit_status !== 'held' || !bk.deposit_pi) return bad('No hay ninguna fianza retenida');
    if (a === 'release') {
      const r = await releaseHold(env, bk.deposit_pi);
      if (!r.ok) return bad(r.error);
      await db.prepare("UPDATE bookings SET deposit_status = 'released', deposit_note = ? WHERE id = ?").bind(`Liberada a mano el ${todayMadrid()}`, id).run();
      return json({ ok: true });
    }
    if (a === 'capture') {
      const amt = cents(b.amount);
      if (!amt || amt <= 0 || amt > bk.deposit) return bad(`Importe no válido (máximo ${money(bk.deposit)})`);
      const r = await captureHold(env, bk.deposit_pi, amt);
      if (!r.ok) return bad(r.error);
      await db.prepare("UPDATE bookings SET deposit_status = 'captured', deposit_captured = ?, deposit_note = ? WHERE id = ?").bind(amt, `Cobrados ${money(amt)} el ${todayMadrid()}${b.reason ? ': ' + String(b.reason).slice(0, 200) : ''}`, id).run();
      return json({ ok: true });
    }
    return bad('Acción no válida');
  }
  if ((m = path.match(/^\/api\/admin\/bookings\/(\d+)\/invoice$/)) && req.method === 'POST') {
    const site = await getSettings(db);
    if (!invoiceReady(site)) return bad('Completa primero los datos de facturación en «Pagos y cuenta»');
    let bk = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(Number(m[1])).first();
    if (!bk || bk.status !== 'confirmed') return bad('Solo las reservas confirmadas tienen factura');
    bk = await ensureInvoice(db, bk, site);
    if (!bk.invoice_no) return bad('Esta reserva no tiene importe que facturar');
    return json({ ok: true, url: await invoiceUrl(db, url.origin, bk.ref), number: bk.invoice_no });
  }

  if (path === '/api/admin/analytics' && req.method === 'GET') return json(await stats(db, parseInt(url.searchParams.get('days') || '30', 10)));

  if (path === '/api/admin/vouchers' && req.method === 'GET') return json({ ok: true, vouchers: await adminVouchers(db) });
  if (path === '/api/admin/vouchers' && req.method === 'POST') { const r = await createManualVoucher(db, await getSettings(db), b); return r.ok ? json(r) : bad(r.error); }
  if ((m = path.match(/^\/api\/admin\/vouchers\/(\d+)$/)) && req.method === 'PATCH') {
    const v = await db.prepare('SELECT * FROM vouchers WHERE id = ?').bind(Number(m[1])).first();
    if (!v) return bad('Vale no encontrado', 404);
    if (b.status === 'cancelled' && v.status !== 'used') await db.prepare("UPDATE vouchers SET status = 'cancelled' WHERE id = ?").bind(v.id).run();
    else if (b.status === 'active' && v.status === 'cancelled' && v.paid_at) await db.prepare("UPDATE vouchers SET status = 'active' WHERE id = ?").bind(v.id).run();
    if (b.resend) { if (!mailEnabled(env)) return bad('Primero activa los emails'); await sendVoucherEmails(env, await getSettings(db), v, url.origin); }
    if ('expires_at' in b && isDate(b.expires_at)) await db.prepare('UPDATE vouchers SET expires_at = ? WHERE id = ?').bind(b.expires_at, v.id).run();
    return json({ ok: true });
  }
  if (path === '/api/admin/marketing' && req.method === 'GET') return json(await marketingStats(db));
  if (path === '/api/admin/campaign' && req.method === 'POST') {
    const site = await getSettings(db);
    return json(await sendCampaign(env, site, { ...b, to: String(b.to || site.email || env.SMTP_USER || '').trim() }));
  }
  if (path === '/api/admin/subscribers.csv' && req.method === 'GET') {
    const rows = (await db.prepare('SELECT email, name, source, created_at, unsubscribed_at FROM subscribers ORDER BY id').all()).results;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\ufeffemail;nombre;origen;alta;baja\n' + rows.map(r => [r.email, r.name, r.source, r.created_at, r.unsubscribed_at].map(q).join(';')).join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="interesados-terracota.csv"' } });
  }
  if ((m = path.match(/^\/api\/admin\/subscribers\/(\d+)$/)) && req.method === 'DELETE') {
    await db.prepare('DELETE FROM subscribers WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/state' && req.method === 'GET') {
    if (!/localhost|127\.0\.0\.1/.test(url.host)) await setSetting(db, 'site_url', url.origin);
    const [units, seasons, promos, feeds, photos, settings, pendingCount, extras] = await Promise.all([
      db.prepare('SELECT * FROM units ORDER BY sort, id').all(),
      db.prepare('SELECT * FROM seasons ORDER BY start_date').all(),
      db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all(),
      db.prepare('SELECT * FROM ical_feeds ORDER BY id').all(),
      db.prepare('SELECT id, unit_id, caption, category, sort, length(data) AS size FROM photos ORDER BY sort, id').all(),
      getSettings(db),
      db.prepare("SELECT count(*) AS n FROM bookings WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > ?)").bind(sqlNow()).first(),
      db.prepare('SELECT * FROM extras ORDER BY sort, id').all(),
    ]);
    return json({ ok: true, extras: extras.results, units: units.results, seasons: seasons.results, promos: promos.results, feeds: feeds.results, photos: photos.results, settings,
      today: todayMadrid(), origin: url.origin, stripe: !!env.STRIPE_SECRET_KEY, stripeMode: (env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : (env.STRIPE_SECRET_KEY ? 'test' : 'off'),
      webhook: !!env.STRIPE_WEBHOOK_SECRET, mail: mailEnabled(env), mailUser: env.SMTP_USER || (env.RESEND_API_KEY ? 'Resend' : ''), invoices: invoiceReady(settings), pending: pendingCount.n,
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
    if (b.status === 'cancelled' && cur.deposit_status === 'held' && cur.deposit_pi) {
      await releaseHold(env, cur.deposit_pi);
      await db.prepare("UPDATE bookings SET deposit_status = 'released', deposit_note = ? WHERE id = ?").bind(`Liberada al cancelar el ${todayMadrid()}`, id).run();
    }
    if (b.status === 'confirmed' && cur.status !== 'confirmed' && b.notify && cur.email && cur.source !== 'bloqueo' && mailEnabled(env)) {
      const r = await notifyConfirmed(env, id, url.origin);
      return json({ ok: true, mailed: !!r.ok, mailError: r.ok ? undefined : r.error });
    }
    return json({ ok: true });
  }

  // Unidades (configuración de precios base)
  const unitFields = { name: 's', slug: 's', summary: 's', description: 's', max_guests: 'i', base_guests: 'i', bedrooms: 'i', beds: 'i', bathrooms: 'i',
    base_price: 'c', weekend_price: 'c', weekend_nights: 's', min_nights: 'i', max_nights: 'i', cleaning_fee: 'c', extra_guest_fee: 'c',
    weekly_discount: 'f', monthly_discount: 'f', stay_discounts: 'j', last_minute_days: 'i', last_minute_discount: 'f', early_bird_days: 'i', early_bird_discount: 'f',
    min_advance_days: 'i', max_advance_days: 'i', checkin_days: 's', active: 'i', sort: 'i',
    deposit_amount: 'c', deposit_when: 's', deposit_min_nights: 'i', deposit_release_days: 'i', deposit_dates: 'r' };
  const conv = (t, v) => t === 'r' ? JSON.stringify((Array.isArray(v) ? v : []).filter(x => isDate(x.from) && isDate(x.to) && x.from <= x.to).map(x => ({ from: x.from, to: x.to, label: String(x.label || '').slice(0, 60) }))) : t === 'j' ? JSON.stringify((Array.isArray(v) ? v : []).map(x => ({ nights: parseInt(x.nights, 10), pct: Number(String(x.pct).replace(',', '.')) })).filter(x => x.nights > 0 && x.pct > 0 && x.pct <= 90)) : t === 'c' ? cents(v) : t === 'i' ? intOrNull(v) : t === 'f' ? (v === '' || v == null ? 0 : Number(String(v).replace(',', '.'))) : String(v ?? '');
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
      if (['last_minute_days', 'early_bird_days', 'min_advance_days', 'deposit_amount', 'deposit_min_nights'].includes(k) && v == null) v = 0;
      if (k === 'deposit_release_days' && v == null) v = 2;
      if (k === 'deposit_when' && !['never', 'always', 'rules'].includes(v)) v = 'never';
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

  // Extras (leña, salida tarde…)
  const extraId = (path.match(/^\/api\/admin\/extras\/(\d+)$/) || [])[1];
  if ((path === '/api/admin/extras' && req.method === 'POST') || (extraId && req.method === 'PUT')) {
    const name = String(b.name || '').trim();
    if (!name) return bad('Pon un nombre al extra');
    const price = cents(b.price);
    if (price == null || !(price >= 0)) return bad('Precio no válido');
    const days = (Array.isArray(b.checkout_days) ? b.checkout_days : String(b.checkout_days || '').split(',')).filter(v => v !== '' && /^[0-6]$/.test(String(v))).join(',');
    const vals = [name.slice(0, 80), String(b.description || '').slice(0, 240), price, b.per === 'night' ? 'night' : 'stay',
      Math.max(1, Math.min(20, parseInt(b.max_qty, 10) || 1)), days, b.needs_free_checkout ? 1 : 0, b.active === false || b.active === 0 ? 0 : 1];
    if (extraId) await db.prepare('UPDATE extras SET name=?, description=?, price=?, per=?, max_qty=?, checkout_days=?, needs_free_checkout=?, active=? WHERE id = ?').bind(...vals, Number(extraId)).run();
    else {
      const max = await db.prepare('SELECT coalesce(max(sort), 0) AS s FROM extras').first();
      await db.prepare('INSERT INTO extras (name, description, price, per, max_qty, checkout_days, needs_free_checkout, active, sort) VALUES (?,?,?,?,?,?,?,?,?)').bind(...vals, max.s + 1).run();
    }
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/extras\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM extras WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PATCH') { await db.prepare('UPDATE extras SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, Number(m[1])).run(); return json({ ok: true }); }
  }

  // Códigos promocionales
  const promoId = (path.match(/^\/api\/admin\/promos\/(\d+)$/) || [])[1];
  if ((path === '/api/admin/promos' && req.method === 'POST') || (promoId && req.method === 'PUT')) {
    const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return bad('Código no válido (3-30 letras/números)');
    const value = b.kind === 'fixed' ? cents(b.value) : parseInt(b.value, 10);
    if (!value || value <= 0 || (b.kind !== 'fixed' && value > 100)) return bad('Valor del descuento no válido');
    const vals = [code, b.kind === 'fixed' ? 'fixed' : 'pct', value, intOrNull(b.unit_id), b.valid_from || null, b.valid_to || null, intOrNull(b.min_nights) || 0, intOrNull(b.max_uses), b.note || '', b.exclusive ? 1 : 0, b.no_weekend ? 1 : 0, String(b.blackout || '').trim() || null];
    try {
      if (promoId) await db.prepare('UPDATE promo_codes SET code=?, kind=?, value=?, unit_id=?, valid_from=?, valid_to=?, min_nights=?, max_uses=?, note=?, exclusive=?, no_weekend=?, blackout=? WHERE id = ?').bind(...vals, Number(promoId)).run();
      else await db.prepare('INSERT INTO promo_codes (code, kind, value, unit_id, valid_from, valid_to, min_nights, max_uses, note, exclusive, no_weekend, blackout) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...vals).run();
    } catch { return bad('Ese código ya existe'); }
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/promos\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM promo_codes WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PATCH') {
      if ('active' in b) await db.prepare('UPDATE promo_codes SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, Number(m[1])).run();
      if ('exclusive' in b) await db.prepare('UPDATE promo_codes SET exclusive = ? WHERE id = ?').bind(b.exclusive ? 1 : 0, Number(m[1])).run();
      return json({ ok: true });
    }
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
    const r = await db.prepare('INSERT INTO photos (unit_id, mime, data, caption, sort, category) VALUES (?,?,?,?,?,?)').bind(intOrNull(b.unit_id), m2[1], bin, b.caption || '', max.s + 1, b.category || null).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (path === '/api/admin/photos/order' && req.method === 'PUT') {
    await db.batch((b.ids || []).map((id, i) => db.prepare('UPDATE photos SET sort = ? WHERE id = ?').bind(i, id)));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/photos\/(\d+)$/))) {
    if (req.method === 'DELETE') { await db.prepare('DELETE FROM photos WHERE id = ?').bind(Number(m[1])).run(); return json({ ok: true }); }
    if (req.method === 'PATCH') {
      const cur = await db.prepare('SELECT caption, unit_id, category FROM photos WHERE id = ?').bind(Number(m[1])).first();
      if (!cur) return bad('Foto no encontrada', 404);
      const v = k => (k in b ? b[k] : cur[k]);
      await db.prepare('UPDATE photos SET caption = ?, unit_id = ?, category = ? WHERE id = ?').bind(v('caption') || '', intOrNull(v('unit_id')), v('category') || null, Number(m[1])).run();
      return json({ ok: true });
    }
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
      if (path === '/api/t' && req.method === 'POST') return await track(req, env, url);
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
      if ((m = path.match(/^\/fianza\/(TS-[A-Z0-9]{6})$/))) {
        env = await withConfig(env);
        if (url.searchParams.get('t') !== (await refToken(env.DB, 'fianza-' + m[1]))) return new Response('Enlace no válido', { status: 403 });
        const bk = await env.DB.prepare('SELECT * FROM bookings WHERE ref = ?').bind(m[1]).first();
        const done = new Response(null, { status: 303, headers: { Location: `/reserva?ref=${m[1]}` } });
        if (!bk || bk.status !== 'confirmed' || !(bk.deposit > 0) || ['held', 'captured', 'released'].includes(bk.deposit_status) || !env.STRIPE_SECRET_KEY) return done;
        const site = await getSettings(env.DB);
        const sess = await depositCheckout(env, bk, url.origin, site.site_name);
        return new Response(null, { status: 303, headers: { Location: sess.url } });
      }
      if (path === '/factura/muestra') {
        const site = await getSettings(env.DB);
        if (url.searchParams.get('t') !== (await refToken(env.DB, 'muestra')) || !invoiceReady(site)) return new Response('Enlace no válido', { status: 403 });
        const unit = await getUnit(env.DB, 1);
        return new Response(invoiceHtml(site, unit, await sampleBooking(env.DB, unit, site), url.origin), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      if ((m = path.match(/^\/factura\/(TS-[A-Z0-9]{6})$/))) {
        return serveInvoice(env, m[1], url.searchParams.get('t'), url.origin, await getSettings(env.DB));
      }
      if (path === '/baja') return unsubscribePage(env.DB, url.searchParams.get('t'), await getSettings(env.DB));
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
    ctx.waitUntil((async () => {
      await Promise.all([syncAll(env.DB), expirePending(env.DB), cleanupAnalytics(env.DB).catch(() => {})]);
      const cfg = await withConfig(env);
      try { await runDeposits(cfg, await getSettings(env.DB)); } catch (e) { console.error('fianzas', e); }
      try { await runMarketing(cfg, await getSettings(env.DB)); } catch (e) { console.error('seguimiento', e); }
    })());
  },
};
