// She Sleepwear: front end. Plain JavaScript, no build step.
'use strict';

const state = { user: null, settings: { lbp_rate: 89500, default_delivery_fee: 0, wa_confirm: '', ai_enabled: false }, products: [] };
const view = document.getElementById('view');

// ---------- Small helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const thisMonth = () => today().slice(0, 7);
const round2 = (n) => Math.round(n * 100) / 100;
const rate = () => state.settings.lbp_rate || 89500;

const usd = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const usd0 = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};
const lbp = (n) => Math.round((Number(n) || 0) * rate()).toLocaleString('en-US') + ' LBP';
const toUsd = (amount, cur) => (cur === 'LBP' ? (Number(amount) || 0) / rate() : Number(amount) || 0);
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const monthShort = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const variantName = (p) => [p.style, p.size, p.color].filter(Boolean).join(' · ');
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL'];
const sizeRank = (s) => {
  const i = SIZE_ORDER.indexOf(String(s).toUpperCase());
  return i < 0 ? 100 : i;
};

const photoUrl = (p) => (p && p.photo_id ? `/api/style-photos/${p.photo_id}?v=${encodeURIComponent(p.photo_v || '')}` : '');
const photoTag = (p, cls = '') => {
  const url = photoUrl(p);
  return url
    ? `<img class="ph ${cls}" src="${url}" alt="" loading="lazy">`
    : `<span class="ph ph-empty ${cls}" aria-hidden="true">🌙</span>`;
};
const stylePhoto = (style) => state.products.find((p) => p.style === style && p.photo_id);

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
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 4500 : 2200);
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

function setTop(title, actionHtml = '', back = '') {
  $('#title').textContent = title;
  $('#topAction').innerHTML = actionHtml;
  $('#back').hidden = !back;
  if (back) $('#back').href = back;
  document.title = title === 'She Sleepwear' ? title : `${title} · She Sleepwear`;
}

// Bottom sheet pop-up. Returns the sheet element; closeSheet() removes it.
function openSheet(html) {
  closeSheet();
  $('#sheetRoot').innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  $('#sheetRoot .sheet-bg').addEventListener('click', closeSheet);
  return $('#sheetRoot .sheet');
}
function closeSheet() {
  $('#sheetRoot').innerHTML = '';
}

// Money field with a USD / LBP switch. Value is always passed and read in USD.
function moneyInput(name, valueUsd = '', label = '', hint = '') {
  const v = valueUsd === '' || valueUsd == null ? '' : round2(valueUsd);
  return `${label ? `<label for="${name}">${esc(label)}</label>` : ''}
    <div class="money">
      <input id="${name}" name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${v}" placeholder="0">
      <select name="${name}_cur" aria-label="Currency"><option>USD</option><option>LBP</option></select>
    </div>${hint ? `<div class="hint">${hint}</div>` : ''}`;
}
function readMoney(form, name) {
  return toUsd(form.elements[name].value, form.elements[name + '_cur'].value);
}
function setMoney(form, name, value, cur = 'USD') {
  form.elements[name + '_cur'].value = cur;
  form.elements[name + '_cur'].dataset.prev = cur;
  form.elements[name].value = value === '' || value == null ? '' : value;
}
function onMoneyCurrencyChange(form, cb) {
  // Convert the number when the currency is switched, so the value stays the same
  $$('.money select', form).forEach((sel) => {
    sel.dataset.prev = sel.value;
    sel.addEventListener('change', () => {
      const input = sel.previousElementSibling;
      if (input.value !== '') {
        const asUsd = toUsd(input.value, sel.dataset.prev);
        input.value = sel.value === 'LBP' ? Math.round(asUsd * rate()) : round2(asUsd);
      }
      sel.dataset.prev = sel.value;
      cb?.();
    });
  });
}

function seg(name, options, selected) {
  return `<div class="seg" data-seg="${name}">${Object.entries(options)
    .map(([k, v]) => `<button type="button" data-v="${esc(k)}" class="${k === selected ? 'on' : ''}">${esc(v)}</button>`).join('')}
    <input type="hidden" name="${name}" value="${esc(selected)}"></div>`;
}
function setSeg(root, name, value) {
  const box = $(`[data-seg="${name}"]`, root);
  $$('button', box).forEach((x) => x.classList.toggle('on', x.dataset.v === value));
  $('input', box).value = value;
}
function wireSegs(root, onChange) {
  $$('[data-seg]', root).forEach((box) => {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      setSeg(root, box.dataset.seg, b.dataset.v);
      onChange?.(box.dataset.seg, b.dataset.v);
    });
  });
}

// Shrinks a photo so it uploads fast and stays small in the free database.
async function shrinkImage(file, maxSide = 1600, maxBytes = 1_400_000) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.8, 0.65, 0.5, 0.4]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob.size < maxBytes) return blob;
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
async function uploadStylePhoto(style, file) {
  const fd = new FormData();
  fd.append('style', style);
  fd.append('file', await shrinkImage(file, 800, 550_000), 'photo.jpg');
  return api('style-photos', { method: 'POST', form: fd });
}
async function aiRead(file, kind) {
  const fd = new FormData();
  fd.append('file', await shrinkImage(file), 'scan.jpg');
  fd.append('kind', kind);
  return (await api('ai/read', { method: 'POST', form: fd })).result;
}
// Opens the phone's photo picker and resolves with the chosen file (or null).
function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// True if the user moved to another screen while this one was loading
const leftPage = (hash) => location.hash !== hash;
// Redraws a screen after a save, but only if the user is still on it
const refresh = (page, fn) => {
  if ((location.hash || '#/').split('?')[0] === page) fn();
};

async function loadProducts() {
  state.products = await api('products');
  return state.products;
}

// ---------- WhatsApp ----------

// Lebanese numbers: "03 123 456", "+961 71 123456", "0096171123456" all become 961XXXXXXX(X).
function waPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('961')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (/^3\d{6}$/.test(d) || /^(70|71|76|78|79|81)\d{6}$/.test(d)) return '961' + d;
  return null;
}
function orderItemsText(order) {
  if (order.items?.length) {
    return order.items.map((it) => `• ${it.qty}× ${[it.style, it.color, it.size].filter(Boolean).join(' · ')}`).join('\n');
  }
  return String(order.summary || '').split(', ').filter(Boolean).map((s) => '• ' + s).join('\n');
}
function waLink(order) {
  const phone = waPhone(order.phone);
  if (!phone) return null;
  const text = (state.settings.wa_confirm || 'Hi {name}! Thank you for your order 🌙\n{items}\nTotal: {total}')
    .replaceAll('{name}', order.customer_name || '')
    .replaceAll('{items}', orderItemsText(order))
    .replaceAll('{total}', usd(order.total_usd).replace('.00', ''))
    .replaceAll('{area}', order.area || '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
function openWhatsApp(order) {
  const link = waLink(order);
  if (!link) return toast('Add a valid Lebanese phone number first', true);
  window.open(link, '_blank', 'noopener');
}

// ---------- Install as an app ----------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $$('.install-btn').forEach((b) => (b.hidden = false));
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $$('.install-btn').forEach((b) => (b.hidden = true));
  toast('App installed 🎉');
});
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installBtn = (cls = 'soft small') => (isInstalled() ? '' : `<button type="button" class="${cls} install-btn">📲 Install app</button>`);

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    return;
  }
  const steps = isIos()
    ? '<ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>'
    : '<ol class="steps"><li>Open the browser menu <b>⋮</b> (top right).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Tap <b>Install</b>.</li></ol>';
  const s = openSheet(`<h2>Install She Sleepwear</h2>${steps}<p class="small muted">The app opens full screen from your home screen, like a normal app.</p><div class="actions"><button class="primary" id="instOk">Got it</button></div>`);
  $('#instOk', s).addEventListener('click', closeSheet);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('.install-btn')) installApp();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

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
  [/^#\/report$/, pageReport],
  [/^#\/settings$/, pageSettings],
  [/^#\/assistant$/, pageAssistant],
];
const MORE_TABS = ['shipments', 'expenses', 'settings', 'report', 'more'];

async function router() {
  const hash = (location.hash || '#/').split('?')[0];
  if (!state.user && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }
  closeSheet();
  const tab = hash.split('/')[1] || 'home';
  const tabName = MORE_TABS.includes(tab) ? 'more' : tab;
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

function openAddSheet() {
  const s = openSheet(`
    <h2>Add new</h2>
    <div class="sheet-menu">
      ${state.settings.ai_enabled ? '<a href="#/assistant"><span class="em">✨</span><span>Ask the assistant<small>Questions, or add an order by message or photo</small></span></a>' : ''}
      <a href="#/orders/new"><span class="em">🛍️</span><span>New order<small>A customer bought something</small></span></a>
      <a href="#/shipments/new"><span class="em">📦</span><span>New shipment<small>Stock from Turkey${state.settings.ai_enabled ? ' · scan your notebook or receipt with AI' : ''}</small></span></a>
      <a href="#/expenses/new"><span class="em">🧾</span><span>New expense<small>Ads, packaging, other costs</small></span></a>
    </div>`);
  $$('a', s).forEach((a) => a.addEventListener('click', closeSheet));
}

// ---------- Login (Google) ----------

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your internet.'));
    document.head.appendChild(s);
  });
}

async function pageLogin() {
  const me = await api('me');
  if (me.user) {
    state.user = me.user;
    location.hash = '#/';
    return;
  }
  view.innerHTML = `
    <div class="auth">
      <img class="logo" src="/icon.svg" alt="">
      <h1 class="center">She Sleepwear</h1>
      <p class="muted center">Your shop, stock and profit in one place.</p>
      <div class="center" style="margin-bottom:12px">${installBtn()}</div>
      <div class="card center">
        <div id="gbtn" style="display:flex;justify-content:center;min-height:44px"></div>
        <p class="small muted" style="margin:12px 0 0">Only people the owner added can get in.</p>
        <div id="loginErr" class="note bad" hidden></div>
      </div>
    </div>`;
  const showErr = (msg) => {
    $('#loginErr').textContent = msg;
    $('#loginErr').hidden = false;
  };
  if (!me.googleClientId) {
    showErr('Google sign-in is not set up yet.');
    return;
  }
  await loadGoogleScript();
  google.accounts.id.initialize({
    client_id: me.googleClientId,
    callback: async ({ credential }) => {
      try {
        await api('login', { method: 'POST', body: { credential } });
        await boot();
        location.hash = '#/';
      } catch (err) {
        showErr(err.message);
      }
    },
  });
  google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
}

