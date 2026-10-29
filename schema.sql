-- She Sleepwear database (Cloudflare D1 / SQLite)
-- All money is stored in USD. LBP is converted using the rate in settings.

-- Allow list: only these Google accounts can sign in.
-- The owner (OWNER_EMAIL in wrangler.jsonc) is added on first sign-in.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  added_by INTEGER,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('lbp_rate', '89500');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_delivery_fee', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wa_confirm', 'Hi {name}! Thank you for your order from She Sleepwear 🌙
{items}
Total: {total}
Delivery to: {area}
We''ll let you know when it''s on the way.');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wa_sent', 'Hi {name}! Your She Sleepwear order is on the way 🚚
Total to pay: {total}
Thank you!');

-- One row per style + size + color
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  sale_price_usd REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  avg_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  code TEXT NOT NULL DEFAULT '',
  min_price_usd REAL NOT NULL DEFAULT 0,
  UNIQUE (style, size, color)
);

-- Saved customers. Phone is stored normalized (digits, with 961), one customer per phone.
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone != '';

-- One photo per style (shown in stock and when picking items)
CREATE TABLE IF NOT EXISTS style_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A shipment from Turkey. Status: 'on_the_way' or 'arrived'.
-- When it arrives, extra costs are split per piece and stock is added.
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  shipping_usd REAL NOT NULL DEFAULT 0,
  customs_usd REAL NOT NULL DEFAULT 0,
  other_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on_the_way',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_cost_usd REAL NOT NULL,
  landed_cost_usd REAL
);

-- Status: new -> sent -> delivered -> paid, or returned / cancelled.
-- For cash on delivery, 'delivered' means the driver still owes you the money.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cod',
  status TEXT NOT NULL DEFAULT 'new',
  total_usd REAL NOT NULL DEFAULT 0,
  delivery_cost_usd REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  customer_id INTEGER REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price_usd REAL NOT NULL,
  unit_cost_usd REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount_usd REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Receipt photos (shrunk in the browser before upload, so they stay small)
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER REFERENCES shipments(id) ON DELETE CASCADE,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_receipts_shipment ON receipts(shipment_id);
