// World persistence. IndexedDB is used when available (it handles large modification
// maps well); localStorage is a transparent fallback so the game still saves in
// restricted contexts such as file:// pages or private windows.

const DB_NAME = 'blockforge-worlds';
const STORE = 'worlds';
const LS_PREFIX = 'blockforge:world:';
const LS_INDEX = 'blockforge:index';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Some browsers hang the request when storage is blocked
    setTimeout(() => resolve(req.readyState === 'done' ? req.result : null), 2500);
  });
  return dbPromise;
}

function lsIndex() {
  try { return JSON.parse(localStorage.getItem(LS_INDEX) || '[]'); } catch { return []; }
}

function lsWriteIndex(list) {
  try { localStorage.setItem(LS_INDEX, JSON.stringify(list)); } catch { /* quota */ }
}

export async function saveWorld(world) {
  world.updatedAt = Date.now();
  const db = await openDB();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(world);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch { /* fall through to localStorage */ }
  }
  try {
    localStorage.setItem(LS_PREFIX + world.id, JSON.stringify(world));
    const idx = lsIndex().filter((w) => w.id !== world.id);
    idx.push({ id: world.id, name: world.name, mode: world.mode, seed: world.seed, updatedAt: world.updatedAt });
    lsWriteIndex(idx);
    return true;
  } catch {
    return false;
  }
}

export async function loadWorld(id) {
  const db = await openDB();
  if (db) {
    try {
      const rec = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (rec) return rec;
    } catch { /* fall through */ }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function listWorlds() {
  const db = await openDB();
  let out = [];
  if (db) {
    try {
      out = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    } catch { out = []; }
  }
  if (!out.length) {
    out = lsIndex().map((meta) => {
      try { return JSON.parse(localStorage.getItem(LS_PREFIX + meta.id)) || meta; } catch { return meta; }
    });
  }
  return out
    .map((w) => ({ id: w.id, name: w.name, seed: w.seed, mode: w.mode, updatedAt: w.updatedAt || 0, createdAt: w.createdAt || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteWorld(id) {
  const db = await openDB();
  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch { /* ignore */ }
  }
  try {
    localStorage.removeItem(LS_PREFIX + id);
    lsWriteIndex(lsIndex().filter((w) => w.id !== id));
  } catch { /* ignore */ }
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('blockforge:settings') || '{}');
  } catch { return {}; }
}

export function saveSettings(s) {
  try { localStorage.setItem('blockforge:settings', JSON.stringify(s)); } catch { /* ignore */ }
}

export function newWorldId() {
  return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
