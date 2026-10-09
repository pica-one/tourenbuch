// Liest und schreibt die Daten-Datei im Datenformat Version 2 (siehe ../Datenformat.md).
// Im Speicher hat ein Dokument dieselbe Form wie die Datei:
//   { savedAt, savedBy, settings: { oneDriveRoot?, groupFolders? }, partners: [...], tours: [...] }
// Tour-Felder sind { value, changed }; fehlt ein Feld, ist es undefined.

export const FORMAT = 'tourenbuch-daten';
export const VERSION = 2;

export const TOUR_TYPES = ['BERGSTEIGEN', 'SKITOUR', 'BIKETOUR', 'KLETTERGARTEN', 'MSL_KLETTERN', 'WANDERN', 'KLETTERSTEIG', 'CUSTOM'];
export const ATTACHMENT_KINDS = ['TOPO', 'GPX'];
export const TOUR_FIELDS = ['tourType', 'customType', 'dates', 'mountain', 'routeName', 'rating', 'details', 'partners', 'oneDriveFolder'];

/** Verständlicher Fehler beim Lesen der Daten-Datei. */
export class FormatError extends Error {}

export function emptyDocument() {
  return { savedAt: 0, savedBy: null, settings: {}, partners: [], tours: [] };
}

export function isSyncDocument(text) {
  try {
    return JSON.parse(stripBom(text)).format === FORMAT;
  } catch {
    return false;
  }
}

export function encode(doc) {
  const settings = {};
  if (doc.settings.oneDriveRoot) settings.oneDriveRoot = stamped(doc.settings.oneDriveRoot);
  if (doc.settings.groupFolders) settings.groupFolders = stamped(doc.settings.groupFolders);
  const root = {
    format: FORMAT,
    version: VERSION,
    savedAt: doc.savedAt,
    ...(doc.savedBy != null ? { savedBy: doc.savedBy } : {}),
    settings,
    partners: doc.partners.map((p) => ({ name: p.name, favorite: stamped(p.favorite) })),
    tours: doc.tours.map(encodeTour),
  };
  return JSON.stringify(root, null, 1);
}

function stamped(s) {
  return { value: s.value ?? null, changed: s.changed };
}

function encodeTour(t) {
  const o = { id: t.id, created: t.created, deleted: t.deleted ?? null };
  if (t.deleted != null) return o; // gelöscht: nur die Notiz
  for (const f of TOUR_FIELDS) if (t[f]) o[f] = stamped(t[f]);
  o.photos = t.photos.map(encodeFile);
  o.attachments = t.attachments.map(encodeFile);
  return o;
}

function encodeFile(f) {
  if (f.deleted != null) return { id: f.id, deleted: f.deleted };
  return {
    id: f.id,
    ...(f.kind ? { kind: f.kind } : {}),
    fileName: f.fileName,
    oneDriveItemId: f.oneDriveItemId ?? null,
    oneDrivePath: f.oneDrivePath ?? null,
    added: f.added,
    deleted: null,
  };
}

/** Liest die Daten-Datei. Wirft FormatError mit verständlicher Meldung. */
export function decode(text) {
  let root;
  try {
    root = JSON.parse(stripBom(text));
  } catch {
    throw new FormatError('Die Daten-Datei ist beschädigt.');
  }
  if (!root || root.format !== FORMAT) throw new FormatError('Die Datei ist keine Tourenbuch-Daten-Datei.');
  if ((root.version ?? VERSION) > VERSION) {
    throw new FormatError('Die Daten stammen von einer neueren App-Version. Bitte zuerst die Web-App neu laden.');
  }
  const s = obj(root.settings) || {};
  const settings = {};
  const rootSetting = obj(s.oneDriveRoot);
  if (rootSetting && str(rootSetting.value) != null) settings.oneDriveRoot = { value: str(rootSetting.value), changed: num(rootSetting.changed) };
  const groupSetting = obj(s.groupFolders);
  if (groupSetting) settings.groupFolders = { value: typeof groupSetting.value === 'boolean' ? groupSetting.value : true, changed: num(groupSetting.changed) };

  const partners = [];
  for (const p of arr(root.partners)) {
    const name = str(p?.name)?.trim();
    const fav = obj(p?.favorite);
    if (!name || !fav) continue;
    partners.push({ name, favorite: { value: fav.value === true, changed: num(fav.changed) } });
  }

  const tours = arr(root.tours).map((t, i) => {
    try {
      return decodeTour(t);
    } catch {
      throw new FormatError(`Tour Nr. ${i + 1} in der Daten-Datei kann nicht gelesen werden.`);
    }
  });
  return { savedAt: num(root.savedAt), savedBy: str(root.savedBy), settings, partners, tours };
}