// ---------- Home (profit first) ----------

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(state.user?.name || '').split(' ')[0];
  return first ? `${part}, ${first.charAt(0).toUpperCase() + first.slice(1)}` : part;
}

async function pageHome() {
  const month = window._month || thisMonth();
  setTop('She Sleepwear', installBtn());
  const here = location.hash;
  const [d] = await Promise.all([api('dashboard?month=' + month), loadProducts()]);
  if (leftPage(here)) return;
  const maxAbs = Math.max(1, ...d.trend.map((t) => Math.abs(t.profit)));
  const costs = d.cost_of_goods + d.delivery + d.expenses;
  const soldOut = state.products.filter((p) => p.qty <= 0).slice(0, 12);

  view.innerHTML = `
    <div class="greet"><span>${esc(greeting())} 🌙</span><input type="month" id="month" value="${esc(month)}" aria-label="Month"></div>
    ${state.settings.ai_enabled ? '<a class="btn soft block small" href="#/assistant" style="margin-bottom:10px">✨ Ask anything about your shop</a>' : ''}
    <div class="card stat hero">
      <div class="label">Profit · ${esc(monthName(d.month))}</div>
      <div class="value num">${usd(d.profit)}</div>
      <div class="sub">${lbp(d.profit)}</div>
      <div class="split">
        <span>Sales<b class="num">${usd0(d.revenue)}</b></span>
        <span>Costs<b class="num">${usd0(costs)}</b></span>
        <span>Orders<b class="num">${d.orders}</b></span>
        <span>Pieces<b class="num">${d.pieces_sold}</b></span>
      </div>
    </div>

    <div class="card kv" style="margin-top:10px">
      <a href="#/orders?f=owed"><span>Drivers owe you <small>${d.cod_owed.orders} delivered, not paid</small></span><b class="num ${d.cod_owed.amount > 0 ? 'bad' : ''}">${usd0(d.cod_owed.amount)}</b></a>
      <a href="#/orders?f=open"><span>Open orders <small>${usd0(d.open_orders.amount)} not delivered yet</small></span><b class="num">${d.open_orders.orders}</b></a>
      <a href="#/stock"><span>Stock on hand <small>Worth ${usd0(d.stock.value)} at cost</small></span><b class="num">${d.stock.pieces} pcs</b></a>
      <a href="#/shipments"><span>Spent on stock <small>This month, incl. shipping</small></span><b class="num">${usd0(d.stock_bought)}</b></a>
    </div>

    <h2>Last 6 months</h2>
    <div class="card">
      <div class="bars">${d.trend.map((t) => `
        <div class="b" title="${esc(monthName(t.month))}: ${usd(t.profit)}">
          <span class="v">${usd0(t.profit)}</span>
          <div class="bar ${t.profit < 0 ? 'neg' : ''} ${t.month === d.month ? 'cur' : ''}" style="height:${Math.round((Math.abs(t.profit) / maxAbs) * 82)}%"></div>
          <span class="m">${esc(monthShort(t.month))}</span>
        </div>`).join('')}
      </div>
    </div>

    <h2 class="section-link">Best sellers <a href="#/report?m=${esc(d.month)}">Monthly report ›</a></h2>
    <div id="insFilters"></div>
    <div id="ins"><p class="muted center pad">Loading…</p></div>

    <h2>Sold out</h2>
    <div class="card">${soldOut.length ? soldOut.map((p) => `
      <a class="row" href="#/stock/${p.id}" style="padding:6px 0;color:inherit;text-decoration:none">
        ${photoTag(stylePhoto(p.style), 'sm')}
        <div class="grow ellipsis">${esc(variantName(p))}</div>
        <span class="pill cancelled">${p.qty < 0 ? p.qty : 'Sold out'}</span>
      </a>`).join('') : '<div class="muted small">Nothing is sold out. 🎉</div>'}
    </div>`;

  $('#month').addEventListener('change', (e) => {
    window._month = e.target.value || thisMonth();
    refresh('#/', pageHome);
  });
  setupInsights();
}

// ---------- Insights: best sellers charts with filters ----------

const PERIODS = { month: 'This month', last: 'Last month', '3m': '3 months', year: 'This year', all: 'All time' };
const METRICS = { pieces: 'Pieces', sales: 'Sales $', profit: 'Profit $' };
const ins = { period: 'month', style: '', payment: '', metric: 'pieces' };

function periodRange(key) {
  const now = new Date();
  const ymd = (d) => d.toLocaleDateString('en-CA');
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'month') return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
  if (key === 'last') return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  if (key === '3m') return { from: ymd(new Date(y, m - 2, 1)), to: ymd(now) };
  if (key === 'year') return { from: ymd(new Date(y, 0, 1)), to: ymd(now) };
  return { from: '', to: ymd(now) };
}

const metricFmt = (v) => (ins.metric === 'pieces' ? `${v || 0} pcs` : usd0(v));

function hbarChart(rows, { photos = false, empty = '—' } = {}) {
  if (!rows.length) return `<div class="muted small">${empty}</div>`;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r[ins.metric] || 0)));
  return rows.map((r, i) => `
    <div class="hrow">
      ${photos ? photoTag(stylePhoto(r.label), 'sm') : `<span class="rank">${i + 1}</span>`}
      <div class="grow">
        <div class="row between small"><span class="bold ellipsis">${esc(r.label || '—')}</span><span class="num bold">${metricFmt(r[ins.metric])}</span></div>
        <div class="hbar"><i style="width:${Math.max(2, Math.round((Math.abs(r[ins.metric] || 0) / max) * 100))}%"></i></div>
        <div class="tiny muted">${r.pieces} pcs · ${usd0(r.sales)} sales · ${usd0(r.profit)} profit</div>
      </div>
    </div>`).join('');
}

function timeChart(rows, bucket) {
  if (!rows.length) return '<div class="muted small">No sales in this period.</div>';
  const max = Math.max(1, ...rows.map((r) => r[ins.metric] || 0));
  const label = (l) => (bucket === 'day' ? fmtDate(l) : monthShort(l));
  const shown = rows.slice(-14);
  return `<div class="bars">${shown.map((r) => `
    <div class="b" title="${esc(r.label)}: ${metricFmt(r[ins.metric])}">
      <span class="v">${ins.metric === 'pieces' ? r.pieces : usd0(r[ins.metric])}</span>
      <div class="bar cur" style="height:${Math.round(((r[ins.metric] || 0) / max) * 80)}%"></div>
      <span class="m">${esc(label(r.label))}</span>
    </div>`).join('')}</div>
    <p class="tiny muted" style="margin:6px 0 0">${bucket === 'day' ? 'Days with sales' : 'By month'}${rows.length > shown.length ? ` (last ${shown.length})` : ''}.</p>`;
}

