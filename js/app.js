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
let currency = localStorage.getItem(CURRENCY_KEY) || '€';

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
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
  return (n < 0 ? '−' : '') + currency + s;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cellarWines() {
  return wines.filter(w => w.status === 'cellar' && w.quantity > 0);
}

/* Drinking-window status for the current year */
function windowStatus(w) {
  const year = new Date().getFullYear();
  if (!w.drinkFrom && !w.drinkTo) return null;
  if (w.drinkFrom && year < w.drinkFrom) return { cls: 'hold', label: `⏳ Hold until ${w.drinkFrom}` };
  if (w.drinkTo && year > w.drinkTo) return { cls: 'past', label: '⚠️ Past peak' };
  if (w.drinkTo && year >= w.drinkTo - 1) return { cls: 'soon', label: `🔥 Drink by ${w.drinkTo}` };
  return { cls: 'ready', label: w.drinkTo ? `✓ Ready (until ${w.drinkTo})` : '✓ Ready' };
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
  const value = cw.reduce((n, w) => n + (w.marketPrice || w.purchasePrice || 0) * w.quantity, 0);
  const cost = cw.reduce((n, w) => n + (w.purchasePrice || 0) * w.quantity, 0);

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
       w.edulisNotes, w.notes]
        .join(' ').toLowerCase().includes(q));
  }

  list.sort((a, b) => {
    switch (sortMode) {
      case 'name': return (a.name || '').localeCompare(b.name || '');
      case 'vintage': return (a.vintage || 9999) - (b.vintage || 9999);
      case 'value': return ((b.marketPrice || 0) * b.quantity) - ((a.marketPrice || 0) * a.quantity);
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
      <div class="wine-price">${money(w.marketPrice)}</div>
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

  const gain = (w.marketPrice != null && w.purchasePrice != null) ? w.marketPrice - w.purchasePrice : null;
  const q = encodeURIComponent([w.name, w.vintage].filter(Boolean).join(' '));

  const infoCells = [
    w.vintage && cell('Vintage', w.vintage),
    w.style && cell('Style', STYLE_LABELS[w.style]),
    (w.region || w.country) && cell('Region', [w.appellation || w.region, w.country].filter(Boolean).join(', ')),
    (w.grapes || []).length && cell('Grapes', w.grapes.join(', ')),
    w.abv && cell('ABV', w.abv + '%'),
    w.size && cell('Bottle size', SIZE_LABELS[w.size] || w.size),
    (w.drinkFrom || w.drinkTo) && cell('Drinking window', `${w.drinkFrom || '…'} – ${w.drinkTo || '…'}`),
    w.ratingVivino && cell('Vivino', '★ ' + w.ratingVivino + ' / 5'),
    w.ratingCritic && cell('Critic score', w.ratingCritic + ' / 100'),
    w.marketPrice != null && cell('Market price', money(w.marketPrice), 'gold'),
    w.purchasePrice != null && cell('Purchase price', money(w.purchasePrice)),
    gain != null && cell('Gain per bottle', (gain >= 0 ? '+' : '') + money(gain).replace('−', '-'), gain >= 0 ? 'pos' : 'neg'),
    w.purchaseDate && cell('Purchased', w.purchaseDate),
    inCellar && cell('Location', LOC_LABELS[w.location]),
    inCellar && cell('Bottles', '× ' + w.quantity),
  ].filter(Boolean).join('');

  const wineDrinks = drinks.filter(d => d.wineId === w.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  $('detailContent').innerHTML = `
    ${photo ? `<img class="detail-photo" src="${photo}" alt="Label">` : ''}
    <div class="detail-name">${esc(w.name)}</div>
    <div class="detail-sub">${esc([w.producer, w.vintage].filter(Boolean).join(' · '))}</div>
    <div class="detail-badges">
      ${ws ? `<span class="badge ${ws.cls}">${ws.label}</span>` : ''}
      ${!inCellar ? '<span class="badge past">Finished</span>' : ''}
    </div>

    <div class="detail-section"><h3>Details</h3><div class="info-grid">${infoCells}</div></div>

    ${w.edulisNotes ? `<div class="detail-section"><h3>Edulis notes</h3><div class="note-block">${esc(w.edulisNotes)}</div></div>` : ''}
    ${w.notes ? `<div class="detail-section"><h3>My notes</h3><div class="note-block">${esc(w.notes)}</div></div>` : ''}

    ${pairings.length ? `<div class="detail-section"><h3>Pairs well with</h3>
      <div class="pairing-list">${pairings.map(p => `<span class="pairing-item">${esc(p)}</span>`).join('')}</div></div>` : ''}

    ${wineDrinks.length ? `<div class="detail-section"><h3>Tasting history</h3>
      ${wineDrinks.map(d => `<div class="note-block" style="margin-bottom:8px">🗓 ${d.date || '—'}${d.rating ? ` · ★ ${d.rating}` : ''}${d.note ? `<br>“${esc(d.note)}”` : ''}</div>`).join('')}</div>` : ''}

    <div class="detail-section"><h3>Look up online</h3>
      <div class="pairing-list">
        <a class="pairing-item" href="https://www.wine-searcher.com/find/${q}" target="_blank" rel="noopener">🔎 Wine-Searcher</a>
        <a class="pairing-item" href="https://www.vivino.com/search/wines?q=${q}" target="_blank" rel="noopener">🍇 Vivino</a>
      </div>
    </div>

    <div class="detail-actions">
      ${inCellar ? `<button class="btn primary" id="drinkBtn">🥂 Drink a bottle</button>` : ''}
      <div class="detail-actions-row">
        <button class="btn ghost" id="editBtn">✏️ Edit</button>
        <button class="btn danger" id="deleteBtn">Delete</button>
      </div>
    </div>
  `;

  openSheet('detail');

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
  $('f-purchasePrice').value = w?.purchasePrice ?? '';
  $('f-purchaseDate').value = w?.purchaseDate || '';
  $('f-location').value = w?.location || 'boxed';
  $('f-edulisNotes').value = w?.edulisNotes || '';
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
    purchasePrice: num($('f-purchasePrice').value),
    purchaseDate: $('f-purchaseDate').value || null,
    location: $('f-location').value,
    edulisNotes: $('f-edulisNotes').value.trim(),
    notes: $('f-notes').value.trim(),
  };

  if (!w.name) return;
  if (w.quantity > 0) w.status = 'cellar';

  await db.put('wines', w);
  if (existing) Object.assign(existing, w); else wines.push(w);

  if (pendingPhoto) {
    await db.put('photos', { wineId: id, blob: pendingPhoto });
    if (photoURLs[id]) URL.revokeObjectURL(photoURLs[id]);
    photoURLs[id] = URL.createObjectURL(pendingPhoto);
    pendingPhoto = null;
  }

  closeSheet('form');
  renderAll();
  toast(existing ? 'Wine updated' : `Added ${w.name} 🍷`);
}

/* Resize + compress the label photo before storing */
function handlePhoto(file) {
  if (!file || !file.type.startsWith('image/')) return;
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
      if (!blob) return;
      pendingPhoto = blob;
      const preview = $('photoPreview');
      preview.src = URL.createObjectURL(blob);
      preview.classList.remove('hidden');
      $('photoHint').classList.add('hidden');
    }, 'image/jpeg', 0.82);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
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
    priceAtDrink: w.marketPrice || w.purchasePrice || 0,
  };

  w.quantity = Math.max(0, w.quantity - 1);
  if (w.quantity === 0) w.status = 'finished';
  w.updatedAt = Date.now();

  await db.put('drinks', entry);
  await db.put('wines', w);
  drinks.push(entry);

  closeSheet('drink');
  renderAll();
  toast(w.quantity === 0 ? `Last bottle of ${w.name} — moved to history 🥂` : `Santé! ${w.quantity} bottle${w.quantity === 1 ? '' : 's'} left`);
}

async function deleteWine(id) {
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
  }
  for (const d of (payload.drinks || [])) {
    await db.put('drinks', d);
    if (!drinks.find(x => x.id === d.id)) drinks.push(d);
  }
  for (const [wineId, dataURL] of Object.entries(payload.photos || {})) {
    try {
      const blob = await (await fetch(dataURL)).blob();
      await db.put('photos', { wineId, blob });
      if (photoURLs[wineId]) URL.revokeObjectURL(photoURLs[wineId]);
      photoURLs[wineId] = URL.createObjectURL(blob);
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
