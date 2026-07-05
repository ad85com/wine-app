/* ============================================================
   sync.js — cross-device sync via Supabase
   - Email + one-time-code login (works inside the home-screen PWA)
   - Per-record sync of wines & drinks (last-write-wins on
     data.updatedAt), tombstones for deletions
   - Label photos stored in the private 'labels' storage bucket
   Relies on globals from app.js at runtime: wines, drinks,
   photoURLs, db, renderAll, toast.
   ============================================================ */

'use strict';

const SYNC = (() => {
  const cfg = window.CELLAR_CONFIG || {};
  let client = null;
  let session = null;
  let syncing = false;
  let debounceTimer = null;

  const LS = {
    wines: 'sync-dirty-wines',
    drinks: 'sync-dirty-drinks',
    photos: 'sync-dirty-photos',
    deleted: 'sync-deleted',
    lastPull: 'sync-last-pull',
    lastSync: 'sync-last-sync',
  };

  const loadSet = (k) => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
  const saveSet = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));

  const dirty = {
    wines: loadSet(LS.wines),
    drinks: loadSet(LS.drinks),
    photos: loadSet(LS.photos),
  };
  // deletions: [{store: 'wines'|'drinks', id, ts}]
  let deleted = JSON.parse(localStorage.getItem(LS.deleted) || '[]');

  function persist() {
    saveSet(LS.wines, dirty.wines);
    saveSet(LS.drinks, dirty.drinks);
    saveSet(LS.photos, dirty.photos);
    localStorage.setItem(LS.deleted, JSON.stringify(deleted));
  }

  /* ---------------- init ---------------- */
  async function init() {
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) { updateUI(); return; }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

    const { data } = await client.auth.getSession();
    session = data.session;
    client.auth.onAuthStateChange((_event, s) => {
      session = s;
      updateUI();
      if (s) requestSync();
    });

    window.addEventListener('online', requestSync);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) requestSync(); });
    setInterval(() => { if (!document.hidden && session) syncNow(); }, 60_000);

    updateUI();
    if (session) requestSync();
  }

  /* ---------------- dirty tracking (called from app.js) ---------------- */
  function markWine(id) { dirty.wines.add(id); persist(); requestSync(); }
  function markDrink(id) { dirty.drinks.add(id); persist(); requestSync(); }
  function markPhoto(id) { dirty.photos.add(id); persist(); requestSync(); }
  function markDeleted(store, id) {
    deleted.push({ store, id, ts: Date.now() });
    dirty.wines.delete(id);
    dirty.photos.delete(id);
    dirty.drinks.delete(id);
    persist();
    requestSync();
  }

  function requestSync() {
    if (!client || !session) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, 1500);
  }

  /* ---------------- core sync ---------------- */
  async function syncNow() {
    if (!client || !session || syncing || !navigator.onLine) return;
    syncing = true;
    updateUI('Syncing…');
    try {
      await pushDeletes();
      await pushRecords();
      await pushPhotos();
      await pull();
      localStorage.setItem(LS.lastSync, String(Date.now()));
      updateUI();
    } catch (e) {
      console.warn('sync failed', e);
      updateUI('Sync failed — will retry');
    } finally {
      syncing = false;
    }
  }

  async function pushDeletes() {
    if (!deleted.length) return;
    const batch = [...deleted];
    for (const d of batch) {
      const table = d.store === 'drinks' ? 'drinks' : 'wines';
      const { error } = await client.from(table).upsert({
        id: d.id,
        data: { deleted: true, updatedAt: d.ts },
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      if (table === 'wines') {
        await client.storage.from('labels').remove([`${session.user.id}/${d.id}.jpg`]);
      }
      deleted = deleted.filter(x => x !== d);
      persist();
    }
  }

  async function pushRecords() {
    for (const id of [...dirty.wines]) {
      const w = wines.find(x => x.id === id);
      if (!w) { dirty.wines.delete(id); persist(); continue; }
      const { error } = await client.from('wines').upsert({
        id, data: w, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      dirty.wines.delete(id);
      persist();
    }
    for (const id of [...dirty.drinks]) {
      const dr = drinks.find(x => x.id === id);
      if (!dr) { dirty.drinks.delete(id); persist(); continue; }
      const { error } = await client.from('drinks').upsert({
        id, data: { ...dr, updatedAt: dr.updatedAt || Date.now() }, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      dirty.drinks.delete(id);
      persist();
    }
  }

  async function pushPhotos() {
    for (const id of [...dirty.photos]) {
      const rec = await db.get('photos', id);
      if (!rec) { dirty.photos.delete(id); persist(); continue; }
      const { error } = await client.storage.from('labels')
        .upload(`${session.user.id}/${id}.jpg`, rec.blob, { upsert: true, contentType: 'image/jpeg' });
      if (error) throw error;
      dirty.photos.delete(id);
      persist();
    }
  }

  async function pull() {
    // 5-minute overlap window protects against clock skew between devices;
    // the merge below is idempotent so re-applying rows is harmless.
    const last = localStorage.getItem(LS.lastPull);
    const since = last ? new Date(new Date(last).getTime() - 5 * 60_000).toISOString() : '1970-01-01T00:00:00Z';

    const [wr, dr] = await Promise.all([
      client.from('wines').select('id,data,updated_at').gte('updated_at', since),
      client.from('drinks').select('id,data,updated_at').gte('updated_at', since),
    ]);
    if (wr.error) throw wr.error;
    if (dr.error) throw dr.error;

    let changed = false;
    let maxSeen = last || '1970-01-01T00:00:00Z';
    const photoCandidates = [];

    for (const row of wr.data) {
      if (row.updated_at > maxSeen) maxSeen = row.updated_at;
      const i = wines.findIndex(w => w.id === row.id);
      if (row.data && row.data.deleted) {
        if (i >= 0) {
          wines.splice(i, 1);
          await db.del('wines', row.id);
          await db.del('photos', row.id);
          if (photoURLs[row.id]) { URL.revokeObjectURL(photoURLs[row.id]); delete photoURLs[row.id]; }
          changed = true;
        }
      } else if (i < 0) {
        wines.push(row.data);
        await db.put('wines', row.data);
        photoCandidates.push(row.id);
        changed = true;
      } else if ((row.data.updatedAt || 0) > (wines[i].updatedAt || 0)) {
        wines[i] = row.data;
        await db.put('wines', row.data);
        if (!photoURLs[row.id]) photoCandidates.push(row.id);
        changed = true;
      }
    }

    for (const row of dr.data) {
      if (row.updated_at > maxSeen) maxSeen = row.updated_at;
      const i = drinks.findIndex(d => d.id === row.id);
      if (row.data && row.data.deleted) {
        if (i >= 0) { drinks.splice(i, 1); await db.del('drinks', row.id); changed = true; }
      } else if (i < 0) {
        drinks.push(row.data);
        await db.put('drinks', row.data);
        changed = true;
      }
    }

    // fetch label photos for new/updated wines that lack one locally
    for (const id of photoCandidates) {
      if (photoURLs[id]) continue;
      const { data: blob, error } = await client.storage.from('labels')
        .download(`${session.user.id}/${id}.jpg`);
      if (error || !blob) continue; // wine may simply have no photo
      await db.put('photos', { wineId: id, blob });
      photoURLs[id] = URL.createObjectURL(blob);
      changed = true;
    }

    localStorage.setItem(LS.lastPull, maxSeen);
    if (changed) renderAll();
  }

  /* ---------------- full first-time upload ---------------- */
  async function pushEverything() {
    for (const w of wines) dirty.wines.add(w.id);
    for (const d of drinks) dirty.drinks.add(d.id);
    const photos = await db.all('photos');
    for (const p of photos) dirty.photos.add(p.wineId);
    persist();
    await syncNow();
  }

  /* ---------------- auth ---------------- */
  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) {
      await pushEverything();
      return 'Signed in — syncing your cellar ✓';
    }
    if (/invalid login credentials/i.test(error.message || '')) {
      // no account yet (or wrong password) — try creating one
      const su = await client.auth.signUp({ email, password });
      if (su.error) {
        if (/already registered/i.test(su.error.message || '')) {
          throw new Error('Wrong password for this account');
        }
        throw su.error;
      }
      if (!su.data.session) {
        throw new Error('Account created — tap the confirmation link in your email, then sign in again');
      }
      await pushEverything();
      return 'Account created — syncing your cellar ✓';
    }
    throw error;
  }

  async function signOut() {
    await client.auth.signOut();
    session = null;
    updateUI();
  }

  /* ---------------- UI ---------------- */
  function updateUI(statusOverride) {
    const out = document.getElementById('sync-signedout');
    const sin = document.getElementById('sync-signedin');
    const line = document.getElementById('syncStatusLine');
    const unavailable = document.getElementById('sync-unavailable');
    if (!out || !sin) return;

    if (!client) {
      out.classList.add('hidden');
      sin.classList.add('hidden');
      if (unavailable) unavailable.classList.remove('hidden');
      return;
    }
    if (unavailable) unavailable.classList.add('hidden');

    if (session) {
      out.classList.add('hidden');
      sin.classList.remove('hidden');
      if (line) {
        if (statusOverride) line.textContent = statusOverride;
        else {
          const t = parseInt(localStorage.getItem(LS.lastSync) || '0', 10);
          line.textContent = `Syncing as ${session.user.email}` + (t ? ` · last sync ${new Date(t).toLocaleTimeString()}` : '');
        }
      }
    } else {
      out.classList.remove('hidden');
      sin.classList.add('hidden');
    }
  }

  /* ---------------- wire up settings controls ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('syncSignIn')?.addEventListener('click', async (e) => {
      const email = document.getElementById('syncEmail').value.trim();
      const password = document.getElementById('syncPassword').value;
      if (!email || !email.includes('@')) { toast('Enter your email first'); return; }
      if (!password || password.length < 6) { toast('Password needs at least 6 characters'); return; }
      e.target.disabled = true;
      e.target.textContent = 'Signing in…';
      try {
        toast(await signIn(email, password));
      } catch (err) {
        toast(err.message || String(err));
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Sign in / create account';
      }
    });

    document.getElementById('syncNow')?.addEventListener('click', () => {
      toast('Syncing…');
      syncNow();
    });

    document.getElementById('syncSignOut')?.addEventListener('click', async () => {
      await signOut();
      toast('Signed out — data stays on this device');
    });
  });

  return { init, markWine, markDrink, markPhoto, markDeleted, requestSync, syncNow, updateUI };
})();