async function setupInsights() {
  const box = $('#ins');
  const filters = $('#insFilters');
  if (!box) return;
  const here = location.hash;
  const { from, to } = periodRange(ins.period);
  const qs = new URLSearchParams({ to });
  if (from) qs.set('from', from);
  if (ins.style) qs.set('style', ins.style);
  if (ins.payment) qs.set('payment', ins.payment);
  let r;
  try {
    r = await api('insights?' + qs);
  } catch (err) {
    box.innerHTML = `<div class="note bad">${esc(err.message)}</div>`;
    return;
  }
  if (leftPage(here) || !$('#ins')) return;

  filters.innerHTML = `
    <div class="chips" id="insPeriod">${Object.entries(PERIODS).map(([k, v]) => `<button data-p="${k}" class="${k === ins.period ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="fields" style="margin-bottom:10px">
      <div><select id="insStyle" aria-label="Style"><option value="">All styles</option>${r.styles.map((s) => `<option ${s === ins.style ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div><select id="insPay" aria-label="Payment"><option value="">All payments</option>${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === ins.payment ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
    </div>
    ${seg('insMetric', METRICS, ins.metric)}`;

  const t = r.totals;
  box.innerHTML = `
    <div class="ins-totals" style="margin-top:12px">
      <div class="card stat"><div class="label">Pieces sold</div><div class="value num">${t.pieces}</div><div class="sub">${t.orders} order${t.orders === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="label">Sales</div><div class="value num">${usd0(t.sales)}</div></div>
      <div class="card stat"><div class="label">Profit*</div><div class="value num ${t.profit < 0 ? 'bad' : 'good'}">${usd0(t.profit)}</div></div>
    </div>
    <p class="tiny muted" style="margin:4px 2px 0">*Price − real cost of pieces, before delivery & expenses.</p>
    <div class="card" style="margin-top:10px"><h3>Over time</h3>${timeChart(r.over_time, r.bucket)}</div>
    ${ins.style ? '' : `<div class="card" style="margin-top:12px"><h3>Best styles</h3>${hbarChart(r.by_style, { photos: true, empty: 'No sales in this period.' })}</div>`}
    <div class="ins-pair" style="margin-top:12px">
      <div class="card"><h3>Best colors</h3>${hbarChart(r.by_color)}</div>
      <div class="card"><h3>Best sizes</h3>${hbarChart(r.by_size)}</div>
    </div>`;

  $$('#insPeriod button').forEach((b) => b.addEventListener('click', () => {
    ins.period = b.dataset.p;
    setupInsights();
  }));
  $('#insStyle').addEventListener('change', (e) => {
    ins.style = e.target.value;
    setupInsights();
  });
  $('#insPay').addEventListener('change', (e) => {
    ins.payment = e.target.value;
    setupInsights();
  });
  wireSegs(filters, (_, v) => {
    ins.metric = v;
    setupInsights();
  });
}

// ---------- Orders ----------

async function pageOrders() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const filter = params.get('f') || window._orderFilter || 'all';
  window._orderFilter = filter;
  setTop('Orders', '<a class="btn small primary" href="#/orders/new">+ New</a>');
  const filters = { all: 'All', open: 'Open', owed: 'Driver owes', paid: 'Paid', returned: 'Returned', cancelled: 'Cancelled' };

  view.innerHTML = `
    <div class="chips" id="chips">${Object.entries(filters).map(([k, v]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${v}</button>`).join('')}</div>
    <input id="q" type="search" placeholder="Search name, phone, area" value="${esc(window._orderQ || '')}">
    <div id="list" class="list" style="margin-top:14px"></div>`;

  const load = async () => {
    const q = $('#q').value.trim();
    window._orderQ = q;
    const qs = new URLSearchParams();
    if (filter !== 'all') qs.set('status', filter);
    if (q) qs.set('q', q);
    const here = location.hash;
    const rows = await api('orders?' + qs);
    if (leftPage(here)) return;
    const list = $('#list');
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><span class="big">🛍️</span>No orders here yet.<br><br><a class="btn primary" href="#/orders/new">+ New order</a></div>`;
      return;
    }
    const sum = rows.reduce((a, o) => a + o.total_usd, 0);
    list.innerHTML = `<div class="small muted">${rows.length} order${rows.length === 1 ? '' : 's'} · ${usd(sum)}</div>` + rows.map((o) => `
      <div class="card order-card">
        <a href="#/orders/${o.id}" style="color:inherit;text-decoration:none;display:block">
          <div class="row between">
            <strong class="ellipsis" style="font-size:16px">${esc(o.customer_name || 'No name')}</strong>
            <span class="num serif" style="font-size:18px">${usd(o.total_usd)}</span>
          </div>
          <div class="small muted ellipsis" style="margin-top:2px">${esc(o.summary || '')}</div>
          <div class="meta small">
            <span class="muted ellipsis">${fmtDate(o.date)}${o.area ? ' · ' + esc(o.area) : ''} · ${esc(PAY[o.payment_method])}</span>
            <span class="pill ${o.status}">${STATUS[o.status]}</span>
          </div>
        </a>
        <div class="btns">
          ${NEXT[o.status] ? `<button class="small soft" data-next="${o.id}" data-to="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button>` : ''}
          ${o.phone ? `<button class="small wa" data-wa="${o.id}">WhatsApp</button>` : ''}
        </div>
      </div>`).join('');
    $$('[data-next]', list).forEach((b) => b.addEventListener('click', busy(b, async () => {
      await api(`orders/${b.dataset.next}/status`, { method: 'POST', body: { status: b.dataset.to } });
      toast('Updated');
      refresh('#/orders', load);
    })));
    $$('[data-wa]', list).forEach((b) => b.addEventListener('click', () => openWhatsApp(rows.find((o) => o.id === Number(b.dataset.wa)))));
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
  const here = location.hash;
  const [products, order] = await Promise.all([loadProducts(), id ? api('orders/' + id) : null]);
  if (leftPage(here)) return;
  setTop(id ? `Order #${id}` : 'New order', '', '#/orders');
  const fee = state.settings.default_delivery_fee || '';
  const draft = !id && window._draftOrder;
  window._draftOrder = null;
  const o = order || (draft ? { date: today(), ...draft } : { date: today(), payment_method: 'cod', status: 'new', items: [], total_usd: '', delivery_cost_usd: fee });

  if (!products.length) {
    view.innerHTML = `<div class="empty"><span class="big">📦</span>You have no stock yet.<br><br><a class="btn primary" href="#/shipments/new">Add a shipment</a> <a class="btn" href="#/stock/new">Add stock</a></div>`;
    return;
  }

  // Options grouped by style so the list is easy to scan
  const byStyle = {};
  products.forEach((p) => (byStyle[p.style] ||= []).push(p));
  const options = (selected) => Object.entries(byStyle).map(([style, list]) => `
    <optgroup label="${esc(style)}">${list.slice().sort((a, b) => (a.color || '').localeCompare(b.color || '') || sizeRank(a.size) - sizeRank(b.size)).map((p) =>
      `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc([p.style, p.color, p.size].filter(Boolean).join(' · '))} — ${p.qty} left</option>`).join('')}</optgroup>`).join('');

  const itemRow = (it = {}) => `
    <div class="item-row">
      <button type="button" class="link x" data-remove aria-label="Remove item">✕</button>
      <div class="row top">
        <span class="pick-ph">${photoTag(products.find((p) => p.id === it.product_id))}</span>
        <div class="grow">
          <label style="margin-top:0">Item</label>
          <select name="product">${it.product_id ? '' : '<option value="">Choose…</option>'}${options(it.product_id)}</select>
        </div>
      </div>
      <div class="fields">
        <div><label>Quantity</label><input name="qty" type="number" inputmode="numeric" min="1" value="${it.qty || 1}"></div>
        <div><label>Price each (USD)</label><input name="price" type="number" inputmode="decimal" step="any" min="0" value="${it.unit_price_usd ?? ''}"></div>
      </div>
      <div class="hint min-note"></div>
    </div>`;

  view.innerHTML = `
    <form id="f">
      <div class="card">
        <div class="fields">
          <div class="full"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" inputmode="tel" value="${esc(o.phone)}" placeholder="e.g. 71 123 456" autocomplete="off"></div>
          <div class="full hint" id="custHint"></div>
          <div class="full"><label for="customer_name">Customer name</label><input id="customer_name" name="customer_name" value="${esc(o.customer_name)}"></div>
          <div><label for="area">Area</label><input id="area" name="area" value="${esc(o.area)}" placeholder="e.g. Jounieh"></div>
          <div><label for="date">Date</label><input id="date" name="date" type="date" value="${esc(o.date)}"></div>
        </div>
      </div>

      <h2>Items</h2>
      <div id="items">${(o.items.length ? o.items : [{}]).map(itemRow).join('')}</div>
      <button type="button" class="block soft" id="addItem" style="margin-top:12px">+ Add another item</button>

      <h2>Payment & delivery</h2>
      <div class="card">
        <label style="margin-top:0">Payment</label>
        ${seg('payment_method', PAY, o.payment_method)}
        <label>Status</label>
        ${seg('status', STATUS, o.status)}
        ${moneyInput('total_usd', o.total_usd, 'Total the customer pays')}
        <div class="hint" id="autoNote">Fills in from the items. Change it for a discount.</div>
        ${moneyInput('delivery_cost_usd', o.delivery_cost_usd, 'Delivery fee you pay', 'Leave empty if the customer pays the driver directly.')}
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes" placeholder="Anything to remember">${esc(o.notes)}</textarea>
        <div class="sumbox" id="sum"></div>
      </div>

      <div class="actions">
        <button class="primary" id="save">${id ? 'Save changes' : 'Save order'}</button>
        ${id && o.phone ? '<button type="button" class="wa" id="waBtn">WhatsApp</button>' : ''}
        ${id ? '<button type="button" class="danger" id="del">Delete</button>' : ''}
      </div>
    </form>`;

  const f = $('#f');
  let totalTouched = !!id || !!draft;
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
      f.total_usd.value = itemsTotal ? (cur === 'LBP' ? Math.round(itemsTotal * rate()) : round2(itemsTotal)) : '';
    }
    // Per-row photo and minimum price warning
    $$('.item-row', f).forEach((row) => {
      const p = products.find((x) => x.id === Number($('[name=product]', row).value));
      $('.pick-ph', row).innerHTML = photoTag(p);
      const price = Number($('[name=price]', row).value) || 0;
      const min = p?.min_price_usd || 0;
      $('.min-note', row).innerHTML = p && min && price && price < min
        ? `<span class="bad bold">Below your minimum of ${usd(min)}</span>`
        : p && min ? `Minimum ${usd(min)}` : '';
    });
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
      <div class="row between total"><span>Your profit</span><span class="num ${profit < 0 ? 'bad' : 'good'}">${usd(profit)}</span></div>
      ${warn.length ? `<div class="note">Not enough stock for: ${warn.map((w) => esc(variantName(products.find((p) => p.id === w.product_id)))).join(', ')}. You can still save (stock goes below 0).</div>` : ''}`;
  };

  // Returning customer: fill name and area from their last order
  let lookupTimer;
  const lookup = async () => {
    const digits = f.phone.value.replace(/\D/g, '');
    if (digits.length < 7) {
      $('#custHint').textContent = '';
      return;
    }
    try {
      const found = await api('customers?q=' + encodeURIComponent(digits.slice(-7)));
      const target = waPhone(f.phone.value) || digits;
      const c = found.find((x) => x.phone === target || x.phone.endsWith(digits.slice(-7)));
      if (!c) {
        $('#custHint').textContent = waPhone(f.phone.value) ? 'New customer' : 'Check the number (Lebanese mobile)';
        return;
      }
      if (!f.customer_name.value) f.customer_name.value = c.name;
      if (!f.area.value) f.area.value = c.area;
      $('#custHint').innerHTML = `<span class="good bold">Returning customer</span> · ${c.orders_count} order${c.orders_count === 1 ? '' : 's'} · ${usd(c.total_spent)} spent`;
    } catch {
      $('#custHint').textContent = '';
    }
  };

  wireSegs(f);
  onMoneyCurrencyChange(f, refresh);
  f.addEventListener('input', (e) => {
    if (e.target.name === 'phone') {
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(lookup, 350);
      return;
    }
    if (e.target.name === 'total_usd') {
      totalTouched = e.target.value !== '';
      $('#autoNote').textContent = totalTouched ? 'Typed by you. Clear it to fill in from the items again.' : 'Fills in from the items. Change it for a discount.';
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
    const saved = await api(id ? 'orders/' + id : 'orders', { method: id ? 'PUT' : 'POST', body: payload });
    if (id) {
      toast('Order saved');
      location.hash = '#/orders';
      return;
    }
    // New order: offer to send the WhatsApp confirmation right away
    const canWa = !!waPhone(saved.phone);
    const s = openSheet(`
      <h2>Order saved ✓</h2>
      <p class="muted" style="margin-top:0">${esc(saved.customer_name || 'Customer')} · ${usd(saved.total_usd)}</p>
      ${canWa ? '<button class="wa block" id="sWa">Send WhatsApp confirmation</button>' : `<div class="note">${saved.phone ? 'The phone number doesn’t look like a Lebanese mobile, so WhatsApp can’t open.' : 'No phone number, so no WhatsApp message.'}</div>`}
      <div class="actions"><button id="sDone">Done</button><button class="soft" id="sAnother">New order</button></div>`);
    $('#sDone', s).addEventListener('click', () => (location.hash = '#/orders'));
    $('#sAnother', s).addEventListener('click', () => (location.hash === '#/orders/new' ? router() : (location.hash = '#/orders/new')));
    if (canWa) $('#sWa', s).addEventListener('click', () => {
      openWhatsApp(saved);
      location.hash = '#/orders';
    });
  }));
  if (id) {
    $('#del').addEventListener('click', busy($('#del'), async () => {
      if (!confirm('Delete this order? Its pieces go back to stock.')) return;
      await api('orders/' + id, { method: 'DELETE' });
      toast('Order deleted');
      location.hash = '#/orders';
    }));
    $('#waBtn')?.addEventListener('click', () => openWhatsApp({ ...o, ...{ customer_name: f.customer_name.value, area: f.area.value, phone: f.phone.value } }));
  }
  if (o.phone) lookup();
  refresh();
}

// ---------- Stock ----------

function groupStyles(products) {
  const groups = new Map();
  products.forEach((p) => {
    if (!groups.has(p.style)) groups.set(p.style, []);
    groups.get(p.style).push(p);
  });
  return [...groups.entries()].map(([style, list]) => {
    const first = list.find((p) => p.photo_id) || list[0];
    return {
      style, list, photo: first,
      code: list.find((p) => p.code)?.code || '',
      price: Math.max(...list.map((p) => p.sale_price_usd || 0)),
      min: Math.max(...list.map((p) => p.min_price_usd || 0)),
      cost: list.reduce((a, p) => a + Math.max(p.qty, 0) * p.avg_cost_usd, 0) / Math.max(1, list.reduce((a, p) => a + Math.max(p.qty, 0), 0)),
      pieces: list.reduce((a, p) => a + Math.max(p.qty, 0), 0),
    };
  });
}

function matrixHtml(list) {
  const sizes = [...new Set(list.map((p) => p.size || '—'))].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const colors = [...new Set(list.map((p) => p.color || '—'))];
  return `<table class="matrix"><tr><th class="color">Color</th>${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}</tr>
    ${colors.map((c) => `<tr><td class="color">${esc(c)}</td>${sizes.map((s) => {
      const p = list.find((x) => (x.color || '—') === c && (x.size || '—') === s);
      if (!p) return '<td class="q none"></td>';
      return `<td class="q ${p.qty <= 0 ? 'zero' : ''}" data-pid="${p.id}" title="${esc(variantName(p))}">${p.qty}</td>`;
    }).join('')}</tr>`).join('')}</table>`;
}

async function pageStock() {
  setTop('Stock', '<a class="btn small primary" href="#/stock/new">+ Add</a>');
  const here = location.hash;
  const products = await loadProducts();
  if (leftPage(here)) return;
  view.innerHTML = `<input id="q" type="search" placeholder="Search style, code, color, size" value="${esc(window._stockQ || '')}"><div id="list"></div>`;

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    window._stockQ = q;
    const rows = products.filter((p) => !q || `${variantName(p)} ${p.code || ''}`.toLowerCase().includes(q));
    if (!rows.length) {
      $('#list').innerHTML = `<div class="empty"><span class="big">📦</span>${products.length ? 'Nothing matches.' : 'No stock yet. Add a shipment from Turkey, or add stock by hand.'}</div>`;
      return;
    }
    const styles = groupStyles(rows);
    const pieces = styles.reduce((a, s) => a + s.pieces, 0);
    $('#list').innerHTML = `<p class="small muted">${pieces} pieces in ${styles.length} style${styles.length === 1 ? '' : 's'}. Tap a number to edit it.</p>` + styles.map((s) => `
      <div class="card" style="margin-top:12px">
        <div class="row top">
          <button type="button" class="link" data-photo="${esc(s.style)}" style="padding:0" aria-label="Photo for ${esc(s.style)}">${photoTag(s.photo)}</button>
          <div class="grow">
            <div class="row between top">
              <h3 class="serif" style="font-size:17px;font-weight:600">${esc(s.style)}</h3>
              <button type="button" class="small" data-edit-style="${esc(s.style)}">Edit</button>
            </div>
            <div class="small muted" style="margin-top:1px">
              <b style="color:var(--ink)">${s.pieces} pcs</b> · sell ${usd0(s.price)}${s.min ? ` (min ${usd0(s.min)})` : ''} · cost ${usd(s.cost)}${s.code ? ` · <span class="pill code">${esc(s.code)}</span>` : ''}
            </div>
          </div>
        </div>
        ${matrixHtml(s.list)}
      </div>`).join('') + '<p class="tiny muted" style="margin-top:12px">Cost = real cost per piece, including shipping and customs. Red = sold out.</p>';

    $$('td[data-pid]').forEach((td) => td.addEventListener('click', () => (location.hash = '#/stock/' + td.dataset.pid)));
    $$('[data-edit-style]').forEach((b) => b.addEventListener('click', () => editStyleSheet(styles.find((s) => s.style === b.dataset.editStyle))));
    $$('[data-photo]').forEach((b) => b.addEventListener('click', async () => {
      const file = await pickPhoto();
      if (!file) return;
      try {
        toast('Uploading photo…');
        await uploadStylePhoto(b.dataset.photo, file);
        toast('Photo saved');
        refresh('#/stock', pageStock);
      } catch (err) {
        toast(err.message, true);
      }
    }));
  };
  $('#q').addEventListener('input', draw);
  draw();
}

function editStyleSheet(s) {
  const sheet = openSheet(`
    <h2>Edit style</h2>
    <form id="sf">
      <div class="row" style="gap:14px">
        <span id="sfPh">${photoTag(s.photo, 'lg')}</span>
        <div class="grow">
          <button type="button" class="small soft" id="sfPhoto">${s.photo?.photo_id ? 'Change photo' : 'Add photo'}</button>
          ${s.photo?.photo_id ? '<button type="button" class="small link" id="sfPhotoDel">Remove</button>' : ''}
        </div>
      </div>
      <label for="sfName">Style name</label><input id="sfName" name="new_style" value="${esc(s.style)}" required>
      <label for="sfCode">Supplier code(s)</label><input id="sfCode" name="code" value="${esc(s.code)}" placeholder="e.g. 23522">
      <div class="fields">
        <div><label for="sfPrice">Selling price (USD)</label><input id="sfPrice" name="sale_price_usd" type="number" inputmode="decimal" step="any" min="0" value="${s.price || ''}"></div>
        <div><label for="sfMin">Minimum price (USD)</label><input id="sfMin" name="min_price_usd" type="number" inputmode="decimal" step="any" min="0" value="${s.min || ''}"></div>
      </div>
      <p class="hint">Changes apply to every color and size of this style.</p>
      <div class="actions"><button class="primary" id="sfSave">Save</button><button type="button" id="sfCancel">Cancel</button></div>
    </form>`);
  const f = $('#sf', sheet);
  $('#sfCancel', sheet).addEventListener('click', closeSheet);
  $('#sfPhoto', sheet).addEventListener('click', async () => {
    const file = await pickPhoto();
    if (!file) return;
    try {
      toast('Uploading photo…');
      await uploadStylePhoto(s.style, file);
      toast('Photo saved');
      closeSheet();
      refresh('#/stock', pageStock);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#sfPhotoDel', sheet)?.addEventListener('click', async () => {
    if (!confirm('Remove this photo?')) return;
    await api('style-photos/' + s.photo.photo_id, { method: 'DELETE' });
    closeSheet();
    refresh('#/stock', pageStock);
  });
  f.addEventListener('submit', busy($('#sfSave', sheet), async () => {
    await api('styles', {
      method: 'PUT',
      body: {
        style: s.style, new_style: f.new_style.value.trim(), code: f.code.value.trim(),
        sale_price_usd: Number(f.sale_price_usd.value) || 0, min_price_usd: Number(f.min_price_usd.value) || 0,
      },
    });
    toast('Style saved');
    closeSheet();
    refresh('#/stock', pageStock);
  }));
}

function datalists(products) {
  const uniq = (k) => [...new Set(products.map((p) => p[k]).filter(Boolean))].sort();
  return `
    <datalist id="dl-style">${uniq('style').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="dl-color">${uniq('color').map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="dl-size">${[...new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', ...uniq('size')])].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

async function pageStockNew() {
  setTop('Add stock', '', '#/stock');
  const here = location.hash;
  const products = await loadProducts();
  if (leftPage(here)) return;
  view.innerHTML = `
    ${datalists(products)}
    <div class="note info" style="margin-top:0">Stock from Turkey is best added as a <a href="#/shipments/new">shipment</a>, so shipping and customs count in the cost. Use this for stock you already have.</div>
    <form id="f" class="card" style="margin-top:14px">
      <label for="style" style="margin-top:0">Style name</label><input id="style" name="style" list="dl-style" required placeholder="e.g. Smile">
      <div class="fields">
        <div><label for="code">Supplier code</label><input id="code" name="code" placeholder="e.g. 23522"></div>
        <div><label for="color">Color</label><input id="color" name="color" list="dl-color" placeholder="e.g. Teal"></div>
      </div>
      <label for="sizes">Sizes (separate with commas)</label><input id="sizes" name="sizes" placeholder="S, M, L, XL">
      <label for="qty">Quantity per size</label><input id="qty" name="qty" type="number" inputmode="numeric" value="1">
      ${moneyInput('cost', '', 'Real cost per piece')}
      ${moneyInput('price', '', 'Selling price')}
      ${moneyInput('min', '', 'Minimum price (optional)')}
      <div class="actions"><button class="primary" id="save">Add to stock</button></div>
    </form>`;
  const f = $('#f');
  onMoneyCurrencyChange(f);
  f.addEventListener('submit', busy($('#save'), async () => {
    const sizes = f.sizes.value.split(',').map((s) => s.trim()).filter(Boolean);
    for (const size of sizes.length ? sizes : ['']) {
      await api('products', {
        method: 'POST',
        body: {
          style: f.style.value, color: f.color.value, size, code: f.code.value, qty: Number(f.qty.value) || 0,
          avg_cost_usd: round2(readMoney(f, 'cost')), sale_price_usd: round2(readMoney(f, 'price')), min_price_usd: round2(readMoney(f, 'min')),
        },
      });
    }
    toast('Stock added');
    location.hash = '#/stock';
  }));
}

async function pageStockEdit(id) {
  setTop('Edit item', '', '#/stock');
  const here = location.hash;
  const products = await loadProducts();
  if (leftPage(here)) return;
  const p = products.find((x) => x.id === Number(id));
  if (!p) throw new Error('Not found');
  view.innerHTML = `
    ${datalists(products)}
    <div class="card row" style="gap:14px">${photoTag(p, 'lg')}<div class="grow"><h3 class="serif" style="font-size:19px;font-weight:600">${esc(p.style)}</h3>
      <div class="small muted">${p.code ? `<span class="pill code">${esc(p.code)}</span> ` : ''}${p.min_price_usd ? `Min ${usd(p.min_price_usd)}` : ''}</div>
      <div class="tiny muted" style="margin-top:4px">Name, code, price and photo for the whole style: Stock → Edit.</div></div></div>
    <form id="f" class="card" style="margin-top:12px">
      <div class="fields">
        <div><label for="color" style="margin-top:0">Color</label><input id="color" name="color" list="dl-color" value="${esc(p.color)}"></div>
        <div><label for="size" style="margin-top:0">Size</label><input id="size" name="size" list="dl-size" value="${esc(p.size)}"></div>
      </div>
      <label for="qty">Quantity in stock</label><input id="qty" name="qty" type="number" inputmode="numeric" value="${p.qty}">
      ${moneyInput('cost', p.avg_cost_usd, 'Real cost per piece')}
      ${moneyInput('price', p.sale_price_usd, 'Selling price')}
      <div class="hint" id="margin"></div>
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
      body: {
        style: p.style, code: p.code, min_price_usd: p.min_price_usd, color: f.color.value, size: f.size.value,
        qty: Number(f.qty.value) || 0, avg_cost_usd: round2(readMoney(f, 'cost')), sale_price_usd: round2(readMoney(f, 'price')),
      },
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
  setTop('Shipments', '<a class="btn small primary" href="#/shipments/new">+ New</a>', '#/more');
  const here = location.hash;
  const rows = await api('shipments');
  if (leftPage(here)) return;
  view.innerHTML = `
    <p class="small muted" style="margin-top:0">Each shipment from Turkey. When it arrives, the app splits shipping and customs over every piece and adds them to stock.</p>
    <div class="list">${rows.length ? rows.map((s) => `
      <a class="card" href="#/shipments/${s.id}">
        <div class="row between"><strong>${esc(s.supplier || 'Shipment')}</strong><span class="pill ${s.status}">${s.status === 'arrived' ? 'Arrived' : 'On the way'}</span></div>
        <div class="row between small" style="margin-top:6px">
          <span class="muted">${fmtDate(s.date)} · ${s.pieces} pcs${s.receipt_count ? ` · ${s.receipt_count} receipt${s.receipt_count > 1 ? 's' : ''}` : ''}</span>
          <strong class="num serif" style="font-size:17px">${usd(s.goods_usd + s.shipping_usd + s.customs_usd + s.other_usd)}</strong>
        </div>
      </a>`).join('') : '<div class="empty"><span class="big">📦</span>No shipments yet.</div>'}
    </div>`;
}

async function pageShipmentForm(id) {
  const here = location.hash;
  const [products, s] = await Promise.all([loadProducts(), id ? api('shipments/' + id) : null]);
  if (leftPage(here)) return;
  if (s && s.status === 'arrived') {
    location.hash = '#/shipments/' + id;
    return;
  }
  setTop(id ? 'Edit shipment' : 'New shipment', '', id ? '#/shipments/' + id : '#/shipments');
  const sh = s || { date: today(), supplier: '', items: [], shipping_usd: '', customs_usd: '', other_usd: '', notes: '' };
  const scanned = []; // photos read by AI, saved as receipts with the shipment
  const draft = !id && window._draftShipment;
  window._draftShipment = null;

  const itemRow = (it = {}, ai = false) => `
    <div class="item-row ${ai ? 'ai' : ''}">
      <button type="button" class="link x" data-remove aria-label="Remove item">✕</button>
      <div class="fields">
        <div class="full"><label style="margin-top:0">Style</label><input name="style" list="dl-style" value="${esc(it.style)}" placeholder="e.g. Smile"></div>
        <div><label>Code</label><input name="code" value="${esc(it.code)}" placeholder="e.g. 23522"></div>
        <div><label>Color</label><input name="color" list="dl-color" value="${esc(it.color)}"></div>
        <div><label>Size</label><input name="size" list="dl-size" value="${esc(it.size)}"></div>
        <div><label>Quantity</label><input name="qty" type="number" inputmode="numeric" min="1" value="${it.qty || ''}"></div>
        <div class="full"><label>Price each (wholesale)</label><input name="cost" type="number" inputmode="decimal" step="any" min="0" value="${it.unit_cost_usd ?? it.unit_cost ?? ''}"></div>
      </div>
    </div>`;

  view.innerHTML = `
    ${datalists(products)}
    ${!id && state.settings.ai_enabled ? `
    <div class="card" style="background:var(--blush-2);border-color:var(--blush)">
      <div class="row top"><span style="font-size:26px">✨</span><div class="grow">
        <h3>Fill it with AI</h3>
        <p class="small muted" style="margin:2px 0 10px">Take a photo of the supplier receipt or your notebook page. The app fills in the items. Check every line before saving.</p>
        <button type="button" class="primary block" id="aiBtn">Scan a photo</button>
        <div id="aiNote"></div>
      </div></div>
    </div>` : ''}
    <form id="f">
      <div class="card" style="margin-top:14px">
        <div class="fields">
          <div><label for="date" style="margin-top:0">Date</label><input id="date" name="date" type="date" value="${esc(sh.date)}"></div>
          <div><label for="supplier" style="margin-top:0">Supplier</label><input id="supplier" name="supplier" value="${esc(sh.supplier)}" placeholder="Name in Turkey"></div>
        </div>
        <label>Item prices are in</label>
        ${seg('item_cur', { USD: 'USD', LBP: 'LBP' }, 'USD')}
      </div>

      <h2>Items</h2>
      <div id="items">${(sh.items.length ? sh.items : [{}]).map((it) => itemRow(it)).join('')}</div>
      <button type="button" class="block soft" id="addItem" style="margin-top:12px">+ Add another item</button>

      <h2>Extra costs</h2>
      <div class="card">
        ${moneyInput('shipping_usd', sh.shipping_usd, 'Shipping (Turkey → Lebanon), total')}
        ${moneyInput('customs_usd', sh.customs_usd, 'Customs, total')}
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
      code: $('[name=code]', row).value.trim(),
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
      ${pieces ? `<div class="row between small" style="margin-top:6px"><span>Extra cost per piece</span><span class="num">+${usd(extra / pieces)}</span></div>
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
    // Copy style, code and color from the last row, since one style often comes in many sizes
    const rows = $$('.item-row', f);
    const last = rows[rows.length - 1];
    const val = (n) => (last ? $(`[name=${n}]`, last).value : '');
    $('#items').insertAdjacentHTML('beforeend', itemRow({ style: val('style'), code: val('code'), color: val('color'), unit_cost_usd: val('cost') }));
    $('[name=size]', $$('.item-row', f).pop()).focus();
    refresh();
  });

  // Puts what the AI read into the form (pink lines), adding to what is already there
  const fillFromAi = (r) => {
      // If the form only has one empty row, replace it; otherwise add after what's there
      const rows = $$('.item-row', f);
      if (rows.length === 1 && !$('[name=style]', rows[0]).value) rows[0].remove();
      $('#items').insertAdjacentHTML('beforeend', r.items.map((it) => itemRow(it, true)).join(''));
      if (r.supplier && !f.supplier.value) f.supplier.value = r.supplier;
      if (r.date) f.date.value = r.date;
      const cur = r.currency === 'LBP' ? 'LBP' : 'USD';
      setSeg(f, 'item_cur', cur);
      const add = (name, v) => {
        if (!v) return;
        const prev = readMoney(f, name);
        setMoney(f, name, cur === 'LBP' ? Math.round(prev * rate() + v) : round2(prev + v), cur);
      };
      add('shipping_usd', r.shipping);
      add('customs_usd', r.customs);
      add('other_usd', r.other);
      if (r.notes) f.notes.value = [f.notes.value, r.notes].filter(Boolean).join('\n');
      const pieces = r.items.reduce((a, it) => a + it.qty, 0);
      const odd = r.currency && !['USD', 'LBP'].includes(r.currency);
      const note = `<div class="note ${odd ? '' : 'info'}">Filled ${r.items.length} line${r.items.length === 1 ? '' : 's'} (${pieces} pieces). Pink lines came from the AI, so <b>check each one</b>, especially crossed-out sizes.${odd ? ` Prices look like <b>${esc(r.currency)}</b>; change them to USD before saving.` : ''}</div>`;
      if ($('#aiNote')) $('#aiNote').innerHTML = note;
      else $('#f').insertAdjacentHTML('beforebegin', note);
      refresh();
  };
  $('#aiBtn')?.addEventListener('click', busy($('#aiBtn'), async () => {
    const file = await pickPhoto();
    if (!file) return;
    const btn = $('#aiBtn');
    btn.innerHTML = '<span class="spinner"></span> Reading the photo…';
    try {
      const r = await aiRead(file, 'shipment');
      scanned.push(file);
      if (!r.items.length) throw new Error('The AI found no items. Try a clearer photo, or type them in.');
      fillFromAi(r);
    } finally {
      btn.textContent = 'Scan another photo';
    }
  }));
  if (draft) {
    if (draft.photo) scanned.push(draft.photo);
    fillFromAi(draft.result);
  }

  f.addEventListener('submit', busy($('#save'), async () => {
    const items = readItems();
    if (!items.length) throw new Error('Add at least one item with a style and quantity');
    const payload = {
      date: f.date.value, supplier: f.supplier.value, notes: f.notes.value, items,
      shipping_usd: round2(readMoney(f, 'shipping_usd')), customs_usd: round2(readMoney(f, 'customs_usd')), other_usd: round2(readMoney(f, 'other_usd')),
    };
    const saved = await api(id ? 'shipments/' + id : 'shipments', { method: id ? 'PUT' : 'POST', body: payload });
    // Save supplier codes on the styles (shipments don't store them)
    const codes = new Map(items.filter((it) => it.code).map((it) => [it.style, it.code]));
    for (const [style, code] of codes) await api('styles', { method: 'PUT', body: { style, code } }).catch(() => {});
    const photos = [...scanned, ...($('#photos')?.files || [])];
    if (photos.length) await uploadReceipts(photos, { type: 'shipment', id: saved.id });
    toast('Shipment saved');
    location.hash = '#/shipments/' + saved.id;
  }));
  refresh();
}

async function pageShipment(id) {
  const here = location.hash;
  const [s] = await Promise.all([api('shipments/' + id), loadProducts()]);
  if (leftPage(here)) return;
  setTop(s.supplier || 'Shipment', '', '#/shipments');
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

    ${arrived ? '' : `<div class="note">When the clothes arrive, tap <b>Arrived</b>. The pieces go into stock with their real cost. After that, the shipment can't be changed.</div>`}

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
      refresh('#/shipments/' + id, () => pageShipment(id));
    } catch (err) {
      toast(err.message, true);
    }
  });
  if (!arrived) {
    $('#arrive').addEventListener('click', busy($('#arrive'), async () => {
      if (!confirm(`Add ${pieces} pieces to stock? Each piece gets +${usd(perPiece)} for shipping and customs.`)) return;
      await api(`shipments/${id}/arrive`, { method: 'POST' });
      toast('Added to stock');
      refresh('#/shipments/' + id, () => pageShipment(id));
    }));
    $('#del').addEventListener('click', busy($('#del'), async () => {
      if (!confirm('Delete this shipment?')) return;
      await api('shipments/' + id, { method: 'DELETE' });
      location.hash = '#/shipments';
    }));
  }
}

// ---------- More ----------

async function pageMore() {
  setTop('More');
  view.innerHTML = `
    <div class="card menu">
      <a href="#/report"><span class="em">📊</span><span class="grow">Monthly report<small>Profit, best sizes & colors, print or PDF</small></span><span>›</span></a>
      <a href="#/shipments"><span class="em">📦</span><span class="grow">Shipments<small>Stock from Turkey, receipts</small></span><span>›</span></a>
      <a href="#/expenses"><span class="em">🧾</span><span class="grow">Expenses<small>Ads, packaging, other costs</small></span><span>›</span></a>
      <a href="#/settings"><span class="em">⚙️</span><span class="grow">Settings<small>Dollar rate, WhatsApp text, people, backup</small></span><span>›</span></a>
    </div>
    <p class="small muted center" style="margin-top:22px">Signed in as <strong>${esc(state.user.email)}</strong>${state.user.role === 'owner' ? ' (owner)' : ''}</p>`;
}

// ---------- Expenses ----------

async function pageExpenses() {
  const month = window._expMonth || thisMonth();
  setTop('Expenses', `<input type="month" id="month" value="${esc(month)}" style="width:auto;padding:8px 10px" aria-label="Month">`, '#/more');
  const here = location.hash;
  const rows = await api('expenses?month=' + month);
  if (leftPage(here)) return;
  const total = rows.reduce((a, e) => a + e.amount_usd, 0);
  view.innerHTML = `
    <div class="card stat"><div class="label">Total · ${esc(monthName(month))}</div><div class="value num">${usd(total)}</div><div class="sub">${lbp(total)}</div></div>
    <p class="tiny muted" style="margin:8px 4px 0">Costs that are not stock: ads, bags, packaging. Shipments are tracked separately.</p>
    <div class="list" style="margin-top:12px">${rows.map((e) => `
      <div class="card row">
        <div class="grow">
          <strong>${esc(e.category)}</strong> <span class="muted small">${fmtDate(e.date)}</span>
          ${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}
          ${e.receipt_id ? `<a class="small" href="/api/receipts/${e.receipt_id}" target="_blank" rel="noopener">View receipt</a>` : ''}
        </div>
        <strong class="num serif" style="font-size:17px">${usd(e.amount_usd)}</strong>
        <button class="link" data-del="${e.id}" aria-label="Delete">✕</button>
      </div>`).join('') || '<div class="empty"><span class="big">🧾</span>No expenses this month.</div>'}
    </div>
    <a class="btn primary fab" href="#/expenses/new">+ Add expense</a>`;
  $('#month').addEventListener('change', (e) => {
    window._expMonth = e.target.value || thisMonth();
    refresh('#/expenses', pageExpenses);
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', busy(b, async () => {
    if (!confirm('Delete this expense?')) return;
    await api('expenses/' + b.dataset.del, { method: 'DELETE' });
    refresh('#/expenses', pageExpenses);
  })));
}

