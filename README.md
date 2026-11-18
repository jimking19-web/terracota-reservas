# Terracota Suites · Reservas directas

Web propia con calendario, precios por noche, pago con Stripe y sincronización con Airbnb/Booking.
Funciona en Cloudflare Workers + D1 (la misma cuenta que Podium).

- Web pública: `/`
- Panel: `/admin` (contraseña = secreto `ADMIN_PASSWORD`)
- Página de estado de la reserva: `/reserva?ref=TS-XXXXXX`
- Calendario iCal para Airbnb/Booking: lo copias desde el panel → «Airbnb / Booking»

## Puesta en marcha (una sola vez)

La base de datos D1 `terracota-reservas` ya está creada y con las tablas (id en `wrangler.toml`).

1. **Conectar el repo en Cloudflare**: Workers & Pages → Create → Import a repository → `terracota-reservas`.
   Build command: vacío · Deploy command: `npx wrangler deploy`.
2. **Secretos** (Worker → Settings → Variables and Secrets → *Secret*):
   | Nombre | Para qué |
   |---|---|
   | `ADMIN_PASSWORD` | Contraseña del panel |
   | `STRIPE_SECRET_KEY` | `sk_live_…` (o `sk_test_…` para probar). Sin ella, las reservas llegan como *solicitudes* sin pago |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` del paso 3 |
   | `RESEND_API_KEY` *(opcional)* | Emails de confirmación al huésped y a ti |
   | `MAIL_FROM` *(opcional)* | p. ej. `Terracota Suites <reservas@tudominio.com>` (dominio verificado en Resend) |
   | `OWNER_EMAIL` *(opcional)* | Dónde recibes los avisos (si no, el email de «Web y fotos») |
3. **Webhook de Stripe**: Stripe → Desarrolladores → Webhooks → Añadir endpoint
   `https://TU-DOMINIO/api/stripe/webhook` con los eventos `checkout.session.completed`,
   `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`.
4. **Dominio** (opcional): Worker → Settings → Domains & Routes → Add custom domain.
5. **Airbnb/Booking**: en el panel, pestaña «Airbnb / Booking», pega sus enlaces iCal de exportación y copia tu enlace en ambas plataformas.

## Cómo calcula el precio

Cada noche: precio fijado a mano en el calendario → temporada (la de mayor prioridad) → precio base
(con precio de fin de semana si la noche es de las marcadas). Después: huéspedes extra, descuento semanal/mensual,
última hora o anticipada, código promocional y, al final, limpieza. Todo en céntimos, sin redondeos acumulados.
El servidor recalcula siempre el total antes de cobrar.

## Desarrollo local

```bash
npm install
npm run db:local          # crea las tablas en local
echo 'ADMIN_PASSWORD=prueba' > .dev.vars
npm run dev               # http://localhost:8787
```
