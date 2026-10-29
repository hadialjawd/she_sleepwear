// She Sleepwear: front end. Plain JavaScript, no build step.
'use strict';

const state = { user: null, rate: 89500, products: [] };
const view = document.getElementById('view');

// ---------- Small helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const thisMonth = () => today().slice(0, 7);
const round2 = (n) => Math.round(n * 100) / 100;

const usd = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const lbp = (n) => Math.round((Number(n) || 0) * state.rate).toLocaleString('en-US') + ' LBP';
const toUsd = (amount, cur) => (cur === 'LBP' ? (Number(amount) || 0) / state.rate : Number(amount) || 0);
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const variantName = (p) => [p.style, p.size, p.color].filter(Boolean).join(' · ');

const STATUS = {
  new: 'New', sent: 'Sent', delivered: 'Delivered', paid: 'Paid', returned: 'Returned', cancelled: 'Cancelled',
};
const PAY = { cod: 'Cash on delivery', whish: 'Whish', omt: 'OMT', cash: 'Cash in hand' };
const NEXT = {
  new: ['sent', 'Mark sent'],
  sent: ['delivered', 'Mark delivered'],
  delivered: ['paid', 'Money received'],
};
const EXPENSE_CATS = ['Ads', 'Packaging', 'Delivery', 'Phone / internet', 'Other'];

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch('/api/' + path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== 'login') {
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 4000 : 2200);
}

// Wraps a button handler: disables the button while working, shows errors.
function busy(btn, fn) {
  return async (e) => {
    e?.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
}

function setTop(title, actionHtml = '') {
  $('#title').textContent = title;
  $('#topAction').innerHTML = actionHtml;
  document.title = title === 'She Sleepwear' ? title : `${title} · She Sleepwear`;
}

// Money field with a USD / LBP switch. Value is always passed and read in USD.
function moneyInput(name, valueUsd = '', label = '') {
  const v = valueUsd === '' || valueUsd == null ? '' : round2(valueUsd);
  return `${label ? `<label for="${name}">${esc(label)}</label>` : ''}
    <div class="money">
      <input id="${name}" name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${v}" placeholder="0">
      <select name="${name}_cur" aria-label="Currency"><option>USD</option><option>LBP</option></select>
    </div>`;
}
function readMoney(form, name) {
  return toUsd(form.elements[name].value, form.elements[name + '_cur'].value);
}
function onMoneyCurrencyChange(form, cb) {
  // Convert the number when the currency is switched, so the value stays the same
  $$('.money select', form).forEach((sel) => {
    sel.dataset.prev = sel.value;
    sel.addEventListener('change', () => {
      const input = sel.previousElementSibling;
      if (input.value !== '') {
        const asUsd = toUsd(input.value, sel.dataset.prev);
        input.value = sel.value === 'LBP' ? Math.round(asUsd * state.rate) : round2(asUsd);
      }
      sel.dataset.prev = sel.value;
      cb?.();
    });
  });
}

function seg(name, options, selected) {
  return `<div class="seg" data-seg="${name}">${Object.entries(options)
    .map(([k, v]) => `<button type="button" data-v="${k}" class="${k === selected ? 'on' : ''}">${esc(v)}</button>`).join('')}
    <input type="hidden" name="${name}" value="${esc(selected)}"></div>`;
}
function wireSegs(root, onChange) {
  $$('[data-seg]', root).forEach((box) => {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('button', box).forEach((x) => x.classList.toggle('on', x === b));
      $('input', box).value = b.dataset.v;
      onChange?.(box.dataset.seg, b.dataset.v);
    });
  });
}

// Shrinks a photo so it uploads fast and stays small in the free database.
async function shrinkImage(file, maxSide = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.75, 0.6, 0.45]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob.size < 1_400_000) return blob;
  }
  throw new Error('Photo is too big, try a smaller one');
}
async function uploadReceipts(files, owner) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('file', await shrinkImage(f), 'receipt.jpg');
    fd.append(owner.type + '_id', owner.id);
    await api('receipts', { method: 'POST', form: fd });
  }
}

async function loadProducts() {
  state.products = await api('products');
  return state.products;
}

// ---------- Router ----------

