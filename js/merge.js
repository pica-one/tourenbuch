// Führt die eigenen Daten und die Daten-Datei zusammen (Regeln siehe Datenformat.md, Abschnitt 9).
// Gleiche Regeln wie SyncMerger.kt in der Android-App:
// - Tour nur auf einer Seite: wird übernommen
// - Tour auf beiden Seiten: pro Feld gewinnt die jüngere Änderung, bei gleicher Zeit die Daten-Datei
// - gelöscht: bleibt gelöscht (frühester Zeitpunkt)
// - Fotos/Anhänge: Vereinigung über die Kennung; gleiches OneDrive-Element = ein Eintrag (ältere Kennung bleibt)

import { TOUR_FIELDS } from './format.js';

/** Löschnotizen, die älter sind, werden weggelassen (180 Tage). */
export const TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export function merge(local, remote) {
  if (!remote) return local;
  const localTours = new Map(local.tours.map((t) => [t.id, t]));
  const remoteTours = new Map(remote.tours.map((t) => [t.id, t]));
  const ids = [...new Set([...local.tours.map((t) => t.id), ...remote.tours.map((t) => t.id)])];
  const settings = {};
  for (const key of ['oneDriveRoot', 'groupFolders']) {
    const s = pick(local.settings[key], remote.settings[key]);
    if (s) settings[key] = s;
  }
  return {
    savedAt: Math.max(local.savedAt, remote.savedAt),
    savedBy: local.savedBy ?? remote.savedBy,
    settings,
    partners: mergePartners(local.partners, remote.partners),
    tours: ids.map((id) => mergeTour(localTours.get(id), remoteTours.get(id))),
  };
}

/** Jüngere Änderung gewinnt; bei gleicher Zeit die Daten-Datei (remote). */
export function pick(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  return local.changed > remote.changed ? local : remote;
}

function mergeTour(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const created = [local.created, remote.created].filter((c) => c > 0);
  const deleted = [local.deleted, remote.deleted].filter((d) => d != null);
  const tour = {
    id: local.id,
    created: created.length ? Math.min(...created) : 0,
    deleted: deleted.length ? Math.min(...deleted) : null,
    photos: mergeFiles(local.photos, remote.photos),
    attachments: mergeFiles(local.attachments, remote.attachments),
  };
  for (const f of TOUR_FIELDS) {
    const v = pick(local[f], remote[f]);
    if (v) tour[f] = v;
  }
  return tour;
}

/** Vereinigung über die Kennung; danach gleiche OneDrive-Elemente zu einem Eintrag zusammenfassen. */
export function mergeFiles(local, remote) {
  const byId = new Map();
  for (const f of [...remote, ...local]) {
    const other = byId.get(f.id);
    byId.set(f.id, other ? combine(other, f) : f);
  }
  const result = [];
  const byItem = new Map();
  for (const f of byId.values()) {
    if (f.oneDriveItemId == null) result.push(f);
    else {
      if (!byItem.has(f.oneDriveItemId)) byItem.set(f.oneDriveItemId, []);
      byItem.get(f.oneDriveItemId).push(f);
    }
  }
  // Gleiches OneDrive-Element unter verschiedenen Kennungen (z. B. zwei Geräte haben denselben Ordner abgeglichen)
  for (const same of byItem.values()) {
    const deleted = same.map((f) => f.deleted).filter((d) => d != null);
    const live = same.filter((f) => f.deleted == null);
    // Nach dem Entfernen wieder hinzugefügt (z. B. "Mit OneDrive abgleichen")? Dann ist es wieder da.
    const readded = live.length > 0 && deleted.length > 0 && Math.max(...live.map((f) => f.added)) > Math.max(...deleted);
    if (readded || !deleted.length) {
      result.push(oldest(live));
    } else {
      result.push({ ...oldest(same), deleted: Math.min(...deleted) });
    }
  }
  return result.sort((a, b) => a.added - b.added || cmp(a.fileName, b.fileName) || cmp(a.id, b.id));
}

function addedKey(f) {
  return f.added > 0 ? f.added : Number.MAX_SAFE_INTEGER;
}

/** Ältester Eintrag (die ältere Kennung bleibt). */
function oldest(list) {
  return [...list].sort((a, b) => addedKey(a) - addedKey(b) || cmp(a.id, b.id))[0];
}

/** Dasselbe Foto auf beiden Seiten: Angaben ergänzen, gelöscht bleibt gelöscht. */
function combine(a, b) {
  const added = [a.added, b.added].filter((x) => x > 0);
  const deleted = [a.deleted, b.deleted].filter((d) => d != null);
  const kind = a.kind ?? b.kind;
  return {
    id: a.id,
    fileName: a.fileName || b.fileName,
    oneDriveItemId: a.oneDriveItemId ?? b.oneDriveItemId,
    oneDrivePath: a.oneDrivePath ?? b.oneDrivePath,
    added: added.length ? Math.min(...added) : 0,
    deleted: deleted.length ? Math.min(...deleted) : null,
    ...(kind ? { kind } : {}),
  };
}

function mergePartners(local, remote) {
  const result = new Map();
  for (const p of [...remote, ...local]) {
    const key = p.name.trim().toLowerCase();
    const other = result.get(key);
    if (!other || p.favorite.changed > other.favorite.changed) result.set(key, p);
  }
  return [...result.values()];
}

/** Lässt Löschnotizen weg, die älter als TOMBSTONE_MAX_AGE_MS sind. */
export function prune(doc, now) {
  const limit = now - TOMBSTONE_MAX_AGE_MS;
  const keep = (x) => x.deleted == null || x.deleted >= limit;
  return {
    ...doc,
    tours: doc.tours.filter(keep).map((t) => ({ ...t, photos: t.photos.filter(keep), attachments: t.attachments.filter(keep) })),
  };
}

/** Gleicher Inhalt? (savedAt/savedBy und Reihenfolge zählen nicht) */
export function sameContent(a, b) {
  return canonical(a) === canonical(b);
}

function canonical(doc) {
  const byId = (x, y) => cmp(x.id, y.id);
  const norm = {
    settings: doc.settings,
    partners: [...doc.partners].sort((x, y) => cmp(x.name.toLowerCase(), y.name.toLowerCase())),
    tours: [...doc.tours].sort(byId).map((t) =>
      t.deleted != null
        ? { id: t.id, created: t.created, deleted: t.deleted }
        : { ...t, photos: [...t.photos].sort(byId), attachments: [...t.attachments].sort(byId) },
    ),
  };
  return stableStringify(norm);
}

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
