/* ============================================================
   AD's Cellar — Loopia build. All persistence via the PHP API
   at /api/api.php (MariaDB). Photos stay on-device (IndexedDB).
   ============================================================ */

'use strict';

/* ---------------- configuration ---------------- */
/// Paste your API token from api/config.php between the quotes:
const API_TOKEN = 'REPLACE_TOKEN';
const API_URL = '/api/api.php';

/* ---------------- api client ---------------- */
async function api(resource, { method = 'GET', id = null, data = null } = {}) {
  const qs = new URLSearchParams({ r: resource });
  if (id != null) qs.set('id', String(id));
  let res;
  try {
    res = await fetch(`${API_URL}?${qs}`, {
      method,
      headers: {
        'X-Api-Token': API_TOKEN,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch (e) {
    throw new ApiError('No connection to the cellar server', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || `Server error (HTTP ${res.status})`, res.status);
  return json;
}

class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

/* Friendly error toast for any failed write */
function apiFail(e, fallback) {
  console.warn('api error', e);
  if (e instanceof ApiError && e.status === 409) {
    toast('🚫 That slot is already occupied');
  } else if (e instanceof ApiError && e.status === 401) {
    toast('🔑 API token rejected — check the token in index.html');
  } else if (e instanceof ApiError && e.status === 0) {
    toast('📡 Offline — change not saved');
  } else {
    toast((fallback || 'Could not save') + ': ' + (e.message || e));
  }
}

/* ---------------- local photo store (device-only) ---------------- */
const db = (() => {
  let _db = null;
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('cellar-photos', 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'wineId' });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }
  return {
    put: (v) => open().then(d => new Promise((res, rej) => {
      const t = d.transaction('photos', 'readwrite');
      t.objectStore('photos').put(v);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    })),
    del: (k) => open().then(d => new Promise((res, rej) => {
      const t = d.transaction('photos', 'readwrite');
      t.objectStore('photos').delete(k);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    })),
    get: (k) => open().then(d => new Promise((res, rej) => {
      const r = d.transaction('photos').objectStore('photos').get(k);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })),
    all: () => open().then(d => new Promise((res, rej) => {
      const r = d.transaction('photos').objectStore('photos').getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    })),
  };
})();

/* ---------------- state ---------------- */
let wines = [];       // view models (mapped from server rows)
let racks = [];       // server rows
let placements = [];  // server rows
let drinkLog = [];    // server rows
let photoURLs = {};   // wineId -> objectURL
let pendingPhoto = null;
let readOnly = false; // true when booted from cache without server
let placingWineId = null;

let filterStyle = '';
let filterRack = '';  // '' all | 'loose' | rack id as string
let searchTerm = '';
let sortMode = 'added';

const $ = (id) => document.getElementById(id);

const STYLE_LABELS = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', sweet: 'Sweet', fortified: 'Fortified' };
const STYLE_ICONS = { red: '🍷', white: '🥂', rose: '🌸', sparkling: '🍾', sweet: '🍯', fortified: '🥃' };
const KIND_ICONS = { rack: '🗄', fridge: '🧊', case: '📦', shelf: '📚' };
const SIZE_LABELS = { 187: 'Piccolo (187 ml)', 375: 'Demi-bouteille (375 ml)', 750: 'Standard (750 ml)', 1500: 'Magnum (1.5 L)', 3000: 'Double Magnum (3 L)', 4500: 'Jéroboam (4.5 L)', 6000: 'Impériale (6 L)' };
const SIZE_SHORT = { 187: 'Piccolo', 375: 'Demi', 1500: 'Magnum', 3000: 'Dbl Magnum', 4500: 'Jéroboam', 6000: 'Impériale' };

/* ---------------- field mapping: server row <-> view model ----------------
   Columns per schema.sql; everything the schema lacks travels in `notes`
   as a JSON envelope {"__cellar":1, ...}. Plain-text notes (e.g. edited in
   phpMyAdmin) are still displayed as the user's note. */
function fromRow(row) {
  let x = {};
  let plainNotes = '';
  if (row.notes) {
    try {
      const j = JSON.parse(row.notes);
      if (j && j.__cellar) x = j; else plainNotes = row.notes;
    } catch { plainNotes = row.notes; }
  }
  const num = (v) => (v == null || v === '' ? null : +v);
  return {
    id: +row.id,
    producer: row.producer === '—' ? '' : (row.producer || ''),
    name: row.cuvee || row.producer || '(unnamed)',
    vintage: num(row.vintage),
    style: STYLE_LABELS[row.wine_type] ? row.wine_type : 'red',
    grapes: row.grape ? row.grape.split(',').map(s => s.trim()).filter(Boolean) : [],
    region: row.region || '',
    bottleMl: num(row.bottle_ml) || 750,
    quantity: num(row.quantity) || 0,
    purchasePrice: num(row.price_paid),          // CHF excl. VAT (as entered)
    drinkFrom: num(row.drink_from),
    drinkTo: num(row.drink_to),
    createdAt: row.created_at || '',
    // extras (JSON envelope, with column fallbacks)
    country: x.country || '',
    appellation: x.appellation || '',
    abv: x.abv ?? null,
    purchaseDate: x.purchaseDate || null,
    marketPrice: x.marketPrice ?? num(row.current_value),
    marketCurrency: x.marketCurrency || 'CHF',
    ratingVivino: x.ratingVivino ?? num(row.rating),
    ratingCritic: x.ratingCritic ?? null,
    edulisTitle: x.edulisTitle || '',
    edulisBody: x.edulisBody || '',
    edulisDate: x.edulisDate || null,
    notes: x.userNotes ?? plainNotes,
  };
}

function toRow(w) {
  return {
    producer: w.producer || w.name || '—',   // column is NOT NULL
    cuvee: w.name || null,
    vintage: w.vintage,
    wine_type: w.style,
    grape: w.grapes.length ? w.grapes.join(', ') : null,
    region: w.region || null,
    bottle_ml: w.bottleMl || 750,
    quantity: w.quantity,
    price_paid: w.purchasePrice,
    current_value: marketCHF(w) != null ? +marketCHF(w).toFixed(2) : null,
    drink_from: w.drinkFrom,
    drink_to: w.drinkTo,
    rating: w.ratingVivino != null ? Math.min(5, Math.max(1, Math.round(w.ratingVivino))) : null,
    notes: JSON.stringify({
      __cellar: 1,
      country: w.country || undefined,
      appellation: w.appellation || undefined,
      abv: w.abv ?? undefined,
      purchaseDate: w.purchaseDate || undefined,
      marketPrice: w.marketPrice ?? undefined,
      marketCurrency: w.marketCurrency || undefined,
      ratingVivino: w.ratingVivino ?? undefined,
      ratingCritic: w.ratingCritic ?? undefined,
      edulisTitle: w.edulisTitle || undefined,
      edulisBody: w.edulisBody || undefined,
      edulisDate: w.edulisDate || undefined,
      userNotes: w.notes || undefined,
    }),
  };
}

/* ---------------- pricing: VAT & FX ---------------- */
const VAT_RATE = 0.081;
const FX_KEY = 'fx-eur-chf';
const FX_FALLBACK = 0.94;

function fxRate() {
  try {
    const c = JSON.parse(localStorage.getItem(FX_KEY) || 'null');
    if (c && c.rate > 0) return c.rate;
  } catch { /* ignore */ }
  return FX_FALLBACK;
}

async function refreshFx() {
  try {
    const c = JSON.parse(localStorage.getItem(FX_KEY) || 'null');
    if (c && Date.now() - c.ts < 24 * 3600_000) return;
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CHF');
    const j = await r.json();
    if (j?.rates?.CHF > 0) {
      localStorage.setItem(FX_KEY, JSON.stringify({ rate: j.rates.CHF, ts: Date.now() }));
      renderAll();
    }
  } catch { /* offline — keep fallback */ }
}

function marketCHF(w) {
  if (w.marketPrice == null) return null;
  return w.marketCurrency === 'EUR' ? w.marketPrice * fxRate() : w.marketPrice;
}

function purchaseGross(w) {
  return w.purchasePrice != null ? w.purchasePrice * (1 + VAT_RATE) : null;
}

/* ---------------- helpers ---------------- */
function money(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString('en') : abs.toFixed(abs % 1 ? 2 : 0);
  return (n < 0 ? '−' : '') + 'CHF ' + s;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cellarWines() { return wines.filter(w => w.quantity > 0); }

function windowStatus(w) {
  const year = new Date().getFullYear();
  if (!w.drinkFrom && !w.drinkTo) return null;
  const range = `${w.drinkFrom || '…'}–${w.drinkTo || '…'}`;
  if (w.drinkFrom && year < w.drinkFrom) return { cls: 'hold', label: `⏳ Hold · ${range}` };
  if (w.drinkTo && year > w.drinkTo) return { cls: 'past', label: `⚠️ Past peak (${range})` };
  if (w.drinkTo && year >= w.drinkTo - 1) return { cls: 'soon', label: `🔥 Drink now · until ${w.drinkTo}` };
  return { cls: 'ready', label: `✓ Drink ${range}` };
}

function monthYear(d) {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt) ? null : dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function guardWrite() {
  if (API_TOKEN === 'REPLACE_TOKEN') { toast('🔑 Set the API token in index.html first'); return false; }
  if (readOnly) { toast('📡 Offline — reconnect to make changes'); return false; }
  return true;
}

/* placements helpers */
const placementsFor = (wineId) => placements.filter(p => +p.wine_id === +wineId);
const looseCount = (w) => Math.max(0, w.quantity - placementsFor(w.id).length);
const rackById = (id) => racks.find(r => +r.id === +id);
const slotOccupant = (rackId, row, col) =>
  placements.find(p => +p.rack_id === +rackId && +p.row_idx === row && +p.col_idx === col);
function slotLabel(p) {
  const r = rackById(p.rack_id);
  return `${r ? r.name : 'rack'} · R${+p.row_idx + 1}C${+p.col_idx + 1}`;
}

/* ---------------- boot ---------------- */
const CACHE_KEY = 'cellar-state-cache';

async function loadAll({ silent = false } = {}) {
  try {
    const data = await api('all');
    applyState(data);
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    readOnly = false;
    $('netBanner').classList.add('hidden');
    updateServerStatus(true);
    return true;
  } catch (e) {
    console.warn('loadAll failed', e);
    updateServerStatus(false, e);
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && !wines.length) {
      applyState(JSON.parse(cached));
      readOnly = true;
      const b = $('netBanner');
      b.textContent = '📡 Can’t reach the cellar server — showing the last saved copy (read-only). Pull down to retry.';
      b.classList.remove('hidden');
    } else if (!silent) {
      const b = $('netBanner');
      b.textContent = (e.status === 401)
        ? '🔑 API token rejected — edit API_TOKEN in index.html.'
        : '📡 Can’t reach the cellar server. Pull down to retry.';
      b.classList.remove('hidden');
    }
    return false;
  }
}

function applyState(data) {
  wines = (data.wines || []).map(fromRow);
  racks = data.racks || [];
  placements = data.placements || [];
  drinkLog = data.drink_log || [];
  renderAll();
}

async function boot() {
  // load local photos
  const photos = await db.all().catch(() => []);
  for (const p of photos) photoURLs[p.wineId] = URL.createObjectURL(p.blob);

  if (API_TOKEN === 'REPLACE_TOKEN') {
    const b = $('netBanner');
    b.textContent = '🔧 Setup: open index.html and replace REPLACE_TOKEN with your API token, then re-upload.';
    b.classList.remove('hidden');
    updateServerStatus(false, new ApiError('Token not configured', 401));
  }
  await loadAll({ silent: true });
  renderAll();
}

function updateServerStatus(ok, e) {
  const el = $('serverStatus');
  if (!el) return;
  if (ok) {
    el.textContent = `✅ Connected to wine.ad85.com · ${wines.length} wines, ${racks.length} racks, ${drinkLog.length} history entries`;
  } else if (API_TOKEN === 'REPLACE_TOKEN') {
    el.textContent = '🔧 Not configured — replace REPLACE_TOKEN in index.html with your API token.';
  } else if (e && e.status === 401) {
    el.textContent = '🔑 Token rejected by the server — check it matches api/config.php.';
  } else {
    el.textContent = '📡 Server unreachable — check your connection, then pull down to retry.';
  }
}

/* ---------------- render: everything ---------------- */
function renderAll() {
  renderDashboard();
  renderRackChips();
  renderList();
  renderRacks();
  renderHistory();
}

function renderDashboard() {
  const cw = cellarWines();
  const bottles = cw.reduce((n, w) => n + w.quantity, 0);
  const value = cw.reduce((n, w) => n + (marketCHF(w) ?? purchaseGross(w) ?? 0) * w.quantity, 0);
  const cost = cw.reduce((n, w) => n + (purchaseGross(w) ?? 0) * w.quantity, 0);

  $('statBottles').textContent = bottles;
  $('statValue').textContent = money(value);
  $('statCost').textContent = money(cost);

  const gainEl = $('statGain');
  if (cost > 0) {
    const diff = value - cost;
    const pct = (diff / cost) * 100;
    gainEl.textContent = (diff >= 0 ? '+' : '') + money(diff).replace('−', '-') + ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`;
    gainEl.className = 'stat-value ' + (diff >= 0 ? 'pos' : 'neg');
  } else {
    gainEl.textContent = '—';
    gainEl.className = 'stat-value';
  }
}

/* ---------------- cellar list ---------------- */
function renderRackChips() {
  const el = $('filterRacks');
  const chips = [
    `<button class="chip ${filterRack === '' ? 'active' : ''}" data-rack="">Everywhere</button>`,
    `<button class="chip ${filterRack === 'loose' ? 'active' : ''}" data-rack="loose">🍾 Unplaced</button>`,
    ...racks.map(r =>
      `<button class="chip ${filterRack === String(r.id) ? 'active' : ''}" data-rack="${r.id}">${KIND_ICONS[r.kind] || '🗄'} ${esc(r.name)}</button>`),
  ];
  el.innerHTML = chips.join('');
}

function renderList() {
  let list = cellarWines();

  if (filterStyle) list = list.filter(w => w.style === filterStyle);
  if (filterRack === 'loose') list = list.filter(w => looseCount(w) > 0);
  else if (filterRack) list = list.filter(w => placementsFor(w.id).some(p => String(p.rack_id) === filterRack));
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(w =>
      [w.name, w.producer, w.region, w.country, w.appellation, w.grapes.join(' '),
       String(w.vintage || ''), STYLE_LABELS[w.style], SIZE_SHORT[w.bottleMl], SIZE_LABELS[w.bottleMl],
       w.edulisTitle, w.edulisBody, w.notes]
        .join(' ').toLowerCase().includes(q));
  }

  list.sort((a, b) => {
    switch (sortMode) {
      case 'name': return (a.name || '').localeCompare(b.name || '');
      case 'vintage': return (a.vintage || 9999) - (b.vintage || 9999);
      case 'value': return ((marketCHF(b) || 0) * b.quantity) - ((marketCHF(a) || 0) * a.quantity);
      case 'window': return (a.drinkTo || 9999) - (b.drinkTo || 9999);
      default: return (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id;
    }
  });

  const el = $('wineList');
  el.innerHTML = list.map(wineCard).join('');
  $('emptyState').classList.toggle('hidden', cellarWines().length > 0);

  el.querySelectorAll('.wine-card').forEach(card =>
    card.addEventListener('click', () => openDetail(+card.dataset.id)));
}

function wineCard(w) {
  const ws = windowStatus(w);
  const photo = photoURLs[w.id];
  const thumb = photo
    ? `<img class="wine-thumb" src="${photo}" alt="">`
    : `<div class="wine-thumb">${STYLE_ICONS[w.style] || '🍷'}</div>`;

  const pls = placementsFor(w.id);
  const loose = looseCount(w);
  const badges = [];
  if (w.vintage) badges.push(`<span class="badge">${w.vintage}</span>`);
  if (w.bottleMl !== 750) badges.push(`<span class="badge gold">${SIZE_SHORT[w.bottleMl] || w.bottleMl + ' ml'}</span>`);
  if (w.region) badges.push(`<span class="badge">${esc(w.region)}</span>`);
  if (w.ratingVivino) badges.push(`<span class="badge gold">★ ${w.ratingVivino}</span>`);
  if (w.ratingCritic) badges.push(`<span class="badge gold">${w.ratingCritic} pts</span>`);
  if (ws) badges.push(`<span class="badge ${ws.cls}">${ws.label}</span>`);
  if (pls.length) badges.push(`<span class="badge">📍 ${pls.length} placed${loose ? ` · ${loose} loose` : ''}</span>`);

  return `
  <article class="wine-card" data-id="${w.id}">
    ${thumb}
    <div class="wine-body">
      <div class="wine-name">${esc(w.name)}</div>
      <div class="wine-sub">${esc([w.producer, w.appellation || w.region, w.country].filter(Boolean).join(' · '))}</div>
      <div class="wine-badges">${badges.join('')}</div>
    </div>
    <div class="wine-right">
      <div class="wine-price">${money(marketCHF(w))}</div>
      <div class="wine-qty">× ${w.quantity}</div>
    </div>
  </article>`;
}

/* ---------------- racks view ---------------- */
function renderRacks() {
  const el = $('racksList');
  if (!racks.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🗄</div>
      <p><strong>No racks yet.</strong></p>
      <p>Create your racks, fridges and cases below, then place each bottle in its exact slot.</p></div>`;
    return;
  }

  el.innerHTML = racks.map(r => {
    const rows = +r.grid_rows, cols = +r.grid_cols;
    const used = placements.filter(p => +p.rack_id === +r.id).length;
    let cells = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const occ = slotOccupant(r.id, row, col);
        if (occ) {
          const w = wines.find(x => x.id === +occ.wine_id);
          const initials = w ? esc((w.name || '?').split(/\s+/).map(s => s[0]).join('').slice(0, 3).toUpperCase()) : '?';
          cells += `<button class="slot occupied st-${w ? w.style : 'red'}" data-p="${occ.id}" title="${w ? esc(w.name) : ''}">${initials}</button>`;
        } else {
          cells += `<button class="slot ${placingWineId ? 'placing-target' : ''}" data-rack="${r.id}" data-row="${row}" data-col="${col}"></button>`;
        }
      }
    }
    return `<div class="rack-card">
      <div class="rack-head">
        <span>${KIND_ICONS[r.kind] || '🗄'}</span>
        <span class="rack-name">${esc(r.name)}</span>
        <span class="rack-count">${used}/${rows * cols}</span>
        <span class="rack-actions">
          <button class="icon-btn" data-editrack="${r.id}" title="Edit">✎</button>
          <button class="icon-btn" data-delrack="${r.id}" title="Delete">🗑</button>
        </span>
      </div>
      <div class="rack-grid-wrap">
        <div class="rack-grid" style="grid-template-columns: repeat(${cols}, 38px);">${cells}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.slot:not(.occupied)').forEach(s =>
    s.addEventListener('click', () => onEmptySlot(+s.dataset.rack, +s.dataset.row, +s.dataset.col)));
  el.querySelectorAll('.slot.occupied').forEach(s =>
    s.addEventListener('click', () => openSlotSheet(+s.dataset.p)));
  el.querySelectorAll('[data-editrack]').forEach(b =>
    b.addEventListener('click', () => openRackForm(+b.dataset.editrack)));
  el.querySelectorAll('[data-delrack]').forEach(b =>
    b.addEventListener('click', () => deleteRack(+b.dataset.delrack)));
}

async function onEmptySlot(rackId, row, col) {
  if (!guardWrite()) return;
  if (placingWineId) {
    await placeBottle(placingWineId, rackId, row, col);
    const w = wines.find(x => x.id === placingWineId);
    if (!w || looseCount(w) === 0) stopPlacing();
    else $('placingText').textContent = `Placing ${w.name} — ${looseCount(w)} loose left. Tap the next slot or Cancel.`;
    return;
  }
  openPickSheet(rackId, row, col);
}

async function placeBottle(wineId, rackId, row, col) {
  try {
    const { id } = await api('placements', { method: 'POST', data: { rack_id: rackId, row_idx: row, col_idx: col, wine_id: wineId } });
    placements.push({ id, rack_id: rackId, row_idx: row, col_idx: col, wine_id: wineId });
    renderAll();
    const r = rackById(rackId);
    toast(`📍 Placed in ${r ? r.name : 'rack'} · R${row + 1}C${col + 1}`);
  } catch (e) { apiFail(e, 'Could not place bottle'); }
}

function startPlacing(wineId) {
  placingWineId = wineId;
  const w = wines.find(x => x.id === wineId);
  switchView('racks');
  $('placingBanner').classList.remove('hidden');
  $('placingText').textContent = `Placing ${w ? w.name : 'bottle'} — tap an empty slot.`;
  renderRacks();
}

function stopPlacing() {
  placingWineId = null;
  $('placingBanner').classList.add('hidden');
  renderRacks();
}

function openPickSheet(rackId, row, col) {
  const candidates = cellarWines().filter(w => looseCount(w) > 0);
  const r = rackById(rackId);
  const st = { red: '#8e2a3f', white: '#b99b3e', rose: '#d06e83', sparkling: '#7d8f5a', sweet: '#a8702a', fortified: '#6b4a2b' };
  $('slotContent').innerHTML = `
    <div class="slot-title">Place a bottle</div>
    <div class="slot-sub">${esc(r ? r.name : '')} · row ${row + 1}, column ${col + 1}</div>
    ${candidates.length ? candidates.map(w => `
      <button class="pick-row" data-w="${w.id}">
        <span class="pick-dot" style="background:${st[w.style] || '#888'}"></span>
        <span class="pick-main">
          <span class="pick-name">${esc(w.name)}</span>
          <span class="pick-sub">${esc([w.vintage, w.region].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="pick-loose">${looseCount(w)} loose</span>
      </button>`).join('')
      : '<p class="settings-note">No unplaced bottles — every bottle already has a slot (or the cellar is empty).</p>'}
  `;
  openSheet('slot');
  $('slotContent').querySelectorAll('.pick-row').forEach(b =>
    b.addEventListener('click', async () => {
      closeSheet('slot');
      await placeBottle(+b.dataset.w, rackId, row, col);
    }));
}

function openSlotSheet(placementId) {
  const p = placements.find(x => +x.id === +placementId);
  if (!p) return;
  const w = wines.find(x => x.id === +p.wine_id);
  $('slotContent').innerHTML = `
    <div class="slot-title">${esc(w ? w.name : 'Unknown wine')}</div>
    <div class="slot-sub">${esc(slotLabel(p))}${w && w.vintage ? ` · ${w.vintage}` : ''}</div>
    <div class="detail-actions">
      ${w ? `<button class="btn primary" id="slotOpenWine">Open wine page</button>` : ''}
      <button class="btn danger" id="slotRemove">Remove from this slot</button>
    </div>`;
  openSheet('slot');
  $('slotOpenWine')?.addEventListener('click', () => { closeSheet('slot'); openDetail(w.id); });
  $('slotRemove').addEventListener('click', async () => {
    if (!guardWrite()) return;
    try {
      await api('placements', { method: 'DELETE', id: p.id });
      placements = placements.filter(x => +x.id !== +p.id);
      closeSheet('slot');
      renderAll();
      toast('Removed from slot');
    } catch (e) { apiFail(e, 'Could not remove'); }
  });
}

/* rack form */
function openRackForm(id) {
  const r = id ? rackById(id) : null;
  $('rackFormTitle').textContent = r ? 'Edit rack' : 'Add rack';
  $('r-id').value = r ? r.id : '';
  $('r-name').value = r ? r.name : '';
  $('r-kind').value = r ? r.kind : 'rack';
  $('r-rows').value = r ? r.grid_rows : 6;
  $('r-cols').value = r ? r.grid_cols : 8;
  openSheet('rackForm');
}

async function saveRackForm(e) {
  e.preventDefault();
  if (!guardWrite()) return;
  const id = $('r-id').value ? +$('r-id').value : null;
  const data = {
    name: $('r-name').value.trim(),
    kind: $('r-kind').value,
    grid_rows: Math.max(1, Math.min(20, +$('r-rows').value || 6)),
    grid_cols: Math.max(1, Math.min(20, +$('r-cols').value || 8)),
    position: id ? (rackById(id)?.position ?? 0) : racks.length,
  };
  if (!data.name) return;
  try {
    if (id) {
      // shrinking a rack could strand placements outside the grid — block that
      const outside = placements.filter(p => +p.rack_id === id &&
        (+p.row_idx >= data.grid_rows || +p.col_idx >= data.grid_cols));
      if (outside.length) { toast(`🚫 ${outside.length} bottle(s) sit outside the new size — move them first`); return; }
      await api('racks', { method: 'PUT', id, data });
      Object.assign(rackById(id), data);
    } else {
      const { id: newId } = await api('racks', { method: 'POST', data });
      racks.push({ id: newId, ...data });
    }
    closeSheet('rackForm');
    renderAll();
    toast('Rack saved');
  } catch (e2) { apiFail(e2, 'Could not save rack'); }
}

async function deleteRack(id) {
  const r = rackById(id);
  const used = placements.filter(p => +p.rack_id === id).length;
  if (!confirm(`Delete "${r.name}"${used ? ` and free its ${used} placed bottle(s)` : ''}? The wines themselves are kept.`)) return;
  if (!guardWrite()) return;
  try {
    await api('racks', { method: 'DELETE', id });
    racks = racks.filter(x => +x.id !== id);
    placements = placements.filter(p => +p.rack_id !== id);
    renderAll();
    toast('Rack deleted');
  } catch (e) { apiFail(e, 'Could not delete rack'); }
}

/* ---------------- history ---------------- */
function renderHistory() {
  const el = $('historyList');
  el.innerHTML = drinkLog.map(d => {
    const w = wines.find(x => x.id === +d.wine_id);
    const photo = w && photoURLs[w.id];
    const thumb = photo
      ? `<img class="wine-thumb" src="${photo}" alt="">`
      : `<div class="wine-thumb">${w ? (STYLE_ICONS[w.style] || '🥂') : '🥂'}</div>`;
    return `
    <article class="wine-card" data-id="${w ? w.id : ''}">
      ${thumb}
      <div class="wine-body">
        <div class="wine-name">${esc(d.label || (w && w.name) || 'Unknown wine')}</div>
        <div class="wine-sub">${esc(w ? [w.vintage, w.region].filter(Boolean).join(' · ') : '')}</div>
        <div class="wine-badges">
          <span class="badge">🗓 ${d.drunk_on || '—'}</span>
          ${d.rating ? `<span class="badge gold">★ ${d.rating}</span>` : ''}
        </div>
        ${d.notes ? `<div class="history-note">“${esc(d.notes)}”</div>` : ''}
      </div>
      <button class="icon-btn log-del" data-log="${d.id}" title="Remove entry">🗑</button>
    </article>`;
  }).join('');

  $('historyEmpty').classList.toggle('hidden', drinkLog.length > 0);
  $('historyStats').textContent = drinkLog.length
    ? `${drinkLog.length} bottle${drinkLog.length === 1 ? '' : 's'} enjoyed`
    : '';

  el.querySelectorAll('.wine-card').forEach(card => {
    if (card.dataset.id) card.addEventListener('click', () => openDetail(+card.dataset.id));
  });
  el.querySelectorAll('.log-del').forEach(b =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this history entry?')) return;
      if (!guardWrite()) return;
      try {
        await api('drink_log', { method: 'DELETE', id: +b.dataset.log });
        drinkLog = drinkLog.filter(d => +d.id !== +b.dataset.log);
        renderHistory();
      } catch (err) { apiFail(err, 'Could not remove'); }
    }));
}

/* ---------------- detail sheet ---------------- */
function openDetail(id) {
  const w = wines.find(x => x.id === id);
  if (!w) return;

  const ws = windowStatus(w);
  const photo = photoURLs[w.id];
  const pairings = getPairings(w);
  const inCellar = w.quantity > 0;
  const mkt = marketCHF(w);
  const gross = purchaseGross(w);
  const gain = (mkt != null && gross != null) ? mkt - gross : null;
  const q = encodeURIComponent([w.name, w.vintage].filter(Boolean).join(' '));
  const pls = placementsFor(w.id);
  const loose = looseCount(w);

  const infoCells = [
    w.vintage && cell('Vintage', w.vintage),
    w.style && cell('Style', STYLE_LABELS[w.style]),
    (w.region || w.country) && cell('Region', [w.appellation || w.region, w.country].filter(Boolean).join(', ')),
    w.grapes.length && cell('Grapes', w.grapes.join(', ')),
    w.abv && cell('ABV', w.abv + '%'),
    cell('Bottle size', SIZE_LABELS[w.bottleMl] || (w.bottleMl + ' ml')),
    (w.drinkFrom || w.drinkTo) && cell('Drinking window', `${w.drinkFrom || '…'} – ${w.drinkTo || '…'}`),
    w.ratingVivino && cell('Vivino users', '★ ' + w.ratingVivino + ' / 5'),
    w.ratingCritic && cell('Wine-Searcher critics', w.ratingCritic + ' / 100'),
    mkt != null && cell('Market price', money(mkt) + (w.marketCurrency === 'EUR' ? ` (€${w.marketPrice})` : ''), 'gold'),
    gross != null && cell('Purchase incl. 8.1% VAT', money(gross)),
    w.purchasePrice != null && cell('Purchase excl. VAT (as paid)', money(w.purchasePrice)),
    gain != null && cell('Gain per bottle', (gain >= 0 ? '+' : '') + money(gain).replace('−', '-'), gain >= 0 ? 'pos' : 'neg'),
    w.purchaseDate && cell('Purchased', w.purchaseDate),
    inCellar && cell('Bottles', `× ${w.quantity}${pls.length ? ` (${pls.length} placed, ${loose} loose)` : ''}`),
  ].filter(Boolean).join('');

  const wineDrinks = drinkLog.filter(d => +d.wine_id === w.id);

  $('detailContent').innerHTML = `
    ${photo ? `<img class="detail-photo" src="${photo}" alt="Label">` : ''}
    <button type="button" class="mini-btn detail-photo-btn" id="detailPhotoBtn">📷 ${photo ? 'Replace' : 'Add'} label photo</button>
    <div class="detail-name">${esc(w.name)}</div>
    <div class="detail-sub">${esc([w.producer, w.vintage].filter(Boolean).join(' · '))}</div>
    <div class="detail-badges">
      ${ws ? `<span class="badge ${ws.cls}">${ws.label}</span>` : ''}
      ${!inCellar ? '<span class="badge past">Finished</span>' : ''}
    </div>

    ${pls.length ? `<div class="detail-section"><h3>Placed</h3>
      <div class="pairing-list">${pls.map(p => `<span class="pairing-item">📍 ${esc(slotLabel(p))}</span>`).join('')}</div></div>` : ''}

    <div class="detail-section"><h3>Details</h3><div class="info-grid">${infoCells}</div></div>

    ${(w.edulisTitle || w.edulisBody) ? `<div class="detail-section"><h3>Edulis notes</h3>
      <button type="button" class="note-toggle" id="edulisToggle">
        <span class="note-titles">
          <span class="note-title">${esc(w.edulisTitle || 'Note from Edulis')}</span>
          ${monthYear(w.purchaseDate || w.edulisDate) ? `<span class="note-when">Purchased ${monthYear(w.purchaseDate || w.edulisDate)}</span>` : ''}
        </span>
        <span class="note-chevron">▾</span>
      </button>
      <div class="note-block note-full hidden" id="edulisFull">${esc(w.edulisBody || '')}</div>
    </div>` : ''}
    ${w.notes ? `<div class="detail-section"><h3>My notes</h3><div class="note-block">${esc(w.notes)}</div></div>` : ''}

    ${pairings.length ? `<div class="detail-section"><h3>Pairs well with</h3>
      <div class="pairing-list">${pairings.map(p => `<span class="pairing-item">${esc(p)}</span>`).join('')}</div></div>` : ''}

    ${wineDrinks.length ? `<div class="detail-section"><h3>Tasting history</h3>
      ${wineDrinks.map(d => `<div class="note-block" style="margin-bottom:8px">🗓 ${d.drunk_on || '—'}${d.rating ? ` · ★ ${d.rating}` : ''}${d.notes ? `<br>“${esc(d.notes)}”` : ''}</div>`).join('')}</div>` : ''}

    <div class="detail-actions">
      ${inCellar ? `<button class="btn primary" id="drinkBtn">🥂 Drink a bottle</button>` : ''}
      ${inCellar && loose > 0 && racks.length ? `<button class="btn ghost" id="placeBtn">📍 Place a bottle in a rack</button>` : ''}
      <div class="detail-actions-row">
        <button class="btn ghost" id="editBtn">✏️ Edit</button>
        <button class="btn danger" id="deleteBtn">Delete</button>
      </div>
    </div>

    <div class="detail-section lookup-bottom">
      <div class="pairing-list">
        <a class="pairing-item" href="https://www.wine-searcher.com/find/${q}" target="_blank" rel="noopener">🔎 Wine-Searcher</a>
        <a class="pairing-item" href="https://www.vivino.com/search/wines?q=${q}" target="_blank" rel="noopener">🍇 Vivino</a>
      </div>
    </div>
  `;

  openSheet('detail');

  $('detailPhotoBtn').addEventListener('click', () => $('detailPhotoInput').click());
  $('detailPhotoInput').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await resizeImage(file);
      await db.put({ wineId: w.id, blob });
      if (photoURLs[w.id]) URL.revokeObjectURL(photoURLs[w.id]);
      photoURLs[w.id] = URL.createObjectURL(blob);
      renderAll();
      openDetail(w.id);
      toast('Label photo saved 📷 (stored on this device)');
    } catch (err) { toast(err.message || 'Could not use that image'); }
  };

  $('edulisToggle')?.addEventListener('click', () => {
    $('edulisFull').classList.toggle('hidden');
    $('edulisToggle').classList.toggle('open');
  });
  $('drinkBtn')?.addEventListener('click', () => { closeSheet('detail'); openDrink(w.id); });
  $('placeBtn')?.addEventListener('click', () => { closeSheet('detail'); startPlacing(w.id); });
  $('editBtn').addEventListener('click', () => { closeSheet('detail'); openForm(w.id); });
  $('deleteBtn').addEventListener('click', async () => {
    if (!confirm(`Delete "${w.name}"? Its rack placements are freed; history entries keep the name.`)) return;
    if (!guardWrite()) return;
    try {
      await api('wines', { method: 'DELETE', id: w.id });
      wines = wines.filter(x => x.id !== w.id);
      placements = placements.filter(p => +p.wine_id !== w.id);
      await db.del(w.id).catch(() => {});
      if (photoURLs[w.id]) { URL.revokeObjectURL(photoURLs[w.id]); delete photoURLs[w.id]; }
      closeSheet('detail');
      renderAll();
      toast('Wine deleted');
    } catch (e) { apiFail(e, 'Could not delete'); }
  });

  function cell(k, v, cls = '') {
    return `<div class="info-cell"><div class="k">${k}</div><div class="v ${cls}">${esc(v)}</div></div>`;
  }
}

/* ---------------- add / edit form ---------------- */
function openForm(id) {
  const w = id ? wines.find(x => x.id === id) : null;
  pendingPhoto = null;

  $('formTitle').textContent = w ? 'Edit wine' : 'Add wine';
  $('f-id').value = w ? w.id : '';
  $('f-name').value = w?.name || '';
  $('f-producer').value = w?.producer || '';
  $('f-vintage').value = w?.vintage || '';
  $('f-style').value = w?.style || 'red';
  $('f-country').value = w?.country || '';
  $('f-region').value = w?.region || '';
  $('f-appellation').value = w?.appellation || '';
  $('f-grapes').value = (w?.grapes || []).join(', ');
  $('f-abv').value = w?.abv || '';
  $('f-quantity').value = w?.quantity ?? 1;
  $('f-size').value = String(w?.bottleMl || 750);
  $('f-drinkFrom').value = w?.drinkFrom || '';
  $('f-drinkTo').value = w?.drinkTo || '';
  $('f-ratingVivino').value = w?.ratingVivino ?? '';
  $('f-ratingCritic').value = w?.ratingCritic ?? '';
  $('f-marketPrice').value = w?.marketPrice ?? '';
  $('f-marketCurrency').value = w?.marketCurrency || 'CHF';
  $('f-purchasePrice').value = w?.purchasePrice ?? '';
  $('f-purchaseDate').value = w?.purchaseDate || '';
  $('f-edulisTitle').value = w?.edulisTitle || '';
  $('f-edulisBody').value = w?.edulisBody || '';
  $('f-edulisDate').value = w?.edulisDate || '';
  $('f-notes').value = w?.notes || '';
  $('f-photo').value = '';
  $('placedHint').textContent = w && placementsFor(w.id).length
    ? `${placementsFor(w.id).length} bottle(s) placed in racks` : '';
  updateVatHint();

  const preview = $('photoPreview');
  if (w && photoURLs[w.id]) {
    preview.src = photoURLs[w.id];
    preview.classList.remove('hidden');
    $('photoHint').classList.add('hidden');
  } else {
    preview.classList.add('hidden');
    $('photoHint').classList.remove('hidden');
  }

  openSheet('form');
  if (!w) setTimeout(() => $('f-name').focus(), 300);
}

function readForm() {
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  return {
    name: $('f-name').value.trim(),
    producer: $('f-producer').value.trim(),
    vintage: int($('f-vintage').value),
    style: $('f-style').value,
    country: $('f-country').value.trim(),
    region: $('f-region').value.trim(),
    appellation: $('f-appellation').value.trim(),
    grapes: $('f-grapes').value.split(',').map(s => s.trim()).filter(Boolean),
    abv: num($('f-abv').value),
    quantity: Math.max(0, int($('f-quantity').value) ?? 1),
    bottleMl: int($('f-size').value) || 750,
    drinkFrom: int($('f-drinkFrom').value),
    drinkTo: int($('f-drinkTo').value),
    ratingVivino: num($('f-ratingVivino').value),
    ratingCritic: int($('f-ratingCritic').value),
    marketPrice: num($('f-marketPrice').value),
    marketCurrency: $('f-marketCurrency').value,
    purchasePrice: num($('f-purchasePrice').value),
    purchaseDate: $('f-purchaseDate').value || null,
    edulisTitle: $('f-edulisTitle').value.trim(),
    edulisBody: $('f-edulisBody').value.trim(),
    edulisDate: $('f-edulisDate').value || null,
    notes: $('f-notes').value.trim(),
  };
}

async function saveForm(e) {
  e.preventDefault();
  if (!guardWrite()) return;
  const vals = readForm();
  if (!vals.name) return;
  const id = $('f-id').value ? +$('f-id').value : null;

  const btn = $('saveForm');
  btn.disabled = true;
  try {
    if (id) {
      const w = wines.find(x => x.id === id);
      Object.assign(w, vals);
      await api('wines', { method: 'PUT', id, data: toRow(w) });
      toast('Wine updated');
    } else {
      const w = { id: 0, createdAt: new Date().toISOString(), ...vals };
      const { id: newId } = await api('wines', { method: 'POST', data: toRow(w) });
      w.id = newId;
      wines.push(w);
      toast(`Added ${w.name} 🍷`);
    }
    const savedId = id || wines[wines.length - 1].id;
    if (pendingPhoto) {
      await db.put({ wineId: savedId, blob: pendingPhoto });
      if (photoURLs[savedId]) URL.revokeObjectURL(photoURLs[savedId]);
      photoURLs[savedId] = URL.createObjectURL(pendingPhoto);
      pendingPhoto = null;
    }
    closeSheet('form');
    renderAll();
  } catch (err) {
    apiFail(err, 'Could not save wine');
  } finally {
    btn.disabled = false;
  }
}

function updateVatHint() {
  const hint = $('vatHint');
  if (!hint) return;
  const net = parseFloat($('f-purchasePrice').value);
  hint.textContent = isNaN(net) ? '' : `incl. 8.1% VAT: ${money(net * (1 + VAT_RATE))}`;
}

/* photo resize */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Not an image'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1000;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('Could not process image'));
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

async function handlePhoto(file) {
  try {
    pendingPhoto = await resizeImage(file);
    const preview = $('photoPreview');
    preview.src = URL.createObjectURL(pendingPhoto);
    preview.classList.remove('hidden');
    $('photoHint').classList.add('hidden');
  } catch { /* ignore */ }
}

/* ---------------- drink a bottle ---------------- */
function openDrink(id) {
  const w = wines.find(x => x.id === id);
  if (!w) return;
  $('d-id').value = id;
  $('d-date').value = new Date().toISOString().slice(0, 10);
  $('d-note').value = '';
  $('d-rating').value = '';
  $('drinkWineName').textContent = [w.name, w.vintage].filter(Boolean).join(' ');
  openSheet('drink');
}

async function saveDrink(e) {
  e.preventDefault();
  if (!guardWrite()) return;
  const id = +$('d-id').value;
  const w = wines.find(x => x.id === id);
  if (!w) return;

  const rating = parseInt($('d-rating').value, 10);
  const entry = {
    wine_id: id,
    label: [w.producer, w.name, w.vintage].filter(Boolean).join(' '),
    drunk_on: $('d-date').value || new Date().toISOString().slice(0, 10),
    rating: isNaN(rating) ? null : Math.min(5, Math.max(1, rating)),
    notes: $('d-note').value.trim() || null,
  };

  try {
    const { id: logId } = await api('drink_log', { method: 'POST', data: entry });
    const newQty = Math.max(0, w.quantity - 1);
    await api('wines', { method: 'PUT', id, data: { quantity: newQty } });
    w.quantity = newQty;
    drinkLog.unshift({ id: logId, ...entry });

    // free one rack slot if more bottles are placed than remain
    const pls = placementsFor(id);
    if (pls.length > newQty) {
      const p = pls[pls.length - 1];
      await api('placements', { method: 'DELETE', id: p.id }).catch(() => {});
      placements = placements.filter(x => +x.id !== +p.id);
      toast(`Santé! Freed slot ${slotLabel(p)}`);
    } else {
      toast(newQty === 0 ? `Last bottle of ${w.name} — moved to history 🥂` : `Santé! ${newQty} bottle${newQty === 1 ? '' : 's'} left`);
    }

    closeSheet('drink');
    renderAll();
  } catch (err) { apiFail(err, 'Could not log the bottle'); }
}

/* ---------------- backup & migration ---------------- */
async function exportData() {
  try {
    const data = await api('all');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cellar-server-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup downloaded');
  } catch (e) { apiFail(e, 'Could not download backup'); }
}

/* Accepts either the old app's export ({app:"cellar",wines:[...]}) or a
   server backup ({wines,racks,placements,drink_log}) and POSTs ?r=import. */
async function importData(file) {
  if (!guardWrite()) return;
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { toast('Could not read that file'); return; }

  let body;
  let oldPhotoMap = null;  // [{name, vintage, dataURL}]
  if (payload.app === 'cellar' && Array.isArray(payload.wines)) {
    // old-format export → transform. Old string ids get numeric temp ids so
    // the server can remap drink_log references.
    const idMap = new Map();
    const winesOut = payload.wines.map((w, i) => {
      idMap.set(w.id, i + 1);
      const vm = {
        name: w.name || '', producer: w.producer || '', vintage: w.vintage ?? null,
        style: w.style || 'red', country: w.country || '', region: w.region || '',
        appellation: w.appellation || '', grapes: w.grapes || [], abv: w.abv ?? null,
        quantity: w.quantity ?? 0,
        bottleMl: { piccolo: 187, demi: 375, standard: 750, magnum: 1500, 'double-magnum': 3000, jeroboam: 4500, imperiale: 6000 }[w.size] || 750,
        drinkFrom: w.drinkFrom ?? null, drinkTo: w.drinkTo ?? null,
        ratingVivino: w.ratingVivino ?? null, ratingCritic: w.ratingCritic ?? null,
        marketPrice: w.marketPrice ?? null, marketCurrency: w.marketCurrency || 'CHF',
        purchasePrice: w.purchasePrice ?? null, purchaseDate: w.purchaseDate || null,
        edulisTitle: w.edulisTitle || '', edulisBody: w.edulisBody || w.edulisNotes || '',
        edulisDate: w.edulisDate || null,
        // old app stored a coarse zone ('boxed', 'top-left'…) — keep it in the notes
        notes: [w.notes || '', w.location && w.location !== 'unset' ? `(old location: ${w.location})` : ''].filter(Boolean).join(' '),
      };
      return { id: i + 1, ...toRow(vm) };
    });
    const logOut = (payload.drinks || []).map(d => ({
      wine_id: idMap.get(d.wineId) ?? null,
      label: d.wineName || '',
      drunk_on: d.date || new Date().toISOString().slice(0, 10),
      rating: d.rating != null ? Math.min(5, Math.max(1, Math.round(d.rating))) : null,
      notes: d.note || null,
    }));
    body = { wines: winesOut, racks: [], placements: [], drink_log: logOut };
    oldPhotoMap = Object.entries(payload.photos || {}).map(([oldId, dataURL]) => {
      const w = payload.wines.find(x => x.id === oldId);
      return w ? { name: w.name || '', vintage: w.vintage ?? null, dataURL } : null;
    }).filter(Boolean);
  } else if (Array.isArray(payload.wines)) {
    body = {
      wines: payload.wines, racks: payload.racks || [],
      placements: payload.placements || [], drink_log: payload.drink_log || [],
    };
  } else {
    toast('Not a recognised backup file');
    return;
  }

  const n = body.wines.length;
  if (!confirm(`Import ${n} wine(s)?\n\n⚠️ This REPLACES everything currently on the server (wines, racks, placements, history).`)) return;

  try {
    const res = await api('import', { method: 'POST', data: body });
    await loadAll();
    // re-attach photos from an old-format export by matching name+vintage
    if (oldPhotoMap && oldPhotoMap.length) {
      let attached = 0;
      for (const ph of oldPhotoMap) {
        const w = wines.find(x => x.name === ph.name && (x.vintage ?? null) === (ph.vintage ?? null));
        if (!w) continue;
        try {
          const blob = await (await fetch(ph.dataURL)).blob();
          await db.put({ wineId: w.id, blob });
          if (photoURLs[w.id]) URL.revokeObjectURL(photoURLs[w.id]);
          photoURLs[w.id] = URL.createObjectURL(blob);
          attached++;
        } catch { /* skip broken photo */ }
      }
      renderAll();
      toast(`Imported ${res.wines} wines ✓ (${attached} label photos restored on this device)`);
    } else {
      toast(`Imported ${res.wines} wines ✓`);
    }
  } catch (e) { apiFail(e, 'Import failed'); }
}

/* ---------------- theme ---------------- */
const THEME_KEY = 'cellar-theme';

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem(THEME_KEY, name);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  document.querySelectorAll('#themeRow .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.themepick === name));
}

/* ---------------- pull to refresh ---------------- */
async function doRefresh() {
  await loadAll();
  refreshFx();
}

function setupPullToRefresh() {
  const ptr = $('ptr');
  let startY = null;
  let armed = false;

  document.addEventListener('touchstart', (e) => {
    const sheetOpen = document.querySelector('.sheet:not(.hidden)');
    startY = (window.scrollY <= 0 && !sheetOpen) ? e.touches[0].clientY : null;
    armed = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 14 && window.scrollY <= 0) {
      armed = dy > 75;
      ptr.style.height = Math.min(dy * 0.4, 54) + 'px';
      ptr.textContent = armed ? '↻ Release to refresh' : '↓ Pull to refresh';
    }
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (startY == null) return;
    startY = null;
    if (!armed) { ptr.style.height = '0px'; return; }
    armed = false;
    ptr.textContent = '⟳ Refreshing…';
    ptr.style.height = '44px';
    const ok = await doRefresh();
    ptr.style.height = '0px';
    toast(readOnly ? '📡 Still offline' : 'Up to date ✓');
  });
}

/* ---------------- sheets & navigation ---------------- */
const SHEETS = ['detail', 'form', 'drink', 'settings', 'rackForm', 'slot'];

function openSheet(name) {
  SHEETS.forEach(closeSheet);
  $(name + 'Sheet').classList.remove('hidden');
  $(name + 'Backdrop').classList.remove('hidden');
}

function closeSheet(name) {
  $(name + 'Sheet').classList.add('hidden');
  $(name + 'Backdrop').classList.add('hidden');
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
  document.querySelectorAll('.tab[data-view]').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name !== 'racks' && placingWineId) stopPlacing();
  window.scrollTo(0, 0);
}

/* ---------------- Claude lookups (photo + name) ---------------- */
const CLAUDE_KEY_LS = 'claude-api-key';

const WINE_JSON_SPEC =
  'Respond with ONLY a JSON object (no markdown, no commentary) with exactly these keys, using null for anything you cannot determine: '
  + '"name" (string, the wine name), "producer" (string), "vintage" (integer year), '
  + '"style" (one of: "red","white","rose","sparkling","sweet","fortified"), '
  + '"country" (string), "region" (string), "appellation" (string), '
  + '"grapes" (array of grape variety strings — use the typical blend for this wine if unknown), '
  + '"abv" (number), '
  + '"drinkFrom" (integer year) and "drinkTo" (integer year) for the typical drinking window of this wine and vintage, '
  + '"ratingVivino" (number 0-5, the approximate Vivino community rating if you know it), '
  + '"ratingCritic" (integer 0-100, an approximate critic score if you know it), '
  + '"description" (one sentence about this wine\'s character), '
  + '"bottleCount" (integer — if a photo shows a case or box, how many bottles it holds; also count multiple identical visible bottles; null for a single bottle or a text-only request). '
  + 'Be accurate rather than complete — prefer null over guessing.';

function getClaudeKey() {
  const key = (localStorage.getItem(CLAUDE_KEY_LS) || '').trim();
  if (!key) toast('Add your Claude API key in ⚙︎ settings first');
  return key || null;
}

async function callClaude(key, content) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    throw new Error(resp.status === 401 ? 'API key rejected — check it in settings' : msg);
  }
  const data = await resp.json();
  if (data.stop_reason === 'refusal' || !data.content?.length) throw new Error('Claude could not answer this request');
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No wine details found in the response');
  return JSON.parse(match[0]);
}

async function withButtonSpinner(btn, working, fn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = working;
  try { await fn(); }
  catch (e) { console.warn('lookup failed', e); toast('Could not fetch: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

async function identifyLabel() {
  const key = getClaudeKey();
  if (!key) return;
  let blob = pendingPhoto;
  if (!blob) {
    const id = $('f-id').value;
    if (id) { const rec = await db.get(+id); blob = rec && rec.blob; }
  }
  if (!blob) { toast('Add a label photo first 📷 — or type the name and use “Fetch details”'); return; }

  await withButtonSpinner($('identifyBtn'), '🔎 Identifying…', async () => {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    const w = await callClaude(key, [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: 'Identify this wine from its label — the photo may show a single bottle, a wine label, or a case/box of wine. ' + WINE_JSON_SPEC },
    ]);
    fillFormFromScan(w);
    if (w.bottleCount > 1) {
      $('f-quantity').value = w.bottleCount;
      toast(`✨ Looks like a case of ${w.bottleCount} — quantity set to ${w.bottleCount}. Check & save`);
    } else {
      toast('✨ Identified! Check the details, then save');
    }
  });
}

async function fetchByName() {
  const key = getClaudeKey();
  if (!key) return;
  const name = $('f-name').value.trim();
  const vintage = $('f-vintage').value.trim();
  if (!name) { toast('Type the wine name first (vintage helps too)'); return; }
  await withButtonSpinner($('fetchByNameBtn'), '🔎 Fetching…', async () => {
    const w = await callClaude(key, [{
      type: 'text',
      text: `Identify the wine "${name}"${vintage ? `, vintage ${vintage}` : ''}. `
        + 'If the name is ambiguous, pick the best-known wine matching it. ' + WINE_JSON_SPEC,
    }]);
    fillFormFromScan(w);
    toast('✨ Details filled in — check & adjust, then save');
  });
}

function fillFormFromScan(w) {
  const set = (id, v) => { if (v != null && v !== '') $(id).value = v; };
  set('f-name', w.name);
  set('f-producer', w.producer);
  set('f-vintage', w.vintage);
  if (w.style && STYLE_LABELS[w.style]) $('f-style').value = w.style;
  set('f-country', w.country);
  set('f-region', w.region);
  set('f-appellation', w.appellation);
  if (Array.isArray(w.grapes) && w.grapes.length) $('f-grapes').value = w.grapes.join(', ');
  set('f-abv', w.abv);
  set('f-drinkFrom', w.drinkFrom);
  set('f-drinkTo', w.drinkTo);
  set('f-ratingVivino', w.ratingVivino);
  set('f-ratingCritic', w.ratingCritic);
  const notes = $('f-notes');
  if (w.description && !notes.value) notes.value = w.description;
}

/* ---------------- events ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem(THEME_KEY) || 'cellar');
  boot();
  refreshFx();
  setupPullToRefresh();

  // tabs
  document.querySelectorAll('.tab[data-view]').forEach(t =>
    t.addEventListener('click', () => switchView(t.dataset.view)));
  $('addBtn').addEventListener('click', () => openForm(null));

  // search / sort / filters
  $('searchInput').addEventListener('input', (e) => { searchTerm = e.target.value; renderList(); });
  $('sortSelect').addEventListener('change', (e) => { sortMode = e.target.value; renderList(); });
  $('filterStyles').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filterStyle = chip.dataset.style;
    $('filterStyles').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    renderList();
  });
  $('filterRacks').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filterRack = chip.dataset.rack;
    renderRackChips();
    renderList();
  });

  // wine form
  $('wineForm').addEventListener('submit', saveForm);
  $('cancelForm').addEventListener('click', () => closeSheet('form'));
  $('formBackdrop').addEventListener('click', () => closeSheet('form'));
  $('f-photo').addEventListener('change', (e) => handlePhoto(e.target.files[0]));
  $('f-purchasePrice').addEventListener('input', updateVatHint);
  document.querySelectorAll('.qty-quick .mini-btn').forEach(b =>
    b.addEventListener('click', () => { $('f-quantity').value = b.dataset.qty; }));
  $('identifyBtn').addEventListener('click', identifyLabel);
  $('fetchByNameBtn').addEventListener('click', fetchByName);

  // drink
  $('drinkForm').addEventListener('submit', saveDrink);
  $('cancelDrink').addEventListener('click', () => closeSheet('drink'));
  $('drinkBackdrop').addEventListener('click', () => closeSheet('drink'));

  // racks
  $('addRackBtn').addEventListener('click', () => { if (guardWrite()) openRackForm(null); });
  $('rackForm').addEventListener('submit', saveRackForm);
  $('cancelRackForm').addEventListener('click', () => closeSheet('rackForm'));
  $('rackFormBackdrop').addEventListener('click', () => closeSheet('rackForm'));
  $('placingCancel').addEventListener('click', stopPlacing);
  $('slotBackdrop').addEventListener('click', () => closeSheet('slot'));

  // detail
  $('detailBackdrop').addEventListener('click', () => closeSheet('detail'));

  // close buttons
  document.querySelectorAll('.sheet-close').forEach(b =>
    b.addEventListener('click', () => closeSheet(b.dataset.close)));

  // settings
  $('settingsBtn').addEventListener('click', () => openSheet('settings'));
  $('settingsBackdrop').addEventListener('click', () => closeSheet('settings'));
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  $('themeRow').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) applyTheme(chip.dataset.themepick);
  });
  const keyInput = $('claudeKeyInput');
  keyInput.value = localStorage.getItem(CLAUDE_KEY_LS) || '';
  keyInput.addEventListener('change', () => {
    localStorage.setItem(CLAUDE_KEY_LS, keyInput.value.trim());
    toast(keyInput.value.trim() ? 'API key saved on this device' : 'API key removed');
  });
});
