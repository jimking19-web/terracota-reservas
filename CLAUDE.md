# Terracota Suites · Reservas directas: notas para trabajar en este repositorio

## Qué es
Web propia de reservas directas del alojamiento rural **Terracota Suites** (Bullas, Murcia), parecida a Bookingmood. Tiene calendario, precio por noche, pago total con Stripe, extras, fianza opcional, facturas y sincronización iCal con Airbnb y Booking. Ahora mismo hay 1 unidad; quizá 2 más adelante.
Funciona en **Cloudflare Workers + D1** (la misma cuenta que Podium). Se publica en `terracota-reservas.podium-cloud.workers.dev`. Cada cambio en `main` se despliega solo.

## Cómo hablar con Javier
- Responde siempre en español, claro y sin tecnicismos innecesarios. Javier no es programador.
- No le hagas perder el tiempo: antes de pedirle algo, comprueba si puedes hacerlo tú (repo, Cloudflare, Stripe…).
- **Este repositorio es PÚBLICO.** Nunca subas claves, contraseñas, datos de huéspedes ni nada privado. Los secretos van en Cloudflare (`ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`…).
- Cuidado con lo que cobra dinero real (Stripe en modo live): avísale antes de cambiar precios, cobros o fianzas.

## Reglas del negocio
- Precios: 165 €/noche de lunes a jueves y 190 €/noche viernes, sábado y domingo; 25 % de descuento a partir de 2 noches. Se configuran en el panel.
- El cálculo va en céntimos y el servidor recalcula siempre el total antes de cobrar (ver `src/pricing.js` y el README).
- Fianza de 120 € retenida en tarjeta, solo en los casos que elige Javier (por ejemplo, más de 7 noches o fechas concretas) (`src/deposit.js`).
- Extras al reservar (leña extra, salida tarde el domingo…).
- Email de confirmación al huésped con el resumen de la reserva y la factura. El remitente se configura en los secretos de Cloudflare.
- Facturas sin IVA (exento), a nombre del titular (`src/invoice.js`; los datos fiscales salen del panel, no del código).
- La cuenta de Stripe es la que usaba con Bookingmood, no la de Bodas de Papel.

## Estructura
- `src/index.js`: rutas y API. Un cron cada 15 min sincroniza Airbnb/Booking y libera las reservas no pagadas.
- `src/pricing.js`, `dates.js`, `stripe.js`, `deposit.js`, `invoice.js`, `ical.js`, `mail.js`, `smtp.js`.
- `public/`: web pública (`index.html`, `app.js`, `reserva.html`) y panel `/admin`.
- `schema.sql`: tablas de D1. Si lo cambias, prepara también la migración para la base que ya está en marcha, sin borrar datos.

## Probar y publicar
- En local: `npm install` y luego `npm run dev`.
- Publicar: con un push a `main` se despliega solo. A mano: `npm run deploy`.
