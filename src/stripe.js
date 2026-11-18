// Stripe sin SDK: Checkout Sessions + verificación de webhooks con Web Crypto.

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripeRequest(env, method, path, params) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? form(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error?.message || 'Error de Stripe');
    e.code = data.error?.code || data.error?.decline_code || '';
    e.paymentIntent = data.error?.payment_intent?.id || '';
    throw e;
  }
  return data;
}

export async function createCheckout(env, { booking, unit, origin, siteName, expiresAt }) {
  const deposit = booking.deposit > 0;
  const eur = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: c % 100 ? 2 : 0 });
  return stripeRequest(env, 'POST', '/checkout/sessions', {
    ...(deposit ? {
      customer_creation: 'always',
      custom_text: { submit: { message: `Guardamos tu tarjeta de forma segura para la fianza de ${eur(booking.deposit)}: se retiene (sin cobrarse) el día antes de tu llegada y se libera tras la salida.` } },
    } : {}),
    mode: 'payment',
    customer_email: booking.email,
    locale: 'es',
    client_reference_id: booking.ref,
    expires_at: Math.floor(expiresAt / 1000),
    success_url: `${origin}/reserva?ref=${booking.ref}&pago=ok`,
    cancel_url: `${origin}/reserva?ref=${booking.ref}&pago=cancelado`,
    metadata: { ref: booking.ref, unit: unit.slug },
    payment_intent_data: { description: `${siteName} · ${booking.checkin} → ${booking.checkout} · ${booking.ref}`, metadata: { ref: booking.ref }, ...(deposit ? { setup_future_usage: 'off_session' } : {}) },
    line_items: { 0: { quantity: 1, price_data: {
      currency: 'eur', unit_amount: booking.total,
      product_data: { name: `${unit.name} · ${booking.nights} ${booking.nights === 1 ? 'noche' : 'noches'}`, description: `Entrada ${booking.checkin} · Salida ${booking.checkout} · ${booking.guests} huéspedes` },
    } } },
  });
}

function hexToBytes(hex) { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a; }

export async function verifyWebhook(env, payload, header) {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = parts.t;
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for (const s of sigs) {
    if (await crypto.subtle.verify('HMAC', key, hexToBytes(s), new TextEncoder().encode(`${t}.${payload}`))) return true;
  }
  return false;
}
