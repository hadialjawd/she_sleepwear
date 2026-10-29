-- Redesign: supplier code + minimum price on products, style photos, saved customers,
-- default delivery fee and WhatsApp message templates.
-- Run once on a database that already has 0002_google_login.sql.

ALTER TABLE products ADD COLUMN code TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN min_price_usd REAL NOT NULL DEFAULT 0;

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

ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- Backfill customers from past orders. Phone is normalized the same way as the server
-- (normalizePhone in src/index.js): Lebanese mobiles become 961 + number, anything else stays as its digits.
CREATE TABLE migration_order_phones AS
WITH d AS (
  SELECT id, date, customer_name AS name, area,
    replace(replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), '/', '') AS digits
  FROM orders WHERE trim(phone) != ''
), a AS (SELECT *, CASE WHEN digits LIKE '00%' THEN substr(digits, 3) ELSE digits END AS p FROM d),
b AS (SELECT id, date, name, area, digits, CASE WHEN p LIKE '961%' THEN substr(p, 4) ELSE p END AS p FROM a),
c AS (SELECT id, date, name, area, digits, CASE WHEN p LIKE '0%' THEN substr(p, 2) ELSE p END AS p FROM b)
SELECT id, date, name, area,
  CASE
    WHEN length(p) = 7 AND p LIKE '3%' THEN '961' || p
    WHEN length(p) = 8 AND substr(p, 1, 2) IN ('70', '71', '76', '78', '79', '81') THEN '961' || p
    ELSE digits
  END AS phone
FROM c WHERE digits != '';

-- One customer per phone, using the newest order's name and area
INSERT OR IGNORE INTO customers (name, phone, area)
SELECT
  COALESCE((SELECT name FROM migration_order_phones o2 WHERE o2.phone = o.phone AND o2.name != '' ORDER BY o2.date DESC, o2.id DESC LIMIT 1), ''),
  o.phone,
  COALESCE((SELECT area FROM migration_order_phones o2 WHERE o2.phone = o.phone AND o2.area != '' ORDER BY o2.date DESC, o2.id DESC LIMIT 1), '')
FROM migration_order_phones o GROUP BY o.phone;

UPDATE orders SET customer_id = (
  SELECT c.id FROM migration_order_phones op JOIN customers c ON c.phone = op.phone WHERE op.id = orders.id
) WHERE id IN (SELECT id FROM migration_order_phones);

DROP TABLE migration_order_phones;

INSERT OR IGNORE INTO settings (key, value) VALUES ('default_delivery_fee', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wa_confirm', 'Hi {name}! Thank you for your order from She Sleepwear 🌙
{items}
Total: {total}
Delivery to: {area}
We''ll let you know when it''s on the way.');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wa_sent', 'Hi {name}! Your She Sleepwear order is on the way 🚚
Total to pay: {total}
Thank you!');
