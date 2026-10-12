// Thin promise wrapper over IndexedDB.
// Stores: subjects (WK + custom content), cards (SRS state), logs (review history), kv (settings/meta).

const NAME = 'jp-srs';
const VERSION = 1;
let dbp;

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('subjects', { keyPath: 'id' });
      db.createObjectStore('cards', { keyPath: 'id' });
      const logs = db.createObjectStore('logs', { keyPath: 'n', autoIncrement: true });
      logs.createIndex('ts', 'ts');
      logs.createIndex('card', 'card');
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

export async function getAll(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const req = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
  const result = await done(req);
  await txDone(tx);
  return result;
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function delMany(store, keys) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  for (const k of keys) tx.objectStore(store).delete(k);
  await txDone(tx);
}

export async function clear(...stores) {
  const db = await open();
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
}

export async function logsSince(ts) {
  const db = await open();
  const idx = db.transaction('logs').objectStore('logs').index('ts');
  return done(idx.getAll(IDBKeyRange.lowerBound(ts)));
}

export async function logsForCard(cardId) {
  const db = await open();
  return done(db.transaction('logs').objectStore('logs').index('card').getAll(cardId));
}

export async function addLog(log) {
  return put('logs', log);
}

// Atomically write a card and its log entry; returns the log key (for undo).
export async function commitReview(card, log) {
  const db = await open();
  const tx = db.transaction(['cards', 'logs'], 'readwrite');
  tx.objectStore('cards').put(card);
  const req = tx.objectStore('logs').add(log);
  const key = await done(req);
  await txDone(tx);
  return key;
}

export async function undoReview(prevCard, logKey) {
  const db = await open();
  const tx = db.transaction(['cards', 'logs'], 'readwrite');
  tx.objectStore('cards').put(prevCard);
  tx.objectStore('logs').delete(logKey);
  await txDone(tx);
}
