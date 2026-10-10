// Das Tourenbuch im Speicher: lädt die eigene Kopie einmal, führt Änderungen der Reihe nach aus
// (nie zwei gleichzeitig) und speichert sie im Browser. Bildschirme werden über subscribe() informiert.

import { TOUR_FIELDS } from './format.js';

export function createTourBook(persist) {
  let doc = null;
  let queue = Promise.resolve();
  const listeners = new Set();

  async function load() {
    if (!doc) doc = await persist.loadDocument();
    return doc;
  }

  /** fn(aktuell) gibt das neue Dokument zurück oder null (keine Änderung). */
  function update(fn) {
    const next = queue.then(async () => {
      const current = await load();
      const changed = fn(current);
      if (changed) {
        doc = changed;
        await persist.saveDocument(doc);
        listeners.forEach((l) => l(doc));
      }
      return doc;
    });
    queue = next.catch(() => {});
    return next;
  }

  return {
    load,
    update,
    current: () => doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------- Änderungen an Touren (reine Funktionen, gut testbar) ----------

export function newId() {
  return crypto.randomUUID();
}

/** Neue Tour: alle Felder bekommen die aktuelle Zeit. values = { tourType, customType, dates, mountain, ... } */
export function addTour(doc, values, now, id = newId()) {
  const tour = { id, created: now, deleted: null, photos: [], attachments: [] };
  for (const f of TOUR_FIELDS) {
    const v = f in values ? values[f] : f === 'rating' ? 0 : f === 'partners' ? [] : null;
    tour[f] = { value: v, changed: now };
  }
  return { ...doc, tours: [...doc.tours, tour] };
}

/** Tour ändern: nur Felder, die wirklich anders sind, bekommen eine neue Zeit. */
export function editTour(doc, id, values, now) {
  let found = false;
  const tours = doc.tours.map((t) => {
    if (t.id !== id || t.deleted != null) return t;
    found = true;
    const copy = { ...t };
    for (const [f, v] of Object.entries(values)) {
      if (!TOUR_FIELDS.includes(f)) continue;
      if (!sameValue(f, t[f]?.value, v)) copy[f] = { value: v, changed: now };
    }
    return copy;
  });
  return found ? { ...doc, tours } : doc;
}

/** Tour löschen: es bleibt eine kurze Löschnotiz (damit andere Geräte davon erfahren). */
export function deleteTour(doc, id, now) {
  return {
    ...doc,
    tours: doc.tours.map((t) => (t.id === id && t.deleted == null ? { id: t.id, created: t.created, deleted: now, photos: [], attachments: [] } : t)),
  };
}

/** Hochgeladenes Foto (kind = null) oder Topo/GPX (kind = 'TOPO'/'GPX') zur Tour hinzufügen. */
export function addFile(doc, tourId, { fileName, oneDriveItemId, oneDrivePath }, kind, now, id = newId()) {
  const entry = { id, fileName, oneDriveItemId, oneDrivePath, added: now, deleted: null, ...(kind ? { kind } : {}) };
  const key = kind ? 'attachments' : 'photos';
  return mapTour(doc, tourId, (t) => (t[key].some((f) => f.oneDriveItemId === oneDriveItemId && f.deleted == null) ? t : { ...t, [key]: [...t[key], entry] }));
}

/** Foto/Anhang aus der Tour entfernen (die Datei auf OneDrive bleibt). */
export function removeFile(doc, tourId, fileId, now) {
  const mark = (list) => list.map((f) => (f.id === fileId && f.deleted == null ? { ...f, deleted: now } : f));
  return mapTour(doc, tourId, (t) => ({ ...t, photos: mark(t.photos), attachments: mark(t.attachments) }));
}

/** Ordner der Tour auf OneDrive merken (mit Zeit, damit der Abgleich ihn auf die anderen Geräte bringt). */
export function setFolder(doc, tourId, path, folderId, now) {
  return mapTour(doc, tourId, (t) =>
    t.oneDriveFolder?.value?.path === path && t.oneDriveFolder?.value?.id === folderId ? t : { ...t, oneDriveFolder: { value: { path, id: folderId }, changed: now } },
  );
}

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', '3gp', 'webm', 'mkv', 'avi'];

function extensionOf(name) {
  const n = String(name ?? '');
  return n.includes('.') ? n.split('.').pop().toLowerCase() : '';
}

export function isPhotoItem(item) {
  return (item.mimeType ?? '').startsWith('image/') || PHOTO_EXTENSIONS.includes(extensionOf(item.name));
}

/** Videos stehen in der Daten-Datei bei den Fotos; erkannt werden sie an der Endung (siehe Datenformat.md). */
export function isVideoName(name) {
  return VIDEO_EXTENSIONS.includes(extensionOf(name));
}

export function isVideoItem(item) {
  return (item.mimeType ?? '').startsWith('video/') || isVideoName(item.name);
}

/** Foto oder Video (gehört in die Foto-Liste einer Tour). */
export function isMediaItem(item) {
  return isPhotoItem(item) || isVideoItem(item);
}

/**
 * Tour mit ihrem OneDrive-Ordner abgleichen (wie OneDriveSync.kt in der App): Dateien, die neu im Ordner liegen,
 * kommen dazu; was dort gelöscht wurde, wird aus der Tour entfernt. Auf OneDrive wird nichts verändert.
 * online = { photos: [items im Tour-Ordner], TOPO: [items in "Topos"], GPX: [items in "GPX"] }
 * item = { id, name, mimeType?, takenDateTime? }
 */
export function reconcileFolder(doc, tourId, rawOnline, now) {
  const result = { doc, added: 0, removed: 0, addedFiles: 0, removedFiles: 0 };
  // Leere Dateien (0 Byte) sind abgebrochene Uploads: OneDrive zeigt sie nicht an, also auch nicht übernehmen
  const real = (list) => (list ?? []).filter((i) => i.size !== 0);
  const online = { photos: real(rawOnline.photos), TOPO: real(rawOnline.TOPO), GPX: real(rawOnline.GPX) };
  const tour = doc.tours.find((t) => t.id === tourId && t.deleted == null);
  if (!tour) return result;
  const folderPath = tour.oneDriveFolder?.value?.path;
  let next = doc;

  const photos = online.photos.filter(isMediaItem);
  const knownPhotoIds = new Set(tour.photos.filter((p) => p.deleted == null).map((p) => p.oneDriveItemId));
  const onlinePhotoIds = new Set(photos.map((p) => p.id));
  const newPhotos = photos
    .filter((p) => !knownPhotoIds.has(p.id))
    .sort((a, b) => cmp(a.takenDateTime ?? '~', b.takenDateTime ?? '~') || cmp(a.name, b.name));
  for (const p of newPhotos) {
    next = addFile(next, tourId, { fileName: p.name, oneDriveItemId: p.id, oneDrivePath: folderPath ? `${folderPath}/${p.name}` : null }, null, now);
  }
  const gonePhotos = tour.photos.filter((p) => p.deleted == null && p.oneDriveItemId && !onlinePhotoIds.has(p.oneDriveItemId));
  for (const p of gonePhotos) next = removeFile(next, tourId, p.id, now);
  result.added = newPhotos.length;
  result.removed = gonePhotos.length;

  for (const [kind, sub] of [['TOPO', 'Topos'], ['GPX', 'GPX']]) {
    const files = online[kind] ?? [];
    const mine = tour.attachments.filter((a) => a.deleted == null && a.kind === kind);
    const mineIds = new Set(mine.map((a) => a.oneDriveItemId));
    const onlineIds = new Set(files.map((f) => f.id));
    for (const f of files.filter((f) => !mineIds.has(f.id)).sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()))) {
      next = addFile(next, tourId, { fileName: f.name, oneDriveItemId: f.id, oneDrivePath: folderPath ? `${folderPath}/${sub}/${f.name}` : null }, kind, now);
      result.addedFiles++;
    }
    for (const a of mine.filter((a) => a.oneDriveItemId && !onlineIds.has(a.oneDriveItemId))) {
      next = removeFile(next, tourId, a.id, now);
      result.removedFiles++;
    }
  }
  result.doc = next;
  return result;
}

