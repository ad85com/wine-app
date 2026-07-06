/* ============================================================
   app.js — Cellar wine collection tracker
   ============================================================ */

'use strict';

/* ---------------- state ---------------- */
let wines = [];        // all wine records (status 'cellar' | 'finished')
let drinks = [];       // drinking history entries
let photoURLs = {};    // wineId -> objectURL for label photos
let pendingPhoto = null; // Blob selected in the form, not yet saved

let filterStyle = '';
let filterLoc = '';
let searchTerm = '';
let sortMode = 'added';

const $ = (id) => document.getElementById(id);
const CURRENCY_KEY = 'cellar-currency';
let currency = localStorage.getItem(CURRENCY_KEY) || 'CHF';

/* ---------------- pricing: VAT & FX ---------------- */
const VAT_RATE = 0.081; // Swiss VAT 8.1%
const FX_KEY = 'fx-eur-chf';
const FX_FALLBACK = 0.94; // EUR → CHF fallback rate

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
    if (c && Date.now() - c.ts < 24 * 3600_000) return; // fresh enough
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CHF');
    const j = await r.json();
    const rate = j?.rates?.CHF;
    if (rate > 0) {
      localStorage.setItem(FX_KEY, JSON.stringify({ rate, ts: Date.now() }));
      renderAll();
    }
  } catch { /* offline or blocked — keep cached/fallback rate */ }
}

/* market price in CHF, whatever currency it was entered in */
function marketCHF(w) {
  if (w.marketPrice == null) return null;
  return (w.marketCurrency === 'EUR') ? w.marketPrice * fxRate() : w.marketPrice;
}

/* purchase price incl. 8.1% VAT (entered excl. VAT, in CHF) */
function purchaseGross(w) {
  if (w.purchasePrice == null) return null;
  return w.purchasePrice * (1 + VAT_RATE);
}

const LOC_LABELS = {
  'boxed': '📦 Boxed',
  'top-left': '↖ Top left',
  'top-right': '↗ Top right',
  'bottom-left': '↙ Bottom left',
  'bottom-right': '↘ Bottom right',
};

const STYLE_LABELS = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', sweet: 'Sweet', fortified: 'Fortified' };

const SIZE_LABELS = {
  'piccolo': 'Piccolo (187.5 ml)',
  'demi': 'Demi-bouteille (375 ml)',
  'standard': 'Standard (750 ml)',
  'magnum': 'Magnum (1.5 L)',
  'double-magnum': 'Double Magnum (3 L)',
  'jeroboam': 'Jéroboam (4.5 L)',
  'imperiale': 'Impériale (6 L)',
};
const SIZE_SHORT = {
  'piccolo': 'Piccolo', 'demi': 'Demi', 'standard': '750 ml', 'magnum': 'Magnum',
  'double-magnum': 'Dbl Magnum', 'jeroboam': 'Jéroboam', 'imperiale': 'Impériale',
};
const STYLE_ICONS = { red: '🍷', white: '🥂', rose: '🌸', sparkling: '🍾', sweet: '🍯', fortified: '🥃' };

/* ---------------- boot ---------------- */
async function boot() {
  wines = await db.all('wines');
  drinks = await db.all('drinks');
  const photos = await db.all('photos');
  for (const p of photos) photoURLs[p.wineId] = URL.createObjectURL(p.blob);
  $('currencyInput').value = currency;
  renderAll();

  if (typeof SYNC !== 'undefined') SYNC.init();

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      swReg = reg;
      // periodic update check while the app is open
      setInterval(() => reg.update().catch(() => {}), 30 * 60_000);
    }).catch(() => {});
    // a new version took control → reload once to load the new code
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || swReloading) return; // first install, or already reloading
      swReloading = true;
      if ($('formSheet').classList.contains('hidden')) {
        toast('App updated — reloading ✓');
        setTimeout(() => location.reload(), 700);
      }
    });
  }
}

let swReg = null;
let swReloading = false;

/* ---------------- pull to refresh ---------------- */
async function doRefresh() {
  try { if (swReg) await swReg.update(); } catch { /* offline */ }
  try { if (typeof SYNC !== 'undefined') await SYNC.syncNow(); } catch { /* ignore */ }
  refreshFx();
  renderAll();
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
    await doRefresh();
    ptr.style.height = '0px';
    if (!swReloading) toast('Up to date ✓');
  });
}

function renderAll() {
  renderDashboard();
  renderList();
  renderHistory();
  renderMap();
}

