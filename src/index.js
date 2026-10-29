// She Sleepwear: Cloudflare Worker API.
// Static files in /public are served by Workers Assets; this file handles /api/*.

import { isIcon, iconResponse } from './icons.js';

const SESSION_DAYS = 30;
const COUNTED = ['new', 'sent', 'delivered', 'paid']; // order statuses that hold stock
const EARNED = ['delivered', 'paid']; // order statuses that count as sales
const ORDER_STATUSES = ['new', 'sent', 'delivered', 'paid', 'returned', 'cancelled'];
const PAYMENT_METHODS = ['cod', 'whish', 'omt', 'cash'];
const MAX_RECEIPT_BYTES = 1_500_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isIcon(url.pathname)) return iconResponse(url.pathname);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Bad request');
  }
}

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const int = (v, def = 0) => Math.trunc(num(v, def));
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const dateOr = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today());

// ---------- Auth (Google sign-in + allow list) ----------

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ownerEmail = (env) => String(env.OWNER_EMAIL || '').trim().toLowerCase();

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Google's public keys, cached while this Worker instance lives
let googleKeys = { keys: [], until: 0 };
async function getGoogleKey(kid) {
  if (Date.now() > googleKeys.until || !googleKeys.keys.some((k) => k.kid === kid)) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new HttpError(502, 'Could not reach Google, try again');
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    googleKeys = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  }
  return googleKeys.keys.find((k) => k.kid === kid);
}

// Checks a Google sign-in token and returns its details, or throws.
async function verifyGoogleToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Sign-in failed');
  const header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  const jwk = await getGoogleKey(header.kid);
  if (!jwk || header.alg !== 'RS256') throw new HttpError(401, 'Sign-in failed');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Date.now() / 1000;
  if (!ok
    || claims.aud !== env.GOOGLE_CLIENT_ID
    || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
    || claims.exp < now
    || !claims.email
    || (claims.email_verified !== true && claims.email_verified !== 'true')) {
    throw new HttpError(401, 'Sign-in failed');
  }
  return claims;
}

async function startSession(env, userId, url) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expires).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function currentUser(request, env) {
  const token = getCookie(request, 'sid');
  if (!token) return null;
  const user = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
  ).bind(token, new Date().toISOString()).first();
  return user && withRole(user, env);
}

// Owner is always exactly OWNER_EMAIL, so changing that setting moves ownership
function withRole(user, env) {
  return { ...user, role: user.email === ownerEmail(env) ? 'owner' : 'member' };
}

async function googleLogin(request, env, url) {
  if (!env.GOOGLE_CLIENT_ID || !ownerEmail(env)) throw new HttpError(500, 'Google sign-in is not set up yet');
  const b = await body(request);
  const claims = await verifyGoogleToken(b.credential, env);
  const email = claims.email.toLowerCase();

  // The owner is always allowed. Everyone else must be on the allow list.
  if (email === ownerEmail(env)) {
    await env.DB.prepare(
      "INSERT INTO users (email, name, role) VALUES (?, ?, 'owner') ON CONFLICT (email) DO UPDATE SET role = 'owner'"
    ).bind(email, str(claims.name, 100)).run();
  }
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) throw new HttpError(403, `${email} is not on the allow list. Ask the owner to add you.`);
  await env.DB.prepare('UPDATE users SET name = COALESCE(NULLIF(?, \'\'), name), picture = ?, last_login = datetime(\'now\') WHERE id = ?')
    .bind(str(claims.name, 100), str(claims.picture, 500), user.id).run();
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, user.id, url) });
}

// ---------- Router ----------