async function pageExpenseNew() {
  setTop('Add expense', '', '#/expenses');
  view.innerHTML = `
    ${state.settings.ai_enabled ? `<button type="button" class="soft block" id="aiBtn">✨ Scan receipt with AI</button><div id="aiNote"></div>` : ''}
    <form id="f" class="card" style="margin-top:14px">
      <label for="date" style="margin-top:0">Date</label><input id="date" name="date" type="date" value="${today()}">
      <label>Type</label>
      ${seg('category', Object.fromEntries(EXPENSE_CATS.map((c) => [c, c])), 'Ads')}
      ${moneyInput('amount', '', 'Amount')}
      <label for="note">Note</label><input id="note" name="note" placeholder="e.g. Instagram ad, 5 days">
      <label for="photos">Receipt photo (optional)</label><input id="photos" type="file" accept="image/*">
      <div class="actions"><button class="primary" id="save">Save</button></div>
    </form>`;
  const f = $('#f');
  const scanned = [];
  wireSegs(f);
  onMoneyCurrencyChange(f);
  const fillExpense = (r) => {
    if (r.date) f.date.value = r.date;
    if (EXPENSE_CATS.includes(r.category)) setSeg(f, 'category', r.category);
    if (r.amount) setMoney(f, 'amount', r.amount, r.currency === 'LBP' ? 'LBP' : 'USD');
    if (r.note) f.note.value = r.note;
  };
  const draft = window._draftExpense;
  window._draftExpense = null;
  if (draft) {
    if (draft.photo) scanned.push(draft.photo);
    fillExpense(draft.result);
  }
  $('#aiBtn')?.addEventListener('click', busy($('#aiBtn'), async () => {
    const file = await pickPhoto();
    if (!file) return;
    const btn = $('#aiBtn');
    btn.innerHTML = '<span class="spinner"></span> Reading the receipt…';
    try {
      const r = await aiRead(file, 'expense');
      scanned.push(file);
      fillExpense(r);
      const odd = r.currency && !['USD', 'LBP'].includes(r.currency);
      $('#aiNote').innerHTML = `<div class="note ${odd ? '' : 'info'}">Filled from the photo. Please check it.${odd ? ` The amount looks like <b>${esc(r.currency)}</b>; change it to USD.` : ''}</div>`;
    } finally {
      btn.textContent = '✨ Scan another receipt';
    }
  }));
  f.addEventListener('submit', busy($('#save'), async () => {
    const e = await api('expenses', {
      method: 'POST',
      body: { date: f.date.value, category: f.category.value, amount_usd: round2(readMoney(f, 'amount')), note: f.note.value },
    });
    const photos = [...scanned, ...$('#photos').files];
    if (photos.length) await uploadReceipts(photos.slice(0, 1), { type: 'expense', id: e.id });
    toast('Expense saved');
    location.hash = '#/expenses';
  }));
}