/* ---------------- helpers ---------------- */
function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function money(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString('en') : abs.toFixed(abs % 1 ? 2 : 0);
  const sym = /[A-Za-z]$/.test(currency) ? currency + ' ' : currency;
  return (n < 0 ? '−' : '') + sym + s;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cellarWines() {
  return wines.filter(w => w.status === 'cellar' && w.quantity > 0);
}

/* Drinking-window status for the current year — label always shows the window */
function windowStatus(w) {
  const year = new Date().getFullYear();
  if (!w.drinkFrom && !w.drinkTo) return null;
  const range = `${w.drinkFrom || '…'}–${w.drinkTo || '…'}`;
  if (w.drinkFrom && year < w.drinkFrom) return { cls: 'hold', label: `⏳ Hold · ${range}` };
  if (w.drinkTo && year > w.drinkTo) return { cls: 'past', label: `⚠️ Past peak (${range})` };
  if (w.drinkTo && year >= w.drinkTo - 1) return { cls: 'soon', label: `🔥 Drink now · until ${w.drinkTo}` };
  return { cls: 'ready', label: `✓ Drink ${range}` };
}

/* "May 2026" from an ISO date string */
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
  t._timer = setTimeout(() => t.classList.add('hidden'), 2400);
}

/* ---------------- dashboard ---------------- */
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
function renderList() {
  let list = cellarWines();

  if (filterStyle) list = list.filter(w => w.style === filterStyle);
  if (filterLoc) list = list.filter(w => w.location === filterLoc);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(w =>
      [w.name, w.producer, w.region, w.country, w.appellation, (w.grapes || []).join(' '),
       String(w.vintage || ''), STYLE_LABELS[w.style], SIZE_SHORT[w.size], SIZE_LABELS[w.size],
       w.edulisTitle, w.edulisBody, w.edulisNotes, w.notes]
        .join(' ').toLowerCase().includes(q));
  }

  list.sort((a, b) => {
    switch (sortMode) {
      case 'name': return (a.name || '').localeCompare(b.name || '');
      case 'vintage': return (a.vintage || 9999) - (b.vintage || 9999);
      case 'value': return ((marketCHF(b) || 0) * b.quantity) - ((marketCHF(a) || 0) * a.quantity);
      case 'window': return (a.drinkTo || 9999) - (b.drinkTo || 9999);
      default: return (b.createdAt || 0) - (a.createdAt || 0);
    }
  });

  const el = $('wineList');
  el.innerHTML = list.map(wineCard).join('');
  $('emptyState').classList.toggle('hidden', cellarWines().length > 0);

  el.querySelectorAll('.wine-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function wineCard(w) {
  const ws = windowStatus(w);
  const photo = photoURLs[w.id];
  const thumb = photo
    ? `<img class="wine-thumb" src="${photo}" alt="">`
    : `<div class="wine-thumb">${STYLE_ICONS[w.style] || '🍷'}</div>`;

  const badges = [];
  if (w.vintage) badges.push(`<span class="badge">${w.vintage}</span>`);
  if (w.size && w.size !== 'standard') badges.push(`<span class="badge gold">${SIZE_SHORT[w.size] || esc(w.size)}</span>`);
  if (w.region) badges.push(`<span class="badge">${esc(w.region)}</span>`);
  if (w.ratingVivino) badges.push(`<span class="badge gold">★ ${w.ratingVivino}</span>`);
  if (w.ratingCritic) badges.push(`<span class="badge gold">${w.ratingCritic} pts</span>`);
  if (ws) badges.push(`<span class="badge ${ws.cls}">${ws.label}</span>`);
  badges.push(`<span class="badge">${LOC_LABELS[w.location] || ''}</span>`);

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

/* ---------------- cellar map ---------------- */
function renderMap() {
  const counts = { 'boxed': 0, 'top-left': 0, 'top-right': 0, 'bottom-left': 0, 'bottom-right': 0 };
  for (const w of cellarWines()) counts[w.location] = (counts[w.location] || 0) + w.quantity;
  for (const loc of Object.keys(counts)) {
    const el = $('zone-' + loc);
    if (el) el.textContent = counts[loc];
  }
}

/* ---------------- history ---------------- */
function renderHistory() {
  const sorted = [...drinks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const el = $('historyList');

  el.innerHTML = sorted.map(d => {
    const w = wines.find(x => x.id === d.wineId) || {};
    const photo = photoURLs[w.id];
    const thumb = photo
      ? `<img class="wine-thumb" src="${photo}" alt="">`
      : `<div class="wine-thumb">${STYLE_ICONS[w.style] || '🥂'}</div>`;
    return `
    <article class="wine-card" data-id="${w.id || ''}">
      ${thumb}
      <div class="wine-body">
        <div class="wine-name">${esc(d.wineName || w.name || 'Unknown wine')}</div>
        <div class="wine-sub">${esc([w.vintage, w.region].filter(Boolean).join(' · '))}</div>
        <div class="wine-badges">
          <span class="badge">🗓 ${d.date || '—'}</span>
          ${d.rating ? `<span class="badge gold">★ ${d.rating}</span>` : ''}
        </div>
        ${d.note ? `<div class="history-note">“${esc(d.note)}”</div>` : ''}
      </div>
    </article>`;
  }).join('');

  $('historyEmpty').classList.toggle('hidden', sorted.length > 0);

  const spent = sorted.reduce((n, d) => n + (d.priceAtDrink || 0), 0);
  $('historyStats').textContent = sorted.length
    ? `${sorted.length} bottle${sorted.length === 1 ? '' : 's'} enjoyed · ${money(spent)} of wine drunk`
    : '';

  el.querySelectorAll('.wine-card').forEach(card => {
    if (card.dataset.id) card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

/* ---------------- detail sheet ---------------- */
function openDetail(id) {
  const w = wines.find(x => x.id === id);
  if (!w) return;

  const ws = windowStatus(w);
  const photo = photoURLs[w.id];
  const pairings = getPairings(w);
  const inCellar = w.status === 'cellar' && w.quantity > 0;

  const mkt = marketCHF(w);
  const gross = purchaseGross(w);
  const gain = (mkt != null && gross != null) ? mkt - gross : null;
  const q = encodeURIComponent([w.name, w.vintage].filter(Boolean).join(' '));

  const infoCells = [
    w.vintage && cell('Vintage', w.vintage),
    w.style && cell('Style', STYLE_LABELS[w.style]),
    (w.region || w.country) && cell('Region', [w.appellation || w.region, w.country].filter(Boolean).join(', ')),
    (w.grapes || []).length && cell('Grapes', w.grapes.join(', ')),
    w.abv && cell('ABV', w.abv + '%'),
    w.size && cell('Bottle size', SIZE_LABELS[w.size] || w.size),
    (w.drinkFrom || w.drinkTo) && cell('Drinking window', `${w.drinkFrom || '…'} – ${w.drinkTo || '…'}`),
    w.ratingVivino && cell('Vivino users', '★ ' + w.ratingVivino + ' / 5'),
    w.ratingCritic && cell('Wine-Searcher critics', w.ratingCritic + ' / 100'),
    mkt != null && cell('Market price', money(mkt) + (w.marketCurrency === 'EUR' ? ` (€${w.marketPrice})` : ''), 'gold'),
    gross != null && cell('Purchase incl. 8.1% VAT', money(gross)),
    w.purchasePrice != null && cell('Purchase excl. VAT (as paid)', money(w.purchasePrice)),
    gain != null && cell('Gain per bottle', (gain >= 0 ? '+' : '') + money(gain).replace('−', '-'), gain >= 0 ? 'pos' : 'neg'),
    w.purchaseDate && cell('Purchased', w.purchaseDate),
    inCellar && cell('Location', LOC_LABELS[w.location]),
    inCellar && cell('Bottles', '× ' + w.quantity),
  ].filter(Boolean).join('');

  const wineDrinks = drinks.filter(d => d.wineId === w.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  $('detailContent').innerHTML = `
    ${photo ? `<img class="detail-photo" src="${photo}" alt="Label">` : ''}
    <button type="button" class="mini-btn detail-photo-btn" id="detailPhotoBtn">📷 ${photo ? 'Replace' : 'Add'} label photo</button>
    <div class="detail-name">${esc(w.name)}</div>
    <div class="detail-sub">${esc([w.producer, w.vintage].filter(Boolean).join(' · '))}</div>
    <div class="detail-badges">
      ${ws ? `<span class="badge ${ws.cls}">${ws.label}</span>` : ''}
      ${!inCellar ? '<span class="badge past">Finished</span>' : ''}
    </div>

    <div class="detail-section"><h3>Details</h3><div class="info-grid">${infoCells}</div></div>

    ${(w.edulisTitle || w.edulisBody || w.edulisNotes) ? `<div class="detail-section"><h3>Edulis notes</h3>
      <button type="button" class="note-toggle" id="edulisToggle">
        <span class="note-titles">
          <span class="note-title">${esc(w.edulisTitle || 'Note from Edulis')}</span>
          ${monthYear(w.purchaseDate || w.edulisDate) ? `<span class="note-when">Purchased ${monthYear(w.purchaseDate || w.edulisDate)}</span>` : ''}
        </span>
        <span class="note-chevron">▾</span>
      </button>
      <div class="note-block note-full hidden" id="edulisFull">${esc(w.edulisBody || w.edulisNotes || '')}</div>
    </div>` : ''}
    ${w.notes ? `<div class="detail-section"><h3>My notes</h3><div class="note-block">${esc(w.notes)}</div></div>` : ''}

    ${pairings.length ? `<div class="detail-section"><h3>Pairs well with</h3>
      <div class="pairing-list">${pairings.map(p => `<span class="pairing-item">${esc(p)}</span>`).join('')}</div></div>` : ''}

    ${wineDrinks.length ? `<div class="detail-section"><h3>Tasting history</h3>
      ${wineDrinks.map(d => `<div class="note-block" style="margin-bottom:8px">🗓 ${d.date || '—'}${d.rating ? ` · ★ ${d.rating}` : ''}${d.note ? `<br>“${esc(d.note)}”` : ''}</div>`).join('')}</div>` : ''}

    <div class="detail-actions">
      ${inCellar ? `<button class="btn primary" id="drinkBtn">🥂 Drink a bottle</button>` : ''}
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
      await setWinePhoto(w.id, await resizeImage(file));
      openDetail(w.id); // re-render with the new photo
      toast('Label photo saved 📷');
    } catch (err) {
      toast(err.message || 'Could not use that image');
    }
  };

  const edulisToggle = $('edulisToggle');
  if (edulisToggle) edulisToggle.addEventListener('click', () => {
    $('edulisFull').classList.toggle('hidden');
    edulisToggle.classList.toggle('open');
  });

  const drinkBtn = $('drinkBtn');
  if (drinkBtn) drinkBtn.addEventListener('click', () => { closeSheet('detail'); openDrink(w.id); });
  $('editBtn').addEventListener('click', () => { closeSheet('detail'); openForm(w.id); });
  $('deleteBtn').addEventListener('click', async () => {
    if (!confirm(`Delete "${w.name}" and its history? This cannot be undone.`)) return;
    await deleteWine(w.id);
    closeSheet('detail');
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
  $('f-size').value = w?.size || 'standard';
  $('f-drinkFrom').value = w?.drinkFrom || '';
  $('f-drinkTo').value = w?.drinkTo || '';
  $('f-ratingVivino').value = w?.ratingVivino || '';
  $('f-ratingCritic').value = w?.ratingCritic || '';
  $('f-marketPrice').value = w?.marketPrice ?? '';
  $('f-marketCurrency').value = w?.marketCurrency || 'CHF';
  $('f-purchasePrice').value = w?.purchasePrice ?? '';
  updateVatHint();
  $('f-purchaseDate').value = w?.purchaseDate || '';
  $('f-location').value = w?.location || 'boxed';
  $('f-edulisTitle').value = w?.edulisTitle || '';
  $('f-edulisBody').value = w?.edulisBody || w?.edulisNotes || '';
  $('f-edulisDate').value = w?.edulisDate || '';
  $('f-notes').value = w?.notes || '';
  $('f-photo').value = '';

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

async function saveForm(e) {
  e.preventDefault();

  const id = $('f-id').value || uid();
  const existing = wines.find(x => x.id === id);

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

  const w = {
    id,
    status: existing?.status || 'cellar',
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
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
    size: $('f-size').value,
    drinkFrom: int($('f-drinkFrom').value),
    drinkTo: int($('f-drinkTo').value),
    ratingVivino: num($('f-ratingVivino').value),
    ratingCritic: int($('f-ratingCritic').value),
    marketPrice: num($('f-marketPrice').value),
    marketCurrency: $('f-marketCurrency').value,
    purchasePrice: num($('f-purchasePrice').value), // CHF, excl. VAT as entered
    vatRate: VAT_RATE,
    purchaseDate: $('f-purchaseDate').value || null,
    location: $('f-location').value,
    edulisTitle: $('f-edulisTitle').value.trim(),
    edulisBody: $('f-edulisBody').value.trim(),
    edulisDate: $('f-edulisDate').value || null,
    notes: $('f-notes').value.trim(),
  };

  if (!w.name) return;
  if (w.quantity > 0) w.status = 'cellar';
  if (pendingPhoto) w.photoRev = Date.now();
  else if (existing?.photoRev) w.photoRev = existing.photoRev;

  await db.put('wines', w);
  if (existing) Object.assign(existing, w); else wines.push(w);

  if (pendingPhoto) {
    await db.put('photos', { wineId: id, blob: pendingPhoto });
    if (photoURLs[id]) URL.revokeObjectURL(photoURLs[id]);
    photoURLs[id] = URL.createObjectURL(pendingPhoto);
    pendingPhoto = null;
    if (typeof SYNC !== 'undefined') SYNC.markPhoto(id);
  }
  if (typeof SYNC !== 'undefined') SYNC.markWine(id);

  closeSheet('form');
  renderAll();
  toast(existing ? 'Wine updated' : `Added ${w.name} 🍷`);
}

/* Resize + compress a photo to a storable JPEG blob */
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

/* Photo picked in the add/edit form: hold as pending until save */
async function handlePhoto(file) {
  try {
    pendingPhoto = await resizeImage(file);
    const preview = $('photoPreview');
    preview.src = URL.createObjectURL(pendingPhoto);
    preview.classList.remove('hidden');
    $('photoHint').classList.add('hidden');
  } catch { /* ignore invalid file */ }
}

/* Set/replace a wine's label photo immediately (from the detail page) */
async function setWinePhoto(id, blob) {
  await db.put('photos', { wineId: id, blob });
  if (photoURLs[id]) URL.revokeObjectURL(photoURLs[id]);
  photoURLs[id] = URL.createObjectURL(blob);
  const w = wines.find(x => x.id === id);
  if (w) {
    w.photoRev = Date.now(); // lets other devices know to re-download the photo
    w.updatedAt = Date.now();
    await db.put('wines', w);
  }
  if (typeof SYNC !== 'undefined') { SYNC.markPhoto(id); if (w) SYNC.markWine(id); }
  renderAll();
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
  const id = $('d-id').value;
  const w = wines.find(x => x.id === id);
  if (!w) return;

  const rating = parseFloat($('d-rating').value);
  const entry = {
    id: uid(),
    wineId: id,
    wineName: [w.name, w.vintage].filter(Boolean).join(' '),
    date: $('d-date').value || new Date().toISOString().slice(0, 10),
    note: $('d-note').value.trim(),
    rating: isNaN(rating) ? null : rating,
    priceAtDrink: marketCHF(w) ?? purchaseGross(w) ?? 0,
  };

  w.quantity = Math.max(0, w.quantity - 1);
  if (w.quantity === 0) w.status = 'finished';
  w.updatedAt = Date.now();

  await db.put('drinks', entry);
  await db.put('wines', w);
  drinks.push(entry);
  if (typeof SYNC !== 'undefined') { SYNC.markDrink(entry.id); SYNC.markWine(w.id); }

  closeSheet('drink');
  renderAll();
  toast(w.quantity === 0 ? `Last bottle of ${w.name} — moved to history 🥂` : `Santé! ${w.quantity} bottle${w.quantity === 1 ? '' : 's'} left`);
}

async function deleteWine(id) {
  if (typeof SYNC !== 'undefined') {
    SYNC.markDeleted('wines', id);
    for (const d of drinks.filter(d => d.wineId === id)) SYNC.markDeleted('drinks', d.id);
  }
  await db.del('wines', id);
  await db.del('photos', id);
  for (const d of drinks.filter(d => d.wineId === id)) await db.del('drinks', d.id);
  wines = wines.filter(w => w.id !== id);
  drinks = drinks.filter(d => d.wineId !== id);
  if (photoURLs[id]) { URL.revokeObjectURL(photoURLs[id]); delete photoURLs[id]; }
  renderAll();
  toast('Wine deleted');
}

/* ---------------- export / import ---------------- */
async function exportData() {
  const photos = await db.all('photos');
  const photoData = {};
  for (const p of photos) {
    photoData[p.wineId] = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(p.blob);
    });
  }

  const payload = { app: 'cellar', version: 1, exportedAt: new Date().toISOString(), currency, wines, drinks, photos: photoData };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cellar-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup downloaded');
}

async function importData(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    toast('Could not read that file');
    return;
  }
  if (payload.app !== 'cellar' || !Array.isArray(payload.wines)) {
    toast('Not a Cellar backup file');
    return;
  }

  for (const w of payload.wines) {
    await db.put('wines', w);
    const i = wines.findIndex(x => x.id === w.id);
    if (i >= 0) wines[i] = w; else wines.push(w);
    if (typeof SYNC !== 'undefined') SYNC.markWine(w.id);
  }
  for (const d of (payload.drinks || [])) {
    await db.put('drinks', d);
    if (!drinks.find(x => x.id === d.id)) drinks.push(d);
    if (typeof SYNC !== 'undefined') SYNC.markDrink(d.id);
  }
  for (const [wineId, dataURL] of Object.entries(payload.photos || {})) {
    try {
      const blob = await (await fetch(dataURL)).blob();
      await db.put('photos', { wineId, blob });
      if (photoURLs[wineId]) URL.revokeObjectURL(photoURLs[wineId]);
      photoURLs[wineId] = URL.createObjectURL(blob);
      if (typeof SYNC !== 'undefined') SYNC.markPhoto(wineId);
    } catch { /* skip broken photo */ }
  }

  if (payload.currency) {
    currency = payload.currency;
    localStorage.setItem(CURRENCY_KEY, currency);
    $('currencyInput').value = currency;
  }

  renderAll();
  toast(`Imported ${payload.wines.length} wine${payload.wines.length === 1 ? '' : 's'}`);
}

function updateVatHint() {
  const hint = $('vatHint');
  if (!hint) return;
  const net = parseFloat($('f-purchasePrice').value);
  hint.textContent = isNaN(net) ? '' : `incl. 8.1% VAT: ${money(net * (1 + VAT_RATE))}`;
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

/* ---------------- sheets & navigation ---------------- */
const SHEETS = ['detail', 'form', 'drink', 'settings'];

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
  window.scrollTo(0, 0);
}

/* ---------------- events ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  boot();
  refreshFx();
  applyTheme(localStorage.getItem(THEME_KEY) || 'cellar');
  setupPullToRefresh();

  // theme picker
  $('themeRow')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) applyTheme(chip.dataset.themepick);
  });

  // VAT hint + quick quantity buttons
  $('f-purchasePrice').addEventListener('input', updateVatHint);
  document.querySelectorAll('.qty-quick .mini-btn').forEach(b =>
    b.addEventListener('click', () => { $('f-quantity').value = b.dataset.qty; }));

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

  $('filterLocations').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filterLoc = chip.dataset.loc;
    $('filterLocations').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    renderList();
  });

  // cellar map zones -> filtered cellar view
  document.querySelectorAll('.map-zone').forEach(z =>
    z.addEventListener('click', () => {
      filterLoc = z.dataset.loc;
      $('filterLocations').querySelectorAll('.chip').forEach(c =>
        c.classList.toggle('active', c.dataset.loc === filterLoc));
      switchView('cellar');
      renderList();
    }));

  // form
  $('wineForm').addEventListener('submit', saveForm);
  $('cancelForm').addEventListener('click', () => closeSheet('form'));
  $('formBackdrop').addEventListener('click', () => closeSheet('form'));
  $('f-photo').addEventListener('change', (e) => handlePhoto(e.target.files[0]));

  // lookup links from the form (open a search for what's typed so far)
  const lookupQuery = () => encodeURIComponent([$('f-name').value, $('f-vintage').value].filter(Boolean).join(' ').trim());
  $('lookupWS').addEventListener('click', () => {
    const q = lookupQuery();
    if (q) window.open('https://www.wine-searcher.com/find/' + q, '_blank');
    else toast('Type the wine name first');
  });
  $('lookupVivino').addEventListener('click', () => {
    const q = lookupQuery();
    if (q) window.open('https://www.vivino.com/search/wines?q=' + q, '_blank');
    else toast('Type the wine name first');
  });

  // drink
  $('drinkForm').addEventListener('submit', saveDrink);
  $('cancelDrink').addEventListener('click', () => closeSheet('drink'));
  $('drinkBackdrop').addEventListener('click', () => closeSheet('drink'));

  // detail
  $('detailBackdrop').addEventListener('click', () => closeSheet('detail'));

  // close buttons on all sheets
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
  $('currencyInput').addEventListener('change', (e) => {
    currency = e.target.value.trim() || '€';
    localStorage.setItem(CURRENCY_KEY, currency);
    renderAll();
  });
});