async function handleApi(request, env, url) {
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;

  // Block cross-site form posts (simple CSRF guard)
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Forbidden');
  }

  // Public routes
  if (resource === 'me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({ user, googleClientId: env.GOOGLE_CLIENT_ID || null });
  }
  if (resource === 'login' && method === 'POST') return googleLogin(request, env, url);
  if (resource === 'logout' && method === 'POST') {
    const token = getCookie(request, 'sid');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'set-cookie': 'sid=; Path=/; HttpOnly; Max-Age=0' });
  }

  // Everything below needs login
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Please log in');

  switch (resource) {
    case 'users': return users(request, env, method, id, user);
    case 'settings': return settings(request, env, method);
    case 'products': return products(request, env, method, id);
    case 'shipments': return shipments(request, env, method, id, action, user);
    case 'receipts': return receipts(request, env, method, id, user);
    case 'orders': return orders(request, env, method, id, action, user, url);
    case 'expenses': return expenses(request, env, method, id, user, url);
    case 'dashboard': return dashboard(env, url);
    case 'export': return exportCsv(env, id);
  }
  throw new HttpError(404, 'Not found');
}

// ---------- Allow list & settings ----------

async function users(request, env, method, id, me) {
  if (method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, email, name, last_login, created_at FROM users ORDER BY created_at').all();
    return json(results.map((u) => withRole(u, env)).sort((a, b) => (b.role === 'owner') - (a.role === 'owner')));
  }
  if (me.role !== 'owner') throw new HttpError(403, 'Only the owner can change who has access');
  if (method === 'POST') {
    const b = await body(request);
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
    try {
      await env.DB.prepare("INSERT INTO users (email, name, role, added_by) VALUES (?, ?, 'member', ?)").bind(email, str(b.name, 100), me.id).run();
    } catch {
      throw new HttpError(400, 'This email is already on the list');
    }
    return json({ ok: true });
  }
  if (method === 'DELETE' && id) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(int(id)).first();
    if (!target) throw new HttpError(404, 'Not found');
    if (target.email === ownerEmail(env)) throw new HttpError(400, 'The owner cannot be removed');
    // Removing someone also logs them out everywhere
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

async function settings(request, env, method) {
  if (method === 'PUT') {
    const b = await body(request);
    const rate = num(b.lbp_rate);
    if (rate <= 0) throw new HttpError(400, 'Rate must be more than 0');
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lbp_rate', ?)").bind(String(rate)).run();
  }
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = Object.fromEntries(results.map((r) => [r.key, r.value]));
  out.lbp_rate = num(out.lbp_rate, 89500);
  return json(out);
}

// ---------- Products (stock) ----------

async function products(request, env, method, id) {
  if (method === 'GET' && !id) {
    const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY style COLLATE NOCASE, color COLLATE NOCASE, size').all();
    return json(results);
  }
  if (method === 'POST') {
    const b = await body(request);
    const style = str(b.style, 100);
    if (!style) throw new HttpError(400, 'Style name is required');
    try {
      const r = await env.DB.prepare(
        'INSERT INTO products (style, size, color, sale_price_usd, qty, avg_cost_usd) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
      ).bind(style, str(b.size, 30), str(b.color, 50), round2(num(b.sale_price_usd)), int(b.qty), round2(num(b.avg_cost_usd))).first();
      return json(r);
    } catch {
      throw new HttpError(400, 'This style + size + color already exists');
    }
  }
  if (method === 'PUT' && id) {
    const b = await body(request);
    const style = str(b.style, 100);
    if (!style) throw new HttpError(400, 'Style name is required');
    try {
      const r = await env.DB.prepare(
        'UPDATE products SET style = ?, size = ?, color = ?, sale_price_usd = ?, qty = ?, avg_cost_usd = ? WHERE id = ? RETURNING *'
      ).bind(style, str(b.size, 30), str(b.color, 50), round2(num(b.sale_price_usd)), int(b.qty), round2(num(b.avg_cost_usd)), int(id)).first();
      if (!r) throw new HttpError(404, 'Not found');
      return json(r);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'This style + size + color already exists');
    }
  }
  if (method === 'DELETE' && id) {
    const used = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM order_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM shipment_items WHERE product_id = ?1) AS n'
    ).bind(int(id)).first('n');
    if (used > 0) throw new HttpError(400, 'Used in orders or shipments, so it cannot be deleted. Set the quantity to 0 instead.');
    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(int(id)).run();
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// Finds a product by style/size/color, or creates it. Returns its id.
async function findOrCreateProduct(env, item) {
  if (item.product_id) return int(item.product_id);
  const style = str(item.style, 100);
  if (!style) throw new HttpError(400, 'Each item needs a style name');
  const size = str(item.size, 30);
  const color = str(item.color, 50);
  const row = await env.DB.prepare(
    'INSERT INTO products (style, size, color, sale_price_usd) VALUES (?, ?, ?, ?) ON CONFLICT (style, size, color) DO UPDATE SET style = excluded.style RETURNING id'
  ).bind(style, size, color, round2(num(item.sale_price_usd))).first();
  return row.id;
}