// ---------- Monthly report ----------

function barsList(rows, labelKey, valueKey, fmt = (v) => v) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return rows.map((r) => `
    <div style="padding:5px 0">
      <div class="row between small"><span class="bold">${esc(r[labelKey] || '—')}</span><span class="num">${fmt(r[valueKey])}</span></div>
      <div class="hbar"><i style="width:${Math.round((r[valueKey] / max) * 100)}%"></i></div>
    </div>`).join('');
}

async function pageReport() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = params.get('m') || window._month || thisMonth();
  setTop('Report', `<input type="month" id="month" value="${esc(month)}" style="width:auto;padding:8px 10px" aria-label="Month">`, '#/more');
  const here = location.hash;
  const [r] = await Promise.all([api('report?month=' + month), loadProducts()]);
  if (leftPage(here)) return;
  const costs = r.cost_of_goods + r.delivery + r.expenses;
  const slowStyles = [...new Set(r.slow_stock.map((p) => p.style))];
  view.innerHTML = `
    <h2 style="margin-top:4px">${esc(monthName(r.month))}</h2>
    <div class="card stat hero">
      <div class="label">Profit</div>
      <div class="value num">${usd(r.profit)}</div>
      <div class="sub">${lbp(r.profit)}</div>
      <div class="split">
        <span>Sales<b class="num">${usd0(r.revenue)}</b></span>
        <span>Costs<b class="num">${usd0(costs)}</b></span>
        <span>Orders<b class="num">${r.orders}</b></span>
        <span>Pieces<b class="num">${r.pieces_sold}</b></span>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <table class="table">
        <tr><td>Sales</td><td class="num">${usd(r.revenue)}</td></tr>
        <tr><td>Real cost of pieces sold</td><td class="num">−${usd(r.cost_of_goods)}</td></tr>
        <tr><td>Delivery fees</td><td class="num">−${usd(r.delivery)}</td></tr>
        <tr><td>Other expenses</td><td class="num">−${usd(r.expenses)}</td></tr>
        <tr><td class="bold">Profit</td><td class="num bold ${r.profit < 0 ? 'bad' : 'good'}">${usd(r.profit)}</td></tr>
      </table>
      <p class="tiny muted" style="margin:8px 0 0">Returned: ${r.returned.orders} order${r.returned.orders === 1 ? '' : 's'} (${usd(r.returned.amount)}) · Cancelled: ${r.cancelled.orders}</p>
    </div>

    <h2>By style</h2>
    <div class="card">${r.by_style.length ? `
      <table class="table"><tr><th></th><th>Style</th><th class="num">Pcs</th><th class="num">Sales</th><th class="num">Profit</th></tr>
      ${r.by_style.map((s) => `<tr><td style="width:46px">${photoTag(stylePhoto(s.style), 'sm')}</td><td>${esc(s.style)}</td><td class="num">${s.pieces}</td><td class="num">${usd0(s.sales)}</td><td class="num">${usd0(s.profit)}</td></tr>`).join('')}
      </table>` : '<div class="muted small">No sales this month.</div>'}
    </div>

    <div class="grid" style="margin-top:12px">
      <div class="card"><h3>Best sizes</h3>${r.by_size.length ? barsList(r.by_size, 'size', 'pieces', (v) => v + ' pcs') : '<div class="muted small">—</div>'}</div>
      <div class="card"><h3>Best colors</h3>${r.by_color.length ? barsList(r.by_color, 'color', 'pieces', (v) => v + ' pcs') : '<div class="muted small">—</div>'}</div>
    </div>
    <p class="tiny muted" style="margin:8px 4px 0">Use best sizes and colors to plan your next order from Turkey.</p>

    <div class="grid" style="margin-top:12px">
      <div class="card"><h3>How customers paid</h3>${r.by_payment.length ? barsList(r.by_payment.map((p) => ({ ...p, label: PAY[p.payment_method] || p.payment_method })), 'label', 'amount', usd0) : '<div class="muted small">—</div>'}</div>
      <div class="card"><h3>Expenses</h3>${r.expenses_by_category.length ? barsList(r.expenses_by_category, 'category', 'amount', usd0) : '<div class="muted small">No expenses.</div>'}</div>
    </div>

    <h2>Stock</h2>
    <div class="card">
      <div class="row between"><span>Pieces on hand</span><b class="num">${r.stock.pieces}</b></div>
      <div class="row between"><span>Worth at cost</span><b class="num">${usd(r.stock.value)}</b></div>
      ${slowStyles.length ? `<h3 style="margin-top:14px">Not selling lately</h3>
        <p class="small muted" style="margin:4px 0 0">No sales in the last 60 days: ${slowStyles.map((st) => `<b>${esc(st)}</b>`).join(', ')}. Maybe post them again or offer a deal.</p>` : ''}
    </div>

    <div class="actions no-print"><button class="primary" id="print">Print / save as PDF</button></div>`;

  $('#month').addEventListener('change', (e) => (location.hash = '#/report?m=' + (e.target.value || thisMonth())));
  $('#print').addEventListener('click', () => window.print());
}