const routes = [
  [/^#\/login$/, pageLogin],
  [/^#\/?$/, pageHome],
  [/^#\/orders$/, pageOrders],
  [/^#\/orders\/new$/, () => pageOrderForm()],
  [/^#\/orders\/(\d+)$/, (id) => pageOrderForm(id)],
  [/^#\/stock$/, pageStock],
  [/^#\/stock\/new$/, pageStockNew],
  [/^#\/stock\/(\d+)$/, pageStockEdit],
  [/^#\/shipments$/, pageShipments],
  [/^#\/shipments\/new$/, () => pageShipmentForm()],
  [/^#\/shipments\/(\d+)\/edit$/, (id) => pageShipmentForm(id)],
  [/^#\/shipments\/(\d+)$/, pageShipment],
  [/^#\/more$/, pageMore],
  [/^#\/expenses$/, pageExpenses],
  [/^#\/expenses\/new$/, pageExpenseNew],
  [/^#\/settings$/, pageSettings],
];

async function router() {
  const hash = (location.hash || '#/').split('?')[0];
  if (!state.user && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }
  const tab = hash.split('/')[1] || 'home';
  const tabName = ['expenses', 'settings'].includes(tab) ? 'more' : tab;
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tabName));
  const loggedIn = !!state.user;
  $('#tabs').hidden = !loggedIn;
  $('#topbar').hidden = !loggedIn;
  window.scrollTo(0, 0);

  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try {
        view.innerHTML = '<p class="muted center pad">Loading…</p>';
        await fn(...m.slice(1));
      } catch (err) {
        view.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
      return;
    }
  }
  view.innerHTML = '<div class="empty">Page not found. <a href="#/">Go home</a></div>';
}

// ---------- Login / first setup ----------

async function pageLogin() {
  const me = await api('me');
  if (me.user) {
    state.user = me.user;
    location.hash = '#/';
    return;
  }
  const setup = me.needsSetup;
  view.innerHTML = `
    <div class="auth">
      <img class="logo" src="/icon.svg" alt="">
      <h1 class="center">She Sleepwear</h1>
      <p class="muted center">${setup ? 'Welcome! Create your account to start.' : 'Log in to continue.'}</p>
      <form class="card" id="f">
        <label for="u">Username</label>
        <input id="u" name="username" autocomplete="username" autocapitalize="none" required>
        <label for="p">Password ${setup ? '(8+ characters)' : ''}</label>
        <input id="p" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
        <div class="actions"><button class="primary block" id="go">${setup ? 'Create account' : 'Log in'}</button></div>
      </form>
    </div>`;
  const f = $('#f');
  f.addEventListener('submit', busy($('#go'), async () => {
    await api(setup ? 'setup' : 'login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
    await boot();
    location.hash = '#/';
  }));
}

// ---------- Home / dashboard ----------

async function pageHome() {
  setTop('She Sleepwear', `<input type="month" id="month" value="${esc(window._month || thisMonth())}" style="width:auto">`);
  const month = window._month || thisMonth();
  const d = await api('dashboard?month=' + month);
  const maxAbs = Math.max(1, ...d.trend.map((t) => Math.abs(t.profit)));

  view.innerHTML = `
    <div class="card stat hero">
      <div class="label">Profit · ${esc(monthName(d.month))}</div>
      <div class="value num">${usd(d.profit)}</div>
      <div class="sub">${lbp(d.profit)} · ${d.orders} orders · ${d.pieces_sold} pieces</div>
    </div>

    <div class="grid g4" style="margin-top:10px">
      <div class="card stat"><div class="label">Sales</div><div class="value num">${usd(d.revenue)}</div></div>
      <div class="card stat"><div class="label">Cost of pieces sold</div><div class="value num">${usd(d.cost_of_goods)}</div></div>
      <div class="card stat"><div class="label">Delivery fees</div><div class="value num">${usd(d.delivery)}</div></div>
      <div class="card stat"><div class="label">Other expenses</div><div class="value num">${usd(d.expenses)}</div></div>
    </div>
    <p class="small muted">Profit = sales − real cost of pieces sold − delivery fees − other expenses. Only orders marked Delivered or Paid count.</p>

    <h2>Money to watch</h2>
    <div class="grid">
      <a class="card stat" href="#/orders?f=owed">
        <div class="label">Drivers owe you</div>
        <div class="value num ${d.cod_owed.amount > 0 ? 'bad' : ''}">${usd(d.cod_owed.amount)}</div>
        <div class="sub">${d.cod_owed.orders} cash-on-delivery order${d.cod_owed.orders === 1 ? '' : 's'} delivered, not paid yet</div>
      </a>
      <a class="card stat" href="#/orders?f=open">
        <div class="label">Open orders</div>
        <div class="value num">${d.open_orders.orders}</div>
        <div class="sub">${usd(d.open_orders.amount)} not delivered yet</div>
      </a>
      <a class="card stat" href="#/stock">
        <div class="label">Stock on hand</div>
        <div class="value num">${d.stock.pieces} pcs</div>
        <div class="sub">Worth ${usd(d.stock.value)} at cost</div>
      </a>
      <a class="card stat" href="#/shipments">
        <div class="label">Spent on stock this month</div>
        <div class="value num">${usd(d.stock_bought)}</div>
        <div class="sub">Shipments incl. shipping & customs</div>
      </a>
    </div>

    <h2>Profit, last 6 months</h2>
    <div class="card">
      <div class="bars">${d.trend.map((t) => `
        <div class="b" title="${esc(monthName(t.month))}: ${usd(t.profit)}">
          <span class="v">${Math.round(t.profit)}</span>
          <div class="bar ${t.profit < 0 ? 'neg' : ''} ${t.month === d.month ? 'cur' : ''}" style="height:${Math.round((Math.abs(t.profit) / maxAbs) * 85)}%"></div>
          <span class="m">${esc(new Date(t.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' }))}</span>
        </div>`).join('')}
      </div>
      <p class="small muted" style="margin:8px 0 0">In USD. Red = loss.</p>
    </div>

    <h2>Best sellers this month</h2>
    <div class="card">${d.best_sellers.length ? `
      <table class="table"><tr><th>Style</th><th class="num">Pieces</th><th class="num">Sales</th></tr>
      ${d.best_sellers.map((b) => `<tr><td>${esc(b.style)}</td><td class="num">${b.pieces}</td><td class="num">${usd(b.sales)}</td></tr>`).join('')}
      </table>` : '<div class="muted small">No sales yet this month.</div>'}
    </div>

    <h2>Low stock (2 or less)</h2>
    <div class="card">${d.low_stock.length ? `
      <table class="table">${d.low_stock.map((p) => `
        <tr><td><a href="#/stock/${p.id}">${esc(variantName(p))}</a></td><td class="num ${p.qty <= 0 ? 'qty-low' : ''}">${p.qty}</td></tr>`).join('')}
      </table>` : '<div class="muted small">All good.</div>'}
    </div>`;

  $('#month').addEventListener('change', (e) => {
    window._month = e.target.value || thisMonth();
    pageHome();
  });
}

// ---------- Orders ----------

async function pageOrders() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const filter = params.get('f') || window._orderFilter || 'all';
  window._orderFilter = filter;
  setTop('Orders');
  const filters = { all: 'All', open: 'Open', owed: 'Driver owes', paid: 'Paid', returned: 'Returned', cancelled: 'Cancelled' };

  view.innerHTML = `
    <div class="chips" id="chips">${Object.entries(filters).map(([k, v]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${v}</button>`).join('')}</div>
    <input id="q" type="search" placeholder="Search name, phone, area" value="${esc(window._orderQ || '')}">
    <div id="list" class="list" style="margin-top:12px"></div>
    <a class="btn primary fab" href="#/orders/new">+ New order</a>`;

  const load = async () => {
    const q = $('#q').value.trim();
    window._orderQ = q;
    const qs = new URLSearchParams();
    if (filter !== 'all') qs.set('status', filter);
    if (q) qs.set('q', q);
    const rows = await api('orders?' + qs);
    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = `<div class="empty">No orders here yet.</div>`;
      return;
    }
    const sum = rows.reduce((a, o) => a + o.total_usd, 0);
    list.innerHTML = `<div class="small muted">${rows.length} orders · ${usd(sum)}</div>` + rows.map((o) => `
      <div class="card">
        <a href="#/orders/${o.id}" style="color:inherit;text-decoration:none;display:block">
          <div class="row between">
            <strong class="ellipsis">${esc(o.customer_name || 'No name')}</strong>
            <span class="num"><strong>${usd(o.total_usd)}</strong></span>
          </div>
          <div class="small muted ellipsis">${esc(o.summary || '')}</div>
          <div class="row between small" style="margin-top:6px">
            <span class="muted">${fmtDate(o.date)}${o.area ? ' · ' + esc(o.area) : ''} · ${esc(PAY[o.payment_method])}</span>
            <span class="pill ${o.status}">${STATUS[o.status]}</span>
          </div>
        </a>
        ${NEXT[o.status] ? `<div class="actions" style="margin-top:10px"><button class="small" data-next="${o.id}" data-to="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button></div>` : ''}
      </div>`).join('');
    $$('[data-next]', list).forEach((b) => b.addEventListener('click', busy(b, async () => {
      await api(`orders/${b.dataset.next}/status`, { method: 'POST', body: { status: b.dataset.to } });
      toast('Updated');
      load();
    })));
  };

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    window._orderFilter = b.dataset.f;
    location.hash = '#/orders?f=' + b.dataset.f;
  });
  let t;
  $('#q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(load, 250);
  });
  await load();
}

async function pageOrderForm(id) {
  const [products, order] = await Promise.all([loadProducts(), id ? api('orders/' + id) : null]);
  setTop(id ? `Order #${id}` : 'New order');
  const o = order || { date: today(), payment_method: 'cod', status: 'new', items: [], total_usd: '', delivery_cost_usd: '' };

  if (!products.length) {
    view.innerHTML = `<div class="empty">You have no stock yet.<br><br><a class="btn primary" href="#/stock/new">Add stock</a> <a class="btn" href="#/shipments/new">Add a shipment</a></div>`;
    return;
  }

  const options = (selected) => products.map((p) =>
    `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(variantName(p))} (${p.qty} left)</option>`).join('');

  const itemRow = (it = {}) => `
    <div class="item-row">
      <button type="button" class="link x" data-remove aria-label="Remove item">✕</button>
      <label>Item</label>
      <select name="product">${it.product_id ? '' : '<option value="">Choose…</option>'}${options(it.product_id)}</select>
      <div class="fields">
        <div><label>Quantity</label><input name="qty" type="number" inputmode="numeric" min="1" value="${it.qty || 1}"></div>
        <div><label>Price each (USD)</label><input name="price" type="number" inputmode="decimal" step="any" min="0" value="${it.unit_price_usd ?? ''}"></div>
      </div>
    </div>`;

  view.innerHTML = `
    <form id="f">
      <div class="card">
        <div class="fields">
          <div class="full"><label for="customer_name">Customer name</label><input id="customer_name" name="customer_name" value="${esc(o.customer_name)}"></div>
          <div><label for="phone">Phone</label><input id="phone" name="phone" type="tel" value="${esc(o.phone)}"></div>
          <div><label for="area">Area</label><input id="area" name="area" value="${esc(o.area)}" placeholder="e.g. Jounieh"></div>
          <div class="full"><label for="date">Date</label><input id="date" name="date" type="date" value="${esc(o.date)}"></div>
        </div>
        <label>Payment</label>
        ${seg('payment_method', PAY, o.payment_method)}
        <label>Status</label>
        ${seg('status', STATUS, o.status)}
      </div>

      <h2>Items</h2>
      <div id="items">${(o.items.length ? o.items : [{}]).map(itemRow).join('')}</div>
      <button type="button" class="block" id="addItem" style="margin-top:10px">+ Add another item</button>

      <h2>Money</h2>
      <div class="card">
        ${moneyInput('total_usd', o.total_usd, 'Total the customer pays')}
        <div class="small muted" id="autoNote">Fills in from the items. You can change it (for a discount).</div>
        ${moneyInput('delivery_cost_usd', o.delivery_cost_usd, 'Delivery fee you pay (if any)')}
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes">${esc(o.notes)}</textarea>
        <div class="sumbox" id="sum"></div>
      </div>

      <div class="actions">
        <button class="primary" id="save">${id ? 'Save changes' : 'Save order'}</button>
        ${id ? '<button type="button" class="danger" id="del">Delete</button>' : ''}
      </div>
    </form>`;

  const f = $('#f');
  let totalTouched = !!id;
  const costOf = (pid) => {
    const prev = o.items.find((x) => x.product_id === pid);
    return prev ? prev.unit_cost_usd : products.find((p) => p.id === pid)?.avg_cost_usd || 0;
  };
  const readItems = () => $$('.item-row', f).map((row) => ({
    product_id: Number($('[name=product]', row).value),
    qty: Number($('[name=qty]', row).value) || 0,
    unit_price_usd: Number($('[name=price]', row).value) || 0,
  })).filter((it) => it.product_id && it.qty > 0);

  const refresh = () => {
    const items = readItems();
    const itemsTotal = items.reduce((a, it) => a + it.qty * it.unit_price_usd, 0);
    if (!totalTouched) {
      const cur = f.total_usd_cur.value;
      f.total_usd.value = itemsTotal ? (cur === 'LBP' ? Math.round(itemsTotal * state.rate) : round2(itemsTotal)) : '';
    }
    const total = readMoney(f, 'total_usd');
    const cost = items.reduce((a, it) => a + it.qty * costOf(it.product_id), 0);
    const delivery = readMoney(f, 'delivery_cost_usd');
    const profit = total - cost - delivery;
    const warn = items.filter((it) => {
      const p = products.find((x) => x.id === it.product_id);
      const already = o.items.filter((x) => x.product_id === it.product_id).reduce((a, x) => a + x.qty, 0);
      return p && it.qty > p.qty + already;
    });
    $('#sum').innerHTML = `
      <div class="row between"><span>Total</span><span class="num">${usd(total)}</span></div>
      <div class="row between muted small"><span></span><span class="num">${lbp(total)}</span></div>
      <div class="row between"><span>Real cost of pieces</span><span class="num">−${usd(cost)}</span></div>
      <div class="row between"><span>Delivery fee</span><span class="num">−${usd(delivery)}</span></div>
      <div class="row between total"><span>Profit on this order</span><span class="num ${profit < 0 ? 'bad' : 'good'}">${usd(profit)}</span></div>
      ${warn.length ? `<div class="note">Not enough stock for: ${warn.map((w) => esc(variantName(products.find((p) => p.id === w.product_id)))).join(', ')}. You can still save (stock will go below 0).</div>` : ''}`;
  };

  wireSegs(f);
  onMoneyCurrencyChange(f, refresh);
  f.addEventListener('input', (e) => {
    if (e.target.name === 'total_usd') {
      totalTouched = true;
      $('#autoNote').textContent = 'Typed by you. Clear it to fill in from the items again.';
      if (e.target.value === '') totalTouched = false;
    }
    refresh();
  });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'product') {
      const row = e.target.closest('.item-row');
      const p = products.find((x) => x.id === Number(e.target.value));
      if (p && !$('[name=price]', row).value) $('[name=price]', row).value = p.sale_price_usd || '';
    }
    refresh();
  });
  $('#items').addEventListener('click', (e) => {
    if (e.target.closest('[data-remove]')) {
      if ($$('.item-row', f).length > 1) e.target.closest('.item-row').remove();
      refresh();
    }
  });
  $('#addItem').addEventListener('click', () => {
    $('#items').insertAdjacentHTML('beforeend', itemRow());
    refresh();
  });

  f.addEventListener('submit', busy($('#save'), async () => {
    const items = readItems();
    if (!items.length) throw new Error('Choose at least one item');
    const payload = {
      date: f.date.value, customer_name: f.customer_name.value, phone: f.phone.value, area: f.area.value,
      payment_method: f.payment_method.value, status: f.status.value,
      total_usd: round2(readMoney(f, 'total_usd')), delivery_cost_usd: round2(readMoney(f, 'delivery_cost_usd')),
      notes: f.notes.value, items,
    };
    await api(id ? 'orders/' + id : 'orders', { method: id ? 'PUT' : 'POST', body: payload });
    toast('Order saved');
    location.hash = '#/orders';
  }));
  if (id) {
    $('#del').addEventListener('click', busy($('#del'), async () => {
      if (!confirm('Delete this order? Its pieces go back to stock.')) return;
      await api('orders/' + id, { method: 'DELETE' });
      toast('Order deleted');
      location.hash = '#/orders';
    }));
  }
  refresh();
}

// ---------- Stock ----------

async function pageStock() {
  setTop('Stock', '<a class="btn small primary" href="#/stock/new">+ Add</a>');
  const products = await loadProducts();
  view.innerHTML = `<input id="q" type="search" placeholder="Search style, color, size" value="${esc(window._stockQ || '')}"><div id="list"></div>`;

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    window._stockQ = q;
    const rows = products.filter((p) => !q || variantName(p).toLowerCase().includes(q));
    if (!rows.length) {
      $('#list').innerHTML = `<div class="empty">${products.length ? 'Nothing matches.' : 'No stock yet. Add a shipment from Turkey, or add stock by hand.'}</div>`;
      return;
    }
    const groups = {};
    rows.forEach((p) => (groups[p.style] ||= []).push(p));
    const pieces = rows.reduce((a, p) => a + Math.max(p.qty, 0), 0);
    $('#list').innerHTML = `<p class="small muted">${pieces} pieces in stock</p>` + Object.entries(groups).map(([style, list]) => `
      <div class="group-title"><span>${esc(style)}</span><span class="muted small">${list.reduce((a, p) => a + Math.max(p.qty, 0), 0)} pcs</span></div>
      <div class="card" style="padding:6px 12px">
        <table class="table">
          <tr><th>Color</th><th>Size</th><th class="num">Left</th><th class="num">Cost</th><th class="num">Price</th></tr>
          ${list.map((p) => `
            <tr data-id="${p.id}" style="cursor:pointer">
              <td>${esc(p.color || '—')}</td><td>${esc(p.size || '—')}</td>
              <td class="num ${p.qty <= 2 ? 'qty-low' : ''}">${p.qty}</td>
              <td class="num">${usd(p.avg_cost_usd)}</td><td class="num">${usd(p.sale_price_usd)}</td>
            </tr>`).join('')}
        </table>
      </div>`).join('') + '<p class="small muted">Cost = real cost per piece, including shipping and customs. Tap a row to edit.</p>';
    $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = '#/stock/' + tr.dataset.id)));
  };
  $('#q').addEventListener('input', draw);
  draw();
}

function datalists(products) {
  const uniq = (k) => [...new Set(products.map((p) => p[k]).filter(Boolean))].sort();
  return `
    <datalist id="dl-style">${uniq('style').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="dl-color">${uniq('color').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="dl-size">${[...new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', ...uniq('size')])].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

async function pageStockNew() {
  setTop('Add stock');
  const products = await loadProducts();
  view.innerHTML = `
    ${datalists(products)}
    <form id="f" class="card">
      <p class="small muted" style="margin-top:0">Tip: stock from Turkey is best added with a <a href="#/shipments/new">shipment</a>, so shipping and customs are counted in the cost. Use this for stock you already have.</p>
      <label for="style">Style name</label><input id="style" name="style" list="dl-style" required placeholder="e.g. Satin set">
      <label for="color">Color</label><input id="color" name="color" list="dl-color" placeholder="e.g. Pink">
      <label for="sizes">Sizes (separate with commas)</label><input id="sizes" name="sizes" placeholder="S, M, L, XL">
      <div class="fields">
        <div><label for="qty">Quantity per size</label><input id="qty" name="qty" type="number" inputmode="numeric" value="0"></div>
        <div></div>
      </div>
      ${moneyInput('cost', '', 'Real cost per piece')}
      ${moneyInput('price', '', 'Selling price')}
      <div class="actions"><button class="primary" id="save">Add</button></div>
    </form>`;
  const f = $('#f');
  onMoneyCurrencyChange(f);
  f.addEventListener('submit', busy($('#save'), async () => {
    const sizes = f.sizes.value.split(',').map((s) => s.trim()).filter(Boolean);
    for (const size of sizes.length ? sizes : ['']) {
      await api('products', {
        method: 'POST',
        body: { style: f.style.value, color: f.color.value, size, qty: Number(f.qty.value) || 0, avg_cost_usd: round2(readMoney(f, 'cost')), sale_price_usd: round2(readMoney(f, 'price')) },
      });
    }
    toast('Stock added');
    location.hash = '#/stock';
  }));
}

async function pageStockEdit(id) {
  setTop('Edit stock');
  const products = await loadProducts();
  const p = products.find((x) => x.id === Number(id));
  if (!p) throw new Error('Not found');
  view.innerHTML = `
    ${datalists(products)}
    <form id="f" class="card">
      <label for="style">Style name</label><input id="style" name="style" list="dl-style" required value="${esc(p.style)}">
      <div class="fields">
        <div><label for="color">Color</label><input id="color" name="color" list="dl-color" value="${esc(p.color)}"></div>
        <div><label for="size">Size</label><input id="size" name="size" list="dl-size" value="${esc(p.size)}"></div>
      </div>
      <label for="qty">Quantity in stock</label><input id="qty" name="qty" type="number" inputmode="numeric" value="${p.qty}">
      ${moneyInput('cost', p.avg_cost_usd, 'Real cost per piece')}
      ${moneyInput('price', p.sale_price_usd, 'Selling price')}
      <div class="small muted" id="margin"></div>
      <div class="actions">
        <button class="primary" id="save">Save</button>
        <button type="button" class="danger" id="del">Delete</button>
      </div>
    </form>`;
  const f = $('#f');
  const margin = () => {
    const c = readMoney(f, 'cost');
    const pr = readMoney(f, 'price');
    $('#margin').textContent = pr ? `Profit per piece: ${usd(pr - c)} (${Math.round(((pr - c) / pr) * 100)}% of the price)` : '';
  };
  onMoneyCurrencyChange(f, margin);
  f.addEventListener('input', margin);
  margin();
  f.addEventListener('submit', busy($('#save'), async () => {
    await api('products/' + id, {
      method: 'PUT',
      body: { style: f.style.value, color: f.color.value, size: f.size.value, qty: Number(f.qty.value) || 0, avg_cost_usd: round2(readMoney(f, 'cost')), sale_price_usd: round2(readMoney(f, 'price')) },
    });
    toast('Saved');
    location.hash = '#/stock';
  }));
  $('#del').addEventListener('click', busy($('#del'), async () => {
    if (!confirm('Delete this item?')) return;
    await api('products/' + id, { method: 'DELETE' });
    toast('Deleted');
    location.hash = '#/stock';
  }));
}

// ---------- Shipments ----------

async function pageShipments() {
  setTop('Shipments');
  const rows = await api('shipments');
  view.innerHTML = `
    <p class="small muted" style="margin-top:0">Each shipment from Turkey. When it arrives, the app splits shipping and customs over every piece and adds them to stock.</p>
    <div class="list">${rows.length ? rows.map((s) => `
      <a class="card" href="#/shipments/${s.id}">
        <div class="row between"><strong>${esc(s.supplier || 'Shipment')} </strong><span class="pill ${s.status}">${s.status === 'arrived' ? 'Arrived' : 'On the way'}</span></div>
        <div class="row between small" style="margin-top:4px">
          <span class="muted">${fmtDate(s.date)} · ${s.pieces} pcs${s.receipt_count ? ` · ${s.receipt_count} receipt${s.receipt_count > 1 ? 's' : ''}` : ''}</span>
          <strong class="num">${usd(s.goods_usd + s.shipping_usd + s.customs_usd + s.other_usd)}</strong>
        </div>
      </a>`).join('') : '<div class="empty">No shipments yet.</div>'}
    </div>
    <a class="btn primary fab" href="#/shipments/new">+ New shipment</a>`;
}

async function pageShipmentForm(id) {
  const [products, s] = await Promise.all([loadProducts(), id ? api('shipments/' + id) : null]);
  if (s && s.status === 'arrived') {
    location.hash = '#/shipments/' + id;
    return;
  }
  setTop(id ? 'Edit shipment' : 'New shipment');
  const sh = s || { date: today(), supplier: '', items: [], shipping_usd: '', customs_usd: '', other_usd: '', notes: '' };

  const itemRow = (it = {}) => `
    <div class="item-row">
      <button type="button" class="link x" data-remove aria-label="Remove item">✕</button>
      <label>Style</label><input name="style" list="dl-style" value="${esc(it.style)}" placeholder="e.g. Satin set">
      <div class="fields">
        <div><label>Color</label><input name="color" list="dl-color" value="${esc(it.color)}"></div>
        <div><label>Size</label><input name="size" list="dl-size" value="${esc(it.size)}"></div>
        <div><label>Quantity</label><input name="qty" type="number" inputmode="numeric" min="1" value="${it.qty || ''}"></div>
        <div><label>Price each</label><input name="cost" type="number" inputmode="decimal" step="any" min="0" value="${it.unit_cost_usd ?? ''}"></div>
      </div>
    </div>`;

  view.innerHTML = `
    ${datalists(products)}
    <form id="f">
      <div class="card">
        <div class="fields">
          <div><label for="date">Date</label><input id="date" name="date" type="date" value="${esc(sh.date)}"></div>
          <div><label for="supplier">Supplier</label><input id="supplier" name="supplier" value="${esc(sh.supplier)}" placeholder="Name in Turkey"></div>
        </div>
        <label>Item prices are in</label>
        ${seg('item_cur', { USD: 'USD', LBP: 'LBP' }, 'USD')}
      </div>

      <h2>Items in this shipment</h2>
      <div id="items">${(sh.items.length ? sh.items : [{}]).map(itemRow).join('')}</div>
      <button type="button" class="block" id="addItem" style="margin-top:10px">+ Add another item</button>

      <h2>Extra costs</h2>
      <div class="card">
        ${moneyInput('shipping_usd', sh.shipping_usd, 'Shipping (Turkey → Lebanon)')}
        ${moneyInput('customs_usd', sh.customs_usd, 'Customs')}
        ${moneyInput('other_usd', sh.other_usd, 'Other (pickup, fees…)')}
        <label for="notes">Notes</label><textarea id="notes" name="notes">${esc(sh.notes)}</textarea>
        ${id ? '' : `<label for="photos">Receipt photos (optional)</label><input id="photos" type="file" accept="image/*" multiple>`}
        <div class="sumbox" id="sum"></div>
      </div>

      <div class="actions"><button class="primary" id="save">${id ? 'Save changes' : 'Save shipment'}</button></div>
    </form>`;

  const f = $('#f');
  const readItems = () => {
    const cur = f.item_cur.value;
    return $$('.item-row', f).map((row) => ({
      style: $('[name=style]', row).value.trim(),
      color: $('[name=color]', row).value.trim(),
      size: $('[name=size]', row).value.trim(),
      qty: Number($('[name=qty]', row).value) || 0,
      unit_cost_usd: round2(toUsd($('[name=cost]', row).value, cur)),
    })).filter((it) => it.style && it.qty > 0);
  };
  const refresh = () => {
    const items = readItems();
    const pieces = items.reduce((a, it) => a + it.qty, 0);
    const goods = items.reduce((a, it) => a + it.qty * it.unit_cost_usd, 0);
    const extra = readMoney(f, 'shipping_usd') + readMoney(f, 'customs_usd') + readMoney(f, 'other_usd');
    $('#sum').innerHTML = `
      <div class="row between"><span>Pieces</span><span class="num">${pieces}</span></div>
      <div class="row between"><span>Clothes</span><span class="num">${usd(goods)}</span></div>
      <div class="row between"><span>Shipping + customs + other</span><span class="num">${usd(extra)}</span></div>
      <div class="row between total"><span>Total cost</span><span class="num">${usd(goods + extra)}</span></div>
      ${pieces ? `<div class="row between small" style="margin-top:6px"><span>Extra cost added to each piece</span><span class="num">+${usd(extra / pieces)}</span></div>
      <div class="row between small"><span>Average real cost per piece</span><span class="num"><strong>${usd((goods + extra) / pieces)}</strong></span></div>` : ''}`;
  };
  wireSegs(f, refresh);
  onMoneyCurrencyChange(f, refresh);
  f.addEventListener('input', refresh);
  $('#items').addEventListener('click', (e) => {
    if (e.target.closest('[data-remove]')) {
      if ($$('.item-row', f).length > 1) e.target.closest('.item-row').remove();
      refresh();
    }
  });
  $('#addItem').addEventListener('click', () => {
    // Copy style and color from the last row, since one style often comes in many sizes
    const rows = $$('.item-row', f);
    const last = rows[rows.length - 1];
    $('#items').insertAdjacentHTML('beforeend', itemRow({
      style: last ? $('[name=style]', last).value : '',
      color: last ? $('[name=color]', last).value : '',
      unit_cost_usd: last ? $('[name=cost]', last).value : '',
    }));
    const added = $$('.item-row', f).pop();
    $('[name=size]', added).focus();
    refresh();
  });

  f.addEventListener('submit', busy($('#save'), async () => {
    const items = readItems();
    if (!items.length) throw new Error('Add at least one item with a style and quantity');
    const payload = {
      date: f.date.value, supplier: f.supplier.value, notes: f.notes.value, items,
      shipping_usd: round2(readMoney(f, 'shipping_usd')), customs_usd: round2(readMoney(f, 'customs_usd')), other_usd: round2(readMoney(f, 'other_usd')),
    };
    const saved = await api(id ? 'shipments/' + id : 'shipments', { method: id ? 'PUT' : 'POST', body: payload });
    const photos = $('#photos')?.files;
    if (photos?.length) await uploadReceipts(photos, { type: 'shipment', id: saved.id });
    toast('Shipment saved');
    location.hash = '#/shipments/' + saved.id;
  }));
  refresh();
}

async function pageShipment(id) {
  const s = await api('shipments/' + id);
  setTop(s.supplier || 'Shipment');
  const arrived = s.status === 'arrived';
  const pieces = s.items.reduce((a, it) => a + it.qty, 0);
  const goods = s.items.reduce((a, it) => a + it.qty * it.unit_cost_usd, 0);
  const extra = s.shipping_usd + s.customs_usd + s.other_usd;
  const perPiece = pieces ? extra / pieces : 0;

  view.innerHTML = `
    <div class="card">
      <div class="row between"><span class="muted">${fmtDate(s.date)}</span><span class="pill ${s.status}">${arrived ? 'Arrived · in stock' : 'On the way'}</span></div>
      <table class="table" style="margin-top:10px">
        <tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Real cost</th></tr>
        ${s.items.map((it) => `<tr><td>${esc(variantName(it))}</td><td class="num">${it.qty}</td><td class="num">${usd(it.unit_cost_usd)}</td>
          <td class="num"><strong>${usd(it.landed_cost_usd ?? it.unit_cost_usd + perPiece)}</strong></td></tr>`).join('')}
      </table>
      <div class="sumbox">
        <div class="row between"><span>Clothes (${pieces} pcs)</span><span class="num">${usd(goods)}</span></div>
        <div class="row between"><span>Shipping</span><span class="num">${usd(s.shipping_usd)}</span></div>
        <div class="row between"><span>Customs</span><span class="num">${usd(s.customs_usd)}</span></div>
        <div class="row between"><span>Other</span><span class="num">${usd(s.other_usd)}</span></div>
        <div class="row between total"><span>Total</span><span class="num">${usd(goods + extra)}</span></div>
        <div class="row between small muted"><span></span><span class="num">${lbp(goods + extra)}</span></div>
      </div>
      ${s.notes ? `<p class="small" style="white-space:pre-wrap">${esc(s.notes)}</p>` : ''}
    </div>

    ${arrived ? '' : `<div class="note">When the clothes arrive, tap <strong>Arrived</strong>. The pieces are added to your stock with their real cost. After that, the shipment can't be changed.</div>`}

    <h2>Receipts</h2>
    <div class="card">
      <div class="thumbs">${s.receipts.map((r) => `<a href="/api/receipts/${r.id}" target="_blank" rel="noopener"><img src="/api/receipts/${r.id}" alt="Receipt" loading="lazy"></a>`).join('') || '<span class="muted small">No receipts yet.</span>'}</div>
      <label for="photos">Add receipt photo</label>
      <input id="photos" type="file" accept="image/*" multiple>
    </div>

    <div class="actions">
      ${arrived ? '' : '<button class="primary" id="arrive">Arrived → add to stock</button><a class="btn" href="#/shipments/' + id + '/edit">Edit</a><button class="danger" id="del">Delete</button>'}
    </div>`;

  $('#photos').addEventListener('change', async (e) => {
    try {
      toast('Uploading…');
      await uploadReceipts(e.target.files, { type: 'shipment', id });
      toast('Receipt saved');
      pageShipment(id);
    } catch (err) {
      toast(err.message, true);
    }
  });
  if (!arrived) {
    $('#arrive').addEventListener('click', busy($('#arrive'), async () => {
      if (!confirm(`Add ${pieces} pieces to stock? Each piece gets +${usd(perPiece)} for shipping and customs.`)) return;
      await api(`shipments/${id}/arrive`, { method: 'POST' });
      toast('Added to stock');
      pageShipment(id);
    }));
    $('#del').addEventListener('click', busy($('#del'), async () => {
      if (!confirm('Delete this shipment?')) return;
      await api('shipments/' + id, { method: 'DELETE' });
      location.hash = '#/shipments';
    }));
  }
}

// ---------- More, expenses, settings ----------

async function pageMore() {
  setTop('More');
  view.innerHTML = `
    <div class="card menu">
      <a href="#/expenses"><span>Expenses <span class="muted small">(ads, packaging…)</span></span><span>›</span></a>
      <a href="#/settings"><span>Settings, users & export</span><span>›</span></a>
    </div>
    <p class="small muted center" style="margin-top:20px">Logged in as <strong>${esc(state.user.username)}</strong></p>`;
}

async function pageExpenses() {
  const month = window._expMonth || thisMonth();
  setTop('Expenses', `<input type="month" id="month" value="${esc(month)}" style="width:auto">`);
  const rows = await api('expenses?month=' + month);
  const total = rows.reduce((a, e) => a + e.amount_usd, 0);
  view.innerHTML = `
    <p class="small muted" style="margin-top:0">Costs that are not stock: ads, bags, packaging and so on. Shipments are tracked separately.</p>
    <div class="card stat"><div class="label">Total · ${esc(monthName(month))}</div><div class="value num">${usd(total)}</div><div class="sub">${lbp(total)}</div></div>
    <div class="list" style="margin-top:10px">${rows.map((e) => `
      <div class="card row">
        <div class="grow">
          <strong>${esc(e.category)}</strong> <span class="muted small">${fmtDate(e.date)}</span>
          ${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}
          ${e.receipt_id ? `<a class="small" href="/api/receipts/${e.receipt_id}" target="_blank" rel="noopener">View receipt</a>` : ''}
        </div>
        <strong class="num">${usd(e.amount_usd)}</strong>
        <button class="link" data-del="${e.id}" aria-label="Delete">✕</button>
      </div>`).join('') || '<div class="empty">No expenses this month.</div>'}
    </div>
    <a class="btn primary fab" href="#/expenses/new">+ Add expense</a>`;
  $('#month').addEventListener('change', (e) => {
    window._expMonth = e.target.value || thisMonth();
    pageExpenses();
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', busy(b, async () => {
    if (!confirm('Delete this expense?')) return;
    await api('expenses/' + b.dataset.del, { method: 'DELETE' });
    pageExpenses();
  })));
}

async function pageExpenseNew() {
  setTop('Add expense');
  view.innerHTML = `
    <form id="f" class="card">
      <label for="date">Date</label><input id="date" name="date" type="date" value="${today()}">
      <label>Type</label>
      ${seg('category', Object.fromEntries(EXPENSE_CATS.map((c) => [c, c])), 'Ads')}
      ${moneyInput('amount', '', 'Amount')}
      <label for="note">Note</label><input id="note" name="note" placeholder="e.g. Instagram ad, 5 days">
      <label for="photos">Receipt photo (optional)</label><input id="photos" type="file" accept="image/*">
      <div class="actions"><button class="primary" id="save">Save</button></div>
    </form>`;
  const f = $('#f');
  wireSegs(f);
  onMoneyCurrencyChange(f);
  f.addEventListener('submit', busy($('#save'), async () => {
    const e = await api('expenses', {
      method: 'POST',
      body: { date: f.date.value, category: f.category.value, amount_usd: round2(readMoney(f, 'amount')), note: f.note.value },
    });
    const photos = $('#photos').files;
    if (photos.length) await uploadReceipts(photos, { type: 'expense', id: e.id });
    toast('Expense saved');
    location.hash = '#/expenses';
  }));
}

async function pageSettings() {
  setTop('Settings');
  const users = await api('users');
  view.innerHTML = `
    <h2 style="margin-top:4px">Dollar rate</h2>
    <form id="rateF" class="card">
      <label for="rate">1 USD = how many LBP?</label>
      <input id="rate" name="rate" type="number" inputmode="numeric" value="${state.rate}">
      <div class="actions"><button class="primary" id="saveRate">Save rate</button></div>
    </form>

    <h2>People who can log in</h2>
    <div class="card">
      ${users.map((u) => `<div class="row between" style="padding:4px 0"><span>${esc(u.username)}</span>${u.id === state.user.id ? '<span class="pill">you</span>' : ''}</div>`).join('')}
      <form id="userF" style="margin-top:6px">
        <div class="fields">
          <div><label for="nu">New username</label><input id="nu" name="username" autocapitalize="none" autocomplete="off"></div>
          <div><label for="np">Password (8+)</label><input id="np" name="password" type="password" autocomplete="new-password"></div>
        </div>
        <div class="actions"><button id="addUser">Add person</button></div>
      </form>
    </div>

    <h2>Change my password</h2>
    <form id="pwF" class="card">
      <label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password">
      <label for="new">New password (8+)</label><input id="new" name="password" type="password" autocomplete="new-password">
      <div class="actions"><button id="savePw">Change password</button></div>
    </form>

    <h2>Download your data (Excel)</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">CSV files open in Excel or Google Sheets. Good as a backup.</p>
      <div class="actions">
        <a class="btn small" href="/api/export/orders">Orders</a>
        <a class="btn small" href="/api/export/stock">Stock</a>
        <a class="btn small" href="/api/export/shipments">Shipments</a>
        <a class="btn small" href="/api/export/expenses">Expenses</a>
      </div>
    </div>

    <h2>Put it on your phone</h2>
    <div class="card small">
      <strong>iPhone:</strong> open in Safari → Share → <em>Add to Home Screen</em>.<br>
      <strong>Android:</strong> open in Chrome → ⋮ menu → <em>Add to Home screen</em>.
    </div>

    <div class="actions"><button class="danger" id="logout">Log out</button></div>`;

  const rf = $('#rateF');
  rf.addEventListener('submit', busy($('#saveRate'), async () => {
    const s = await api('settings', { method: 'PUT', body: { lbp_rate: Number(rf.rate.value) } });
    state.rate = s.lbp_rate;
    toast('Rate saved');
  }));
  const uf = $('#userF');
  uf.addEventListener('submit', busy($('#addUser'), async () => {
    await api('users', { method: 'POST', body: { username: uf.username.value, password: uf.password.value } });
    toast('Person added');
    pageSettings();
  }));
  const pf = $('#pwF');
  pf.addEventListener('submit', busy($('#savePw'), async () => {
    await api('password', { method: 'POST', body: { current: pf.current.value, password: pf.password.value } });
    pf.reset();
    toast('Password changed');
  }));
  $('#logout').addEventListener('click', busy($('#logout'), async () => {
    await api('logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/login';
  }));
}

// ---------- Start ----------

async function boot() {
  const me = await api('me');
  state.user = me.user;
  if (state.user) {
    const s = await api('settings');
    state.rate = s.lbp_rate;
  }
}

window.addEventListener('hashchange', router);
boot().then(router).catch(() => {
  view.innerHTML = '<div class="empty">Could not connect. Check your internet and refresh.</div>';
});
