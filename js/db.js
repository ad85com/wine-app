/* ============================================================
   db.js — tiny IndexedDB wrapper for the Cellar app
   Stores:
     wines   — active + finished wines (status: 'cellar' | 'finished')
     drinks  — one record per bottle drunk
     photos  — label images as Blobs, keyed by wine id
   ============================================================ */

const DB_NAME = 'cellar-db';
const DB_VERSION = 1;

const db = (() => {
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('wines')) {
          const s = d.createObjectStore('wines', { keyPath: 'id' });
          s.createIndex('status', 'status');
        }
        if (!d.objectStoreNames.contains('drinks')) {
          const s = d.createObjectStore('drinks', { keyPath: 'id' });
          s.createIndex('wineId', 'wineId');
        }
        if (!d.objectStoreNames.contains('photos')) {
          d.createObjectStore('photos', { keyPath: 'wineId' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
    get: (store, key) => open().then(d => new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    })),
    all: (store) => open().then(d => new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    })),
    clear: (store) => tx(store, 'readwrite', s => s.clear()),
  };
})();