// ---------- Assistant chat ----------

// Chat history lives in memory (and the browser tab), never on the server.
const chat = (() => {
  try {
    return JSON.parse(sessionStorage.getItem('chat') || '[]');
  } catch {
    return [];
  }
})();
const chatPhotos = new Map(); // message index -> photo File (photos are not kept after a refresh)
const saveChat = () => {
  try {
    sessionStorage.setItem('chat', JSON.stringify(chat.slice(-40)));
  } catch { /* storage may be blocked */ }
};

const SUGGESTIONS = [
  'How much profit did I make this month?',
  'Which sizes and colors sell best?',
  'Who still owes me money?',
  'What is sold out?',
];

function orderCard(m, i) {
  const o = m.order;
  const warn = o.items.filter((it) => it.qty > it.stock || (it.min_price_usd && it.unit_price_usd < it.min_price_usd));
  return `
    <div class="card chat-card">
      <div class="row between"><b>🛍️ New order</b><span class="pill ${o.status}">${STATUS[o.status]}</span></div>
      <div class="small muted" style="margin-top:4px">${esc(o.customer_name || 'No name')}${o.area ? ' · ' + esc(o.area) : ''}${o.phone ? ' · ' + esc(o.phone) : ''} · ${esc(PAY[o.payment_method])}</div>
      ${o.items.map((it) => `<div class="row" style="padding:6px 0">${photoTag(it, 'sm')}<div class="grow small"><b>${it.qty}×</b> ${esc([it.style, it.color, it.size].filter(Boolean).join(' · '))}</div><span class="num small">${usd(it.unit_price_usd)}</span></div>`).join('')}
      <div class="row between bold" style="border-top:1px solid var(--line);padding-top:8px;margin-top:4px"><span>Total</span><span class="num">${usd(o.total_usd)}</span></div>
      ${o.delivery_cost_usd ? `<div class="row between small muted"><span>Delivery fee you pay</span><span class="num">${usd(o.delivery_cost_usd)}</span></div>` : ''}
      ${warn.length ? `<div class="note">Check: ${warn.map((it) => esc(`${it.style} ${it.color} ${it.size}`) + (it.qty > it.stock ? ` (only ${it.stock} left)` : ' (below minimum price)')).join(', ')}</div>` : ''}
      ${m.saved ? `<div class="note info">Saved as order #${m.saved}. <a href="#/orders/${m.saved}">Open it</a>${waPhone(o.phone) ? ` · <a href="#" data-chat-wa="${i}">Send WhatsApp</a>` : ''}</div>` : `
      <div class="actions" style="margin-top:12px"><button class="primary small" data-chat-save="${i}">Confirm & save</button><button class="small" data-chat-edit="${i}">Edit first</button></div>`}
    </div>`;
}

