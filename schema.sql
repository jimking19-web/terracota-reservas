-- Terracota Suites · sistema de reservas
-- Importes SIEMPRE en céntimos (enteros) para que los cálculos sean exactos.

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  summary TEXT DEFAULT '',
  description TEXT DEFAULT '',
  max_guests INTEGER NOT NULL DEFAULT 4,
  base_guests INTEGER NOT NULL DEFAULT 2,          -- personas incluidas en el precio
  bedrooms INTEGER DEFAULT 1,
  beds INTEGER DEFAULT 1,
  bathrooms INTEGER DEFAULT 1,
  base_price INTEGER NOT NULL DEFAULT 10000,       -- precio noche base (céntimos)
  weekend_price INTEGER,                           -- precio noche fin de semana (opcional)
  weekend_nights TEXT NOT NULL DEFAULT '5,6',      -- noches que cuentan como finde (0=dom ... 5=vie, 6=sáb)
  min_nights INTEGER NOT NULL DEFAULT 2,
  max_nights INTEGER NOT NULL DEFAULT 30,
  cleaning_fee INTEGER NOT NULL DEFAULT 0,
  extra_guest_fee INTEGER NOT NULL DEFAULT 0,      -- por persona extra y noche
  weekly_discount REAL NOT NULL DEFAULT 0,         -- % a partir de 7 noches
  monthly_discount REAL NOT NULL DEFAULT 0,        -- % a partir de 28 noches
  stay_discounts TEXT NOT NULL DEFAULT '[]',       -- tramos [{nights, pct}] p. ej. 2+ noches 25 %
  last_minute_days INTEGER NOT NULL DEFAULT 0,
  last_minute_discount REAL NOT NULL DEFAULT 0,
  early_bird_days INTEGER NOT NULL DEFAULT 0,
  early_bird_discount REAL NOT NULL DEFAULT 0,
  min_advance_days INTEGER NOT NULL DEFAULT 0,     -- antelación mínima para reservar
  max_advance_days INTEGER NOT NULL DEFAULT 365,
  checkin_days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', -- días de la semana en que se puede entrar
  deposit_amount INTEGER NOT NULL DEFAULT 0,       -- fianza (céntimos) que se retiene en la tarjeta
  deposit_when TEXT NOT NULL DEFAULT 'never',      -- never | always | rules
  deposit_min_nights INTEGER NOT NULL DEFAULT 0,   -- rules: estancias de X noches o más
  deposit_dates TEXT NOT NULL DEFAULT '[]',        -- rules: rangos [{from, to, label}] en los que aplica
  deposit_release_days INTEGER NOT NULL DEFAULT 2, -- días tras la salida para liberarla
  ical_token TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,      -- primera noche (YYYY-MM-DD)
  end_date TEXT NOT NULL,        -- última noche incluida
  price INTEGER NOT NULL,
  weekend_price INTEGER,
  min_nights INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#c2410c'
);

-- Precio / estancia mínima / cierre para un día concreto (gana a todo lo demás)
CREATE TABLE IF NOT EXISTS day_rules (
  unit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  price INTEGER,
  min_nights INTEGER,
  closed INTEGER NOT NULL DEFAULT 0,
  no_checkin INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  PRIMARY KEY (unit_id, date)
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pct',   -- 'pct' o 'fixed'
  value INTEGER NOT NULL,             -- % (entero) o céntimos
  unit_id INTEGER,                    -- NULL = todas
  valid_from TEXT,                    -- fechas de estancia
  valid_to TEXT,
  min_nights INTEGER DEFAULT 0,
  max_uses INTEGER,                   -- NULL = ilimitado
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  unit_id INTEGER NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  nights INTEGER NOT NULL,
  guests INTEGER NOT NULL DEFAULT 1,
  name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  notes TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  breakdown TEXT,
  promo_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | cancelled | expired
  source TEXT NOT NULL DEFAULT 'web',     -- web | manual | bloqueo
  stripe_session TEXT,
  stripe_payment TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  internal_note TEXT,
  billing TEXT,                           -- datos de factura opcionales {name, nif, address}
  invoice_no TEXT,                        -- nº de factura (se asigna al confirmar)
  invoice_date TEXT,
  mail_sent_at TEXT,                      -- último email de confirmación enviado al huésped
  deposit INTEGER NOT NULL DEFAULT 0,     -- fianza de esta reserva (céntimos)
  deposit_status TEXT,                    -- pending | held | captured | released
  deposit_pi TEXT,                        -- PaymentIntent de la retención
  deposit_held_at TEXT,
  deposit_captured INTEGER,
  deposit_keep INTEGER NOT NULL DEFAULT 0, -- 1 = no liberar automáticamente
  deposit_note TEXT,
  stripe_customer TEXT,
  stripe_pm TEXT,                         -- tarjeta guardada para la fianza
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_unit_dates ON bookings(unit_id, checkin, checkout);

CREATE TABLE IF NOT EXISTS ical_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  last_sync TEXT,
  last_status TEXT
);

CREATE TABLE IF NOT EXISTS external_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,   -- exclusivo (día de salida)
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_ext_unit ON external_blocks(unit_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER,          -- NULL = foto general del alojamiento
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  category TEXT,            -- salon, cocina, dormitorio, bano, exterior
  src TEXT                  -- si tiene valor, la foto se sirve desde /public (p. ej. /img/fotos/x.jpg)
);

-- Extras que el huésped puede añadir al reservar (leña, salida tarde…)
CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER,                          -- NULL = todos los alojamientos
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,         -- céntimos
  per TEXT NOT NULL DEFAULT 'stay',         -- stay = por estancia · night = por noche
  max_qty INTEGER NOT NULL DEFAULT 1,       -- 1 = sí/no · >1 = el huésped elige cantidad
  checkout_days TEXT NOT NULL DEFAULT '',   -- solo si la salida cae en estos días (0=dom … 6=sáb); vacío = siempre
  needs_free_checkout INTEGER NOT NULL DEFAULT 0, -- solo si nadie entra el día de salida (p. ej. salida tarde)
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

-- Unidad inicial
INSERT OR IGNORE INTO units (id, slug, name, summary, max_guests, base_guests, base_price, weekend_price, min_nights, cleaning_fee, ical_token)
VALUES (1, 'terracota', 'Terracota Suites', 'Alojamiento con alberca en el corazón del Noroeste murciano', 4, 2, 9000, 11000, 2, 3000, lower(hex(randomblob(16))));
