// Die eigene Kopie der Daten im Browser (IndexedDB). So geht alles auch ohne Internet.
// Gespeichert wird das ganze Dokument (gleiche Form wie die Daten-Datei) unter dem Schlüssel "doc".

import { emptyDocument } from './format.js';

const DB_NAME = 'tourenbuch';
const STORE = 'kv';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function get(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDocument() {
  return (await get('doc')) ?? emptyDocument();
}

export async function saveDocument(doc) {
  await put('doc', doc);
}

/** Kleine Angaben wie "zuletzt abgeglichen". */
export async function loadMeta() {
  return (await get('meta')) ?? {};
}

export async function saveMeta(patch) {
  await put('meta', { ...(await loadMeta()), ...patch });
}

/** Beim Abmelden: alle Daten dieses Browsers löschen (sie liegen ja auf OneDrive). */
export async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