function decodeTour(t) {
  if (!obj(t)) throw new Error('keine Tour');
  const id = str(t.id);
  if (!id) throw new Error('id fehlt');
  const deleted = t.deleted == null ? null : num(t.deleted);
  const tour = { id, created: num(t.created), deleted, photos: [], attachments: [] };

  field(t, 'tourType', tour, (v) => (typeof v === 'string' ? (TOUR_TYPES.includes(v) ? v : 'CUSTOM') : undefined));
  field(t, 'customType', tour, (v) => (typeof v === 'string' ? v : null));
  field(t, 'dates', tour, (v) => {
    if (!obj(v) || !isDate(v.start)) return undefined;
    const end = isDate(v.end) ? v.end : v.start;
    return { start: v.start, end: end < v.start ? v.start : end };
  });
  field(t, 'mountain', tour, (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined));
  field(t, 'routeName', tour, (v) => (typeof v === 'string' && v.trim() ? v.trim() : null));
  field(t, 'rating', tour, (v) => Math.min(5, Math.max(0, typeof v === 'number' ? Math.trunc(v) : 0)));
  field(t, 'details', tour, (v) => (typeof v === 'string' && v.trim() ? v : null));
  field(t, 'partners', tour, (v) => (Array.isArray(v) ? v.filter((n) => typeof n === 'string').map((n) => n.trim()).filter(Boolean) : []));
  field(t, 'oneDriveFolder', tour, (v) => (obj(v) ? { path: str(v.path), id: str(v.id) } : null));

  tour.photos = arr(t.photos).map(decodeFile).filter(Boolean);
  tour.attachments = arr(t.attachments).map(decodeFile).filter(Boolean);

  if (deleted == null) {
    if (!tour.tourType) throw new Error('Tourenart fehlt');
    if (!tour.dates) throw new Error('Datum fehlt');
    if (!tour.mountain) throw new Error('Berg / Ort fehlt');
  }
  return tour;
}

/** Liest ein Feld { value, changed }; read() gibt undefined zurück, wenn der Wert unbrauchbar ist. */
function field(src, key, target, read) {
  const o = obj(src[key]);
  if (!o) return;
  const value = read(o.value ?? null);
  if (value !== undefined) target[key] = { value, changed: num(o.changed) };
}

function decodeFile(f) {
  if (!obj(f)) return null;
  const id = str(f.id);
  if (!id) return null;
  const deleted = f.deleted == null ? null : num(f.deleted);
  const itemId = str(f.oneDriveItemId);
  if (deleted == null && itemId == null) return null; // nur Dateien, die auf OneDrive liegen
  const kind = ATTACHMENT_KINDS.includes(f.kind) ? f.kind : null;
  return {
    id,
    fileName: str(f.fileName) ?? '',
    oneDriveItemId: itemId,
    oneDrivePath: str(f.oneDrivePath),
    added: num(f.added),
    deleted,
    ...(kind ? { kind } : {}),
  };
}

function stripBom(text) {
  return text.trim().replace(/^﻿/, '');
}
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function str(v) {
  return typeof v === 'string' ? v : null;
}
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}
function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