/** Ergebnis in Worten (wie syncResultText in der App). */
export function reconcileText(r) {
  const parts = [
    r.added && (r.added === 1 ? '1 neues Foto übernommen' : `${r.added} neue Fotos übernommen`),
    r.removed && (r.removed === 1 ? '1 auf OneDrive gelöschtes Foto entfernt' : `${r.removed} auf OneDrive gelöschte Fotos entfernt`),
    r.addedFiles && (r.addedFiles === 1 ? '1 neue Datei (Topo/GPX) übernommen' : `${r.addedFiles} neue Dateien (Topo/GPX) übernommen`),
    r.removedFiles && (r.removedFiles === 1 ? '1 gelöschte Datei (Topo/GPX) entfernt' : `${r.removedFiles} gelöschte Dateien (Topo/GPX) entfernt`),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') + '.' : 'Alles aktuell – nichts Neues auf OneDrive.';
}

function mapTour(doc, tourId, fn) {
  return { ...doc, tours: doc.tours.map((t) => (t.id === tourId && t.deleted == null ? fn(t) : t)) };
}

/** Partner als Favorit markieren oder nicht. */
export function setFavorite(doc, name, favorite, now) {
  const key = name.trim().toLowerCase();
  const others = doc.partners.filter((p) => p.name.trim().toLowerCase() !== key);
  return { ...doc, partners: [...others, { name: name.trim(), favorite: { value: favorite, changed: now } }] };
}

/** Die (höchstens 5) Favoriten, zuletzt markierte zuerst gezählt. */
export function favorites(doc) {
  return doc.partners
    .filter((p) => p.favorite.value)
    .sort((a, b) => b.favorite.changed - a.favorite.changed)
    .slice(0, 5)
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/** Gemeinsame Einstellung ändern (Ablageordner, Sammelordner). */
export function setSetting(doc, key, value, now) {
  if (doc.settings[key]?.value === value) return doc;
  return { ...doc, settings: { ...doc.settings, [key]: { value, changed: now } } };
}

function sameValue(field, a, b) {
  if (field === 'partners') {
    const norm = (l) => (l ?? []).map((n) => n.trim().toLowerCase()).sort().join('\n');
    return norm(a) === norm(b);
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Sichtbare Touren, neueste zuerst. */
export function visibleTours(doc) {
  return doc.tours
    .filter((t) => t.deleted == null)
    .sort((a, b) => cmp(b.dates.value.start, a.dates.value.start) || b.created - a.created);
}

/** Alle Partnernamen (aus den Touren), für Vorschläge. */
export function allPartnerNames(doc) {
  const names = new Map();
  for (const t of doc.tours) for (const n of t.partners?.value ?? []) names.set(n.toLowerCase(), n);
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