function expenseCard(m, i) {
  const e = m.expense;
  return `
    <div class="card chat-card">
      <b>🧾 New expense</b>
      <div class="row between" style="margin-top:6px"><span>${esc(e.category)}${e.note ? ' · ' + esc(e.note) : ''}</span><b class="num">${e.currency === 'LBP' ? Math.round(e.amount).toLocaleString('en-US') + ' LBP' : usd(e.amount)}</b></div>
      ${e.date ? `<div class="small muted">${fmtDate(e.date)}</div>` : ''}
      ${!['USD', 'LBP'].includes(e.currency) ? `<div class="note">Amount looks like ${esc(e.currency)}. Use Edit first to change it to USD.</div>` : ''}
      ${m.saved ? '<div class="note info">Saved. <a href="#/expenses">See expenses</a></div>' : `
      <div class="actions" style="margin-top:12px"><button class="primary small" data-chat-save="${i}">Confirm & save</button><button class="small" data-chat-edit="${i}">Edit first</button></div>`}
    </div>`;
}

function shipmentCard(m, i) {
  const s = m.shipment;
  const styles = {};
  s.items.forEach((it) => (styles[it.style] = (styles[it.style] || 0) + it.qty));
  const pieces = s.items.reduce((a, it) => a + it.qty, 0);
  return `
    <div class="card chat-card">
      <b>📦 Shipment from photo</b>
      <div class="small muted" style="margin-top:4px">${s.items.length} lines · ${pieces} pieces${s.shipping ? ` · shipping ${usd(s.shipping)}` : ''}</div>
      ${Object.entries(styles).map(([st, n]) => `<div class="row between small" style="padding:3px 0"><span>${esc(st)}</span><span class="num">${n} pcs</span></div>`).join('')}
      <div class="actions" style="margin-top:12px"><button class="primary small" data-chat-edit="${i}">Review in shipment form</button></div>
    </div>`;
}