// ---------- Shipments ----------

async function shipmentWithItems(env, id) {
  const s = await env.DB.prepare('SELECT * FROM shipments WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'Shipment not found');
  const { results: items } = await env.DB.prepare(
    'SELECT si.*, p.style, p.size, p.color FROM shipment_items si JOIN products p ON p.id = si.product_id WHERE si.shipment_id = ? ORDER BY si.id'
  ).bind(id).all();
  const { results: rec } = await env.DB.prepare('SELECT id, created_at FROM receipts WHERE shipment_id = ? ORDER BY id').bind(id).all();
  return { ...s, items, receipts: rec };
}

async function saveShipmentItems(env, shipmentId, items) {
  if (!Array.isArray(items)) return;
  const stmts = [env.DB.prepare('DELETE FROM shipment_items WHERE shipment_id = ?').bind(shipmentId)];
  for (const it of items) {
    const qty = int(it.qty);
    if (qty <= 0) continue;
    const pid = await findOrCreateProduct(env, it);
    stmts.push(env.DB.prepare('INSERT INTO shipment_items (shipment_id, product_id, qty, unit_cost_usd) VALUES (?, ?, ?, ?)')
      .bind(shipmentId, pid, qty, round2(num(it.unit_cost_usd))));
  }
  await env.DB.batch(stmts);
}

async function shipments(request, env, method, id, action, user) {
  if (method === 'GET' && !id) {
    const { results } = await env.DB.prepare(`
      SELECT s.*,
        COALESCE((SELECT SUM(qty) FROM shipment_items WHERE shipment_id = s.id), 0) AS pieces,
        COALESCE((SELECT SUM(qty * unit_cost_usd) FROM shipment_items WHERE shipment_id = s.id), 0) AS goods_usd,
        (SELECT COUNT(*) FROM receipts WHERE shipment_id = s.id) AS receipt_count
      FROM shipments s ORDER BY s.date DESC, s.id DESC`).all();
    return json(results);
  }
  if (method === 'GET' && id) return json(await shipmentWithItems(env, int(id)));

  if (method === 'POST' && !id) {
    const b = await body(request);
    const s = await env.DB.prepare(
      'INSERT INTO shipments (date, supplier, shipping_usd, customs_usd, other_usd, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
    ).bind(dateOr(b.date), str(b.supplier, 100), round2(num(b.shipping_usd)), round2(num(b.customs_usd)), round2(num(b.other_usd)), str(b.notes, 1000), user.id).first();
    await saveShipmentItems(env, s.id, b.items);
    return json(await shipmentWithItems(env, s.id));
  }

  const sid = int(id);
  const existing = await env.DB.prepare('SELECT * FROM shipments WHERE id = ?').bind(sid).first();
  if (!existing) throw new HttpError(404, 'Shipment not found');

  if (method === 'PUT') {
    const b = await body(request);
    if (existing.status === 'arrived') {
      // After arrival only notes can change; costs are already in stock
      await env.DB.prepare('UPDATE shipments SET notes = ?, supplier = ? WHERE id = ?').bind(str(b.notes, 1000), str(b.supplier, 100), sid).run();
    } else {
      await env.DB.prepare('UPDATE shipments SET date = ?, supplier = ?, shipping_usd = ?, customs_usd = ?, other_usd = ?, notes = ? WHERE id = ?')
        .bind(dateOr(b.date), str(b.supplier, 100), round2(num(b.shipping_usd)), round2(num(b.customs_usd)), round2(num(b.other_usd)), str(b.notes, 1000), sid).run();
      await saveShipmentItems(env, sid, b.items);
    }
    return json(await shipmentWithItems(env, sid));
  }

  if (method === 'POST' && action === 'arrive') {
    if (existing.status === 'arrived') throw new HttpError(400, 'Already marked as arrived');
    const { results: items } = await env.DB.prepare(
      'SELECT si.*, p.qty AS stock_qty, p.avg_cost_usd FROM shipment_items si JOIN products p ON p.id = si.product_id WHERE si.shipment_id = ?'
    ).bind(sid).all();
    if (!items.length) throw new HttpError(400, 'Add items before marking as arrived');
    const pieces = items.reduce((a, it) => a + it.qty, 0);
    const extraPerPiece = (existing.shipping_usd + existing.customs_usd + existing.other_usd) / pieces;

    // Track running stock per product in case one product appears twice
    const stock = new Map();
    const stmts = [];
    for (const it of items) {
      const cur = stock.get(it.product_id) || { qty: it.stock_qty, avg: it.avg_cost_usd };
      const landed = it.unit_cost_usd + extraPerPiece;
      const oldQty = Math.max(cur.qty, 0);
      const newAvg = (oldQty * cur.avg + it.qty * landed) / (oldQty + it.qty);
      stock.set(it.product_id, { qty: cur.qty + it.qty, avg: newAvg });
      stmts.push(env.DB.prepare('UPDATE shipment_items SET landed_cost_usd = ? WHERE id = ?').bind(round2(landed), it.id));
    }
    for (const [pid, s] of stock) {
      stmts.push(env.DB.prepare('UPDATE products SET qty = ?, avg_cost_usd = ? WHERE id = ?').bind(s.qty, round2(s.avg), pid));
    }
    stmts.push(env.DB.prepare("UPDATE shipments SET status = 'arrived' WHERE id = ?").bind(sid));
    await env.DB.batch(stmts);
    return json(await shipmentWithItems(env, sid));
  }

  if (method === 'DELETE') {
    if (existing.status === 'arrived') throw new HttpError(400, 'This shipment is already in your stock, so it cannot be deleted');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipts WHERE shipment_id = ?').bind(sid),
      env.DB.prepare('DELETE FROM shipment_items WHERE shipment_id = ?').bind(sid),
      env.DB.prepare('DELETE FROM shipments WHERE id = ?').bind(sid),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- Receipts ----------

async function receipts(request, env, method, id, user) {
  if (method === 'POST' && !id) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'No photo');
    if (!/^image\//.test(file.type)) throw new HttpError(400, 'Only photos are allowed');
    const data = await file.arrayBuffer();
    if (data.byteLength > MAX_RECEIPT_BYTES) throw new HttpError(400, 'Photo is too big');
    const shipmentId = form.get('shipment_id') ? int(form.get('shipment_id')) : null;
    const expenseId = form.get('expense_id') ? int(form.get('expense_id')) : null;
    if (!shipmentId && !expenseId) throw new HttpError(400, 'Receipt must belong to a shipment or expense');
    const r = await env.DB.prepare('INSERT INTO receipts (shipment_id, expense_id, mime, data, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(shipmentId, expenseId, file.type, data, user.id).first();
    return json(r);
  }
  if (method === 'GET' && id) {
    const r = await env.DB.prepare('SELECT mime, data FROM receipts WHERE id = ?').bind(int(id)).first();
    if (!r) throw new HttpError(404, 'Not found');
    return new Response(new Uint8Array(r.data), { headers: { 'content-type': r.mime, 'cache-control': 'private, max-age=86400' } });
  }
  if (method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(int(id)).run();
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- Orders ----------

async function orderWithItems(env, id) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'Order not found');
  const { results: items } = await env.DB.prepare(
    'SELECT oi.*, p.style, p.size, p.color FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id'
  ).bind(id).all();
  return { ...o, items };
}

// Statements that move stock for an order's items. sign = -1 takes from stock, +1 returns it.
function stockMoves(env, items, sign) {
  return items.map((it) => env.DB.prepare('UPDATE products SET qty = qty + ? WHERE id = ?').bind(sign * it.qty, it.product_id));
}

async function buildOrderItems(env, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one item');
  const out = [];
  for (const it of items) {
    const qty = int(it.qty);
    if (qty <= 0) continue;
    const p = await env.DB.prepare('SELECT id, avg_cost_usd FROM products WHERE id = ?').bind(int(it.product_id)).first();
    if (!p) throw new HttpError(400, 'Item not found in stock');
    out.push({ product_id: p.id, qty, unit_price_usd: round2(num(it.unit_price_usd)), unit_cost_usd: p.avg_cost_usd });
  }
  if (!out.length) throw new HttpError(400, 'Add at least one item');
  return out;
}

function orderFields(b) {
  const status = ORDER_STATUSES.includes(b.status) ? b.status : 'new';
  const payment = PAYMENT_METHODS.includes(b.payment_method) ? b.payment_method : 'cod';
  return [dateOr(b.date), str(b.customer_name, 100), str(b.phone, 30), str(b.area, 100), payment, status,
    round2(num(b.total_usd)), round2(num(b.delivery_cost_usd)), str(b.notes, 1000)];
}

async function orders(request, env, method, id, action, user, url) {
  if (method === 'GET' && !id) {
    const status = url.searchParams.get('status');
    const q = str(url.searchParams.get('q'), 100);
    let sql = `SELECT o.*, (SELECT GROUP_CONCAT(oi.qty || 'x ' || p.style || CASE WHEN p.size != '' THEN ' ' || p.size ELSE '' END || CASE WHEN p.color != '' THEN ' ' || p.color ELSE '' END, ', ')
               FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS summary
               FROM orders o WHERE 1=1`;
    const binds = [];
    if (status === 'owed') sql += " AND o.payment_method = 'cod' AND o.status = 'delivered'";
    else if (status === 'open') sql += " AND o.status IN ('new', 'sent')";
    else if (ORDER_STATUSES.includes(status)) { sql += ' AND o.status = ?'; binds.push(status); }
    if (q) { sql += ' AND (o.customer_name LIKE ? OR o.phone LIKE ? OR o.area LIKE ?)'; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ' ORDER BY o.date DESC, o.id DESC LIMIT 300';
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(results);
  }
  if (method === 'GET' && id) return json(await orderWithItems(env, int(id)));

  if (method === 'POST' && !id) {
    const b = await body(request);
    const items = await buildOrderItems(env, b.items);
    const fields = orderFields(b);
    const o = await env.DB.prepare(
      'INSERT INTO orders (date, customer_name, phone, area, payment_method, status, total_usd, delivery_cost_usd, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
    ).bind(...fields, user.id).first();
    const stmts = items.map((it) => env.DB.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_usd, unit_cost_usd) VALUES (?, ?, ?, ?, ?)')
      .bind(o.id, it.product_id, it.qty, it.unit_price_usd, it.unit_cost_usd));
    if (COUNTED.includes(fields[5])) stmts.push(...stockMoves(env, items, -1));
    await env.DB.batch(stmts);
    return json(await orderWithItems(env, o.id));
  }

  const oid = int(id);
  const old = await orderWithItems(env, oid);
  const oldCounted = COUNTED.includes(old.status);

  if (method === 'POST' && action === 'status') {
    const b = await body(request);
    if (!ORDER_STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status');
    const newCounted = COUNTED.includes(b.status);
    const stmts = [env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, oid)];
    if (oldCounted && !newCounted) stmts.push(...stockMoves(env, old.items, +1));
    if (!oldCounted && newCounted) stmts.push(...stockMoves(env, old.items, -1));
    await env.DB.batch(stmts);
    return json(await orderWithItems(env, oid));
  }

  if (method === 'PUT') {
    const b = await body(request);
    const items = await buildOrderItems(env, b.items);
    const fields = orderFields(b);
    // Keep the original cost for items that were already in the order
    for (const it of items) {
      const prev = old.items.find((o) => o.product_id === it.product_id);
      if (prev) it.unit_cost_usd = prev.unit_cost_usd;
    }
    const stmts = [];
    if (oldCounted) stmts.push(...stockMoves(env, old.items, +1));
    stmts.push(env.DB.prepare('UPDATE orders SET date = ?, customer_name = ?, phone = ?, area = ?, payment_method = ?, status = ?, total_usd = ?, delivery_cost_usd = ?, notes = ? WHERE id = ?')
      .bind(...fields, oid));
    stmts.push(env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(oid));
    for (const it of items) {
      stmts.push(env.DB.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_usd, unit_cost_usd) VALUES (?, ?, ?, ?, ?)')
        .bind(oid, it.product_id, it.qty, it.unit_price_usd, it.unit_cost_usd));
    }
    if (COUNTED.includes(fields[5])) stmts.push(...stockMoves(env, items, -1));
    await env.DB.batch(stmts);
    return json(await orderWithItems(env, oid));
  }

  if (method === 'DELETE') {
    const stmts = [];
    if (oldCounted) stmts.push(...stockMoves(env, old.items, +1));
    stmts.push(env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(oid));
    stmts.push(env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(oid));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- Expenses ----------

async function expenses(request, env, method, id, user, url) {
  if (method === 'GET' && !id) {
    const month = url.searchParams.get('month');
    let sql = 'SELECT e.*, (SELECT COUNT(*) FROM receipts WHERE expense_id = e.id) AS receipt_count, (SELECT MIN(id) FROM receipts WHERE expense_id = e.id) AS receipt_id FROM expenses e';
    const binds = [];
    if (/^\d{4}-\d{2}$/.test(month || '')) { sql += ' WHERE substr(e.date, 1, 7) = ?'; binds.push(month); }
    sql += ' ORDER BY e.date DESC, e.id DESC LIMIT 300';
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(results);
  }
  if (method === 'POST') {
    const b = await body(request);
    const amount = round2(num(b.amount_usd));
    if (amount <= 0) throw new HttpError(400, 'Amount must be more than 0');
    const r = await env.DB.prepare('INSERT INTO expenses (date, category, amount_usd, note, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .bind(dateOr(b.date), str(b.category, 50) || 'other', amount, str(b.note, 500), user.id).first();
    return json(r);
  }
  if (method === 'DELETE' && id) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipts WHERE expense_id = ?').bind(int(id)),
      env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(int(id)),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------- Dashboard ----------

async function dashboard(env, url) {
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today().slice(0, 7);
  const earned = EARNED.map((s) => `'${s}'`).join(',');

  // Last 6 months, ending at the chosen month
  const [y, m] = month.split('-').map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const first = months[0];

  const [sales, cogs, exp, bought, owed, open, stock, low, best, trendSales, trendCogs, trendExp] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_usd), 0) AS revenue, COALESCE(SUM(delivery_cost_usd), 0) AS delivery
      FROM orders WHERE status IN (${earned}) AND substr(date, 1, 7) = ?`).bind(month),
    env.DB.prepare(`SELECT COALESCE(SUM(oi.qty * oi.unit_cost_usd), 0) AS cogs, COALESCE(SUM(oi.qty), 0) AS pieces
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status IN (${earned}) AND substr(o.date, 1, 7) = ?`).bind(month),
    env.DB.prepare('SELECT COALESCE(SUM(amount_usd), 0) AS total FROM expenses WHERE substr(date, 1, 7) = ?').bind(month),
    env.DB.prepare(`SELECT COALESCE(SUM(s.shipping_usd + s.customs_usd + s.other_usd
        + COALESCE((SELECT SUM(qty * unit_cost_usd) FROM shipment_items WHERE shipment_id = s.id), 0)), 0) AS total
      FROM shipments s WHERE substr(s.date, 1, 7) = ?`).bind(month),
    env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_usd - delivery_cost_usd), 0) AS amount
      FROM orders WHERE payment_method = 'cod' AND status = 'delivered'`),
    env.DB.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_usd), 0) AS amount FROM orders WHERE status IN ('new', 'sent')`),
    env.DB.prepare('SELECT COALESCE(SUM(qty), 0) AS pieces, COALESCE(SUM(qty * avg_cost_usd), 0) AS value FROM products WHERE qty > 0'),
    env.DB.prepare('SELECT id, style, size, color, qty FROM products WHERE qty <= 2 ORDER BY qty, style LIMIT 10'),
    env.DB.prepare(`SELECT p.style, SUM(oi.qty) AS pieces, SUM(oi.qty * oi.unit_price_usd) AS sales
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
      WHERE o.status IN (${earned}) AND substr(o.date, 1, 7) = ? GROUP BY p.style ORDER BY pieces DESC LIMIT 5`).bind(month),
    env.DB.prepare(`SELECT substr(date, 1, 7) AS m, SUM(total_usd - delivery_cost_usd) AS net FROM orders
      WHERE status IN (${earned}) AND substr(date, 1, 7) BETWEEN ? AND ? GROUP BY m`).bind(first, month),
    env.DB.prepare(`SELECT substr(o.date, 1, 7) AS m, SUM(oi.qty * oi.unit_cost_usd) AS cogs FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN (${earned}) AND substr(o.date, 1, 7) BETWEEN ? AND ? GROUP BY m`).bind(first, month),
    env.DB.prepare(`SELECT substr(date, 1, 7) AS m, SUM(amount_usd) AS total FROM expenses
      WHERE substr(date, 1, 7) BETWEEN ? AND ? GROUP BY m`).bind(first, month),
  ]);

  const s = sales.results[0];
  const c = cogs.results[0];
  const e = exp.results[0].total;
  const byMonth = (rows, key) => Object.fromEntries(rows.results.map((r) => [r.m, r[key]]));
  const tSales = byMonth(trendSales, 'net');
  const tCogs = byMonth(trendCogs, 'cogs');
  const tExp = byMonth(trendExp, 'total');

  return json({
    month,
    revenue: round2(s.revenue),
    orders: s.orders,
    pieces_sold: c.pieces,
    cost_of_goods: round2(c.cogs),
    delivery: round2(s.delivery),
    expenses: round2(e),
    profit: round2(s.revenue - c.cogs - s.delivery - e),
    stock_bought: round2(bought.results[0].total),
    cod_owed: { orders: owed.results[0].orders, amount: round2(owed.results[0].amount) },
    open_orders: { orders: open.results[0].orders, amount: round2(open.results[0].amount) },
    stock: { pieces: stock.results[0].pieces, value: round2(stock.results[0].value) },
    low_stock: low.results,
    best_sellers: best.results,
    trend: months.map((mm) => ({
      month: mm,
      profit: round2((tSales[mm] || 0) - (tCogs[mm] || 0) - (tExp[mm] || 0)),
    })),
  });
}

// ---------- CSV export ----------

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

const EXPORTS = {
  orders: `SELECT o.id, o.date, o.customer_name, o.phone, o.area, o.payment_method, o.status, o.total_usd, o.delivery_cost_usd,
      (SELECT GROUP_CONCAT(oi.qty || 'x ' || p.style || ' ' || p.size || ' ' || p.color, '; ') FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items,
      (SELECT SUM(oi.qty * oi.unit_cost_usd) FROM order_items oi WHERE oi.order_id = o.id) AS cost_usd, o.notes
    FROM orders o ORDER BY o.date, o.id`,
  stock: 'SELECT id, style, size, color, qty, avg_cost_usd, sale_price_usd FROM products ORDER BY style, color, size',
  shipments: `SELECT s.id, s.date, s.supplier, s.status, s.shipping_usd, s.customs_usd, s.other_usd,
      (SELECT SUM(qty) FROM shipment_items WHERE shipment_id = s.id) AS pieces,
      (SELECT SUM(qty * unit_cost_usd) FROM shipment_items WHERE shipment_id = s.id) AS goods_usd, s.notes
    FROM shipments s ORDER BY s.date, s.id`,
  expenses: 'SELECT id, date, category, amount_usd, note FROM expenses ORDER BY date, id',
};

async function exportCsv(env, table) {
  const sql = EXPORTS[table];
  if (!sql) throw new HttpError(404, 'Not found');
  const { results } = await env.DB.prepare(sql).all();
  return new Response('﻿' + csv(results), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${table}-${today()}.csv"`,
    },
  });
}