function chatHtml() {
  if (!chat.length) {
    return `
      <div class="empty" style="padding:24px 8px 8px"><span class="big">✨</span>Ask about your shop, or add an order by message.<br>
        <span class="small">Example: <i>“Rana, Jounieh, 71 123 456, 2 Smile teal M, cash on delivery”</i></span></div>
      <div class="chips" style="flex-wrap:wrap;justify-content:center">${SUGGESTIONS.map((s) => `<button data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  }
  return chat.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="bubble me">${m.photo ? '<div class="small" style="opacity:.85">📷 Photo</div>' : ''}${esc(m.text)}</div>`;
    }
    const card = m.action === 'create_order' ? orderCard(m, i) : m.action === 'create_expense' ? expenseCard(m, i) : m.action === 'shipment_draft' ? shipmentCard(m, i) : '';
    return `<div class="bubble ai ${m.error ? 'err' : ''}">${esc(m.text)}</div>${card}`;
  }).join('');
}

async function pageAssistant() {
  setTop('Assistant', chat.length ? '<button class="small" id="clearChat">New chat</button>' : '', '#/');
  if (!state.settings.ai_enabled) {
    view.innerHTML = '<div class="empty"><span class="big">✨</span>The assistant needs AI to be set up first.</div>';
    return;
  }
  await loadProducts();
  view.innerHTML = `
    <div id="chatLog" class="chat-log">${chatHtml()}</div>
    <form id="chatF" class="composer">
      <div id="chatPhoto" class="small" hidden></div>
      <div class="row">
        <button type="button" class="icon-btn" id="chatCam" aria-label="Add a photo">📷</button>
        <textarea id="chatMsg" rows="1" placeholder="Ask or add an order…"></textarea>
        <button class="primary icon-btn" id="chatSend" aria-label="Send">➤</button>
      </div>
      <div class="tiny muted center" style="margin-top:6px">AI can make mistakes. Check before you confirm.</div>
    </form>`;
  const log = $('#chatLog');
  const f = $('#chatF');
  const msg = $('#chatMsg');
  let photo = null;
  const scrollDown = () => window.scrollTo(0, document.body.scrollHeight);
  const redraw = () => {
    log.innerHTML = chatHtml();
    wireLog();
    scrollDown();
  };
  const setPhoto = (file) => {
    photo = file;
    $('#chatPhoto').hidden = !file;
    $('#chatPhoto').innerHTML = file ? `📷 Photo added <button type="button" class="link small" id="chatPhotoX">Remove</button>` : '';
    $('#chatPhotoX')?.addEventListener('click', () => setPhoto(null));
  };

  const send = async (text) => {
    text = text.trim();
    if (!text && !photo) return;
    const history = chat.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, text: m.text }));
    const userMsg = { role: 'user', text: text || 'Please read this photo.', photo: !!photo };
    chat.push(userMsg);
    const sentPhoto = photo;
    if (sentPhoto) chatPhotos.set(chat.length - 1, sentPhoto);
    msg.value = '';
    setPhoto(null);
    redraw();
    log.insertAdjacentHTML('beforeend', '<div class="bubble ai" id="typing"><span class="spinner"></span></div>');
    scrollDown();
    $('#chatSend').disabled = true;
    try {
      const fd = new FormData();
      fd.append('message', text);
      fd.append('history', JSON.stringify(history));
      if (sentPhoto) fd.append('file', await shrinkImage(sentPhoto), 'photo.jpg');
      const r = await api('assistant', { method: 'POST', form: fd });
      const m = { role: 'model', text: r.reply, action: r.action };
      if (r.order) m.order = r.order;
      if (r.expense) m.expense = r.expense;
      if (r.shipment) m.shipment = r.shipment;
      chat.push(m);
      if (sentPhoto && r.action !== 'none') chatPhotos.set(chat.length - 1, sentPhoto);
    } catch (err) {
      chat.push({ role: 'model', text: err.message, error: true });
    } finally {
      $('#chatSend').disabled = false;
    }
    saveChat();
    if (location.hash === '#/assistant') redraw();
  };

  function wireLog() {
    $$('[data-suggest]', log).forEach((b) => b.addEventListener('click', () => send(b.dataset.suggest)));
    $$('[data-chat-save]', log).forEach((b) => b.addEventListener('click', busy(b, async () => {
      const i = Number(b.dataset.chatSave);
      const m = chat[i];
      if (m.action === 'create_order') {
        const o = m.order;
        const saved = await api('orders', {
          method: 'POST',
          body: { ...o, date: today(), items: o.items.map((it) => ({ product_id: it.product_id, qty: it.qty, unit_price_usd: it.unit_price_usd })) },
        });
        m.saved = saved.id;
        toast('Order saved');
      } else if (m.action === 'create_expense') {
        const e = m.expense;
        const saved = await api('expenses', {
          method: 'POST',
          body: { date: e.date || today(), category: e.category, amount_usd: round2(toUsd(e.amount, e.currency === 'LBP' ? 'LBP' : 'USD')), note: e.note },
        });
        const p = chatPhotos.get(i);
        if (p) await uploadReceipts([p], { type: 'expense', id: saved.id });
        m.saved = saved.id;
        toast('Expense saved');
      }
      saveChat();
      redraw();
    })));
    $$('[data-chat-edit]', log).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.chatEdit);
      const m = chat[i];
      if (m.action === 'create_order') {
        window._draftOrder = { ...m.order };
        location.hash = '#/orders/new';
      } else if (m.action === 'create_expense') {
        window._draftExpense = { result: m.expense, photo: chatPhotos.get(i) };
        location.hash = '#/expenses/new';
      } else if (m.action === 'shipment_draft') {
        window._draftShipment = { result: m.shipment, photo: chatPhotos.get(i) };
        location.hash = '#/shipments/new';
      }
    }));
    $$('[data-chat-wa]', log).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const m = chat[Number(a.dataset.chatWa)];
      openWhatsApp({ ...m.order, total_usd: m.order.total_usd });
    }));
  }

  $('#chatCam').addEventListener('click', async () => setPhoto(await pickPhoto()));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    send(msg.value);
  });
  msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(msg.value);
    }
  });
  msg.addEventListener('input', () => {
    msg.style.height = 'auto';
    msg.style.height = Math.min(msg.scrollHeight, 140) + 'px';
  });
  $('#clearChat')?.addEventListener('click', () => {
    chat.length = 0;
    chatPhotos.clear();
    saveChat();
    pageAssistant();
  });
  wireLog();
  scrollDown();
}

// ---------- Settings ----------

async function pageSettings() {
  setTop('Settings', '', '#/more');
  const here = location.hash;
  const users = await api('users');
  if (leftPage(here)) return;
  const isOwner = state.user.role === 'owner';
  const st = state.settings;
  view.innerHTML = `
    <h2 style="margin-top:4px">Dollar rate</h2>
    <form id="rateF" class="card">
      <label for="rate" style="margin-top:0">1 USD = how many LBP?</label>
      <input id="rate" name="rate" type="number" inputmode="numeric" value="${rate()}">
      <div class="actions"><button class="primary" id="saveRate">Save rate</button></div>
    </form>

    <h2>WhatsApp message</h2>
    <form id="waF" class="card">
      <label for="wa" style="margin-top:0">Order confirmation text</label>
      <textarea id="wa" name="wa" rows="6">${esc(st.wa_confirm)}</textarea>
      <div class="hint">These words are replaced for each order: <b>{name}</b> <b>{items}</b> <b>{total}</b> <b>{area}</b></div>
      <div class="actions"><button class="primary" id="saveWa">Save message</button></div>
    </form>

    <h2>AI reading</h2>
    <div class="card small">${st.ai_enabled
      ? '<span class="pill paid">On</span> Scan receipts and notebook pages from <b>+ → New shipment</b> or <b>New expense</b>.'
      : '<span class="pill">Off</span> AI reading needs a free Gemini key. Ask the person who set up the app.'}</div>

    <h2>Who can get in</h2>
    <div class="card">
      ${users.map((u) => `
        <div class="row" style="padding:7px 0">
          <div class="grow">
            <div class="ellipsis"><strong>${esc(u.name || u.email)}</strong> ${u.role === 'owner' ? '<span class="pill">owner</span>' : ''} ${u.id === state.user.id ? '<span class="pill">you</span>' : ''}</div>
            <div class="small muted ellipsis">${esc(u.email)} · ${u.last_login ? 'last in ' + fmtDate(u.last_login.slice(0, 10)) : 'not signed in yet'}</div>
          </div>
          ${isOwner && u.role !== 'owner' ? `<button class="small danger" data-remove-user="${u.id}" data-email="${esc(u.email)}">Remove</button>` : ''}
        </div>`).join('')}
      ${isOwner ? `
      <form id="userF" style="margin-top:6px">
        <label for="ne">Google email to allow</label><input id="ne" name="email" type="email" autocapitalize="none" autocomplete="off" placeholder="name@gmail.com" required>
        <label for="nn">Name (optional)</label><input id="nn" name="name">
        <div class="actions"><button class="soft" id="addUser">Allow this person</button></div>
      </form>
      <p class="hint">Also add them as a <b>test user</b> in Google Cloud (Audience → Test users). Removing someone signs them out right away.</p>`
      : '<p class="small muted" style="margin-bottom:0">Only the owner can add or remove people.</p>'}
    </div>

    <h2>Backup (Excel)</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">Download your data now and then. CSV files open in Excel or Google Sheets.</p>
      <div class="actions" style="margin-top:8px">
        <a class="btn small" href="/api/export/orders">Orders</a>
        <a class="btn small" href="/api/export/stock">Stock</a>
        <a class="btn small" href="/api/export/shipments">Shipments</a>
        <a class="btn small" href="/api/export/expenses">Expenses</a>
      </div>
    </div>

    <h2>Install on your phone</h2>
    <div class="card small">${isInstalled() ? '✅ Installed. You are using the app.' : `${installBtn('primary block')}<p class="tiny muted" style="margin:8px 0 0">Adds She Sleepwear to your home screen.</p>`}</div>

    <div class="actions"><button class="danger" id="logout">Log out</button></div>`;

  const saveSettings = async (body) => {
    state.settings = await api('settings', { method: 'PUT', body });
  };
  const rf = $('#rateF');
  rf.addEventListener('submit', busy($('#saveRate'), async () => {
    await saveSettings({ lbp_rate: Number(rf.rate.value) });
    toast('Rate saved');
  }));
  const wf = $('#waF');
  wf.addEventListener('submit', busy($('#saveWa'), async () => {
    await saveSettings({ wa_confirm: wf.wa.value });
    toast('Message saved');
  }));
  if (isOwner) {
    const uf = $('#userF');
    uf.addEventListener('submit', busy($('#addUser'), async () => {
      await api('users', { method: 'POST', body: { email: uf.email.value, name: uf.name.value } });
      toast('Person allowed');
      refresh('#/settings', pageSettings);
    }));
    $$('[data-remove-user]').forEach((b) => b.addEventListener('click', busy(b, async () => {
      if (!confirm(`Remove ${b.dataset.email}? They will be signed out and can't get in anymore.`)) return;
      await api('users/' + b.dataset.removeUser, { method: 'DELETE' });
      toast('Removed');
      refresh('#/settings', pageSettings);
    })));
  }
  $('#logout').addEventListener('click', busy($('#logout'), async () => {
    await api('logout', { method: 'POST' });
    window.google?.accounts?.id?.disableAutoSelect();
    state.user = null;
    location.hash = '#/login';
  }));
}

// ---------- Start ----------

async function boot() {
  const me = await api('me');
  state.user = me.user;
  if (state.user) state.settings = await api('settings');
}

$('#plusBtn').addEventListener('click', openAddSheet);
window.addEventListener('hashchange', router);
boot().then(router).catch(() => {
  view.innerHTML = '<div class="empty">Could not connect. Check your internet and refresh.</div>';
});
