// Fotos, Topos und GPX-Dateien zu OneDrive hochladen, wie PhotoUploader.kt in der App:
// Fotos in den Tour-Ordner (wird bei Bedarf angelegt), Topos/GPX in dessen Unterordner "Topos" bzw. "GPX".
// Schneller: bis zu 3 Dateien gleichzeitig (wie im LifePhotoBook). Ausnahme: Hat die Tour noch keinen Ordner auf
// OneDrive, geht zuerst eine Datei allein (sie legt den Ordner an), damit nicht zwei Ordner entstehen; ebenso
// nur ein Topo bzw. ein GPX gleichzeitig pro Tour (Unterordner "Topos"/"GPX").
// Die Dateien bleiben nur im Speicher: wird die Seite vorher geschlossen, müssen sie neu ausgewählt werden.
// Zusätzlich: Fotos, die schon auf OneDrive liegen (aus der OneDrive-App am Handy, Ordner "Eigene Aufnahmen"),
// werden auf OneDrive in den Tour-Ordner KOPIERT (addCopies). So bleibt der Aufnahmeort, den Android beim
// Hochladen aus dem Browser entfernt. Das Original bleibt, wo es ist. Gleicher Name + gleiche Grösse schon im
// Tour-Ordner → nicht nochmals kopiert ("schon vorhanden"); gleicher Name, andere Grösse → "Name 1.jpg".

import {
  cleanFileName,
  mountainBase,
  mountainFolderFromListing,
  mountainFolderFromTours,
  mountainFolderName,
  photoFileName,
  storageSettings,
  tourFolderName,
} from './naming.js';
import { AuthError, BusyError } from './onedrive.js';
import { addFile, setFolder, setSetting } from './tourbook.js';

export const KIND_FOLDER = { TOPO: 'Topos', GPX: 'GPX' };

export const PARALLEL_UPLOADS = 3;

export function createUploader({ book, drive, onChange = () => {}, onFinished = () => {}, clock = () => Date.now(), parallel = PARALLEL_UPLOADS }) {
  const queue = []; // { tourId, file, kind } oder { tourId, source, kind: null } (Kopie auf OneDrive)
  const active = new Map(); // job → { tourId, name, progress }
  let running = false;
  let uploaded = 0;
  let existing = 0; // Kopien, die schon im Tour-Ordner waren
  const failed = []; // { tourId, name, reason, job }
  let stopReason = null;

  function add(tourId, files, kind = null) {
    for (const file of files) queue.push({ tourId, file, kind });
    stopReason = null;
    onChange();
    pump();
  }

  /** Fotos von OneDrive (source: { id, name, size, mimeType, driveId }) in den Tour-Ordner kopieren. */
  function addCopies(tourId, sources) {
    for (const source of sources) queue.push({ tourId, source, kind: null });
    stopReason = null;
    onChange();
    pump();
  }

  function retryFailed() {
    const jobs = failed.splice(0).map((f) => f.job);
    if (jobs.length) {
      queue.push(...jobs);
      stopReason = null;
      pump();
    }
    onChange();
  }

  /** Darf diese Datei jetzt starten? (Neuer Tour-Ordner bzw. Unterordner Topos/GPX: nur eine Datei aufs Mal) */
  function mayStart(job) {
    const same = [...active.keys()].filter((j) => j.tourId === job.tourId);
    if (!same.length) return true;
    const tour = book.current().tours.find((t) => t.id === job.tourId);
    if (!tour?.oneDriveFolder?.value?.id) return false;
    return !job.kind || !same.some((j) => j.kind === job.kind);
  }

  /** Startet so viele Dateien wie erlaubt; wenn keine mehr läuft, ist alles fertig. */
  function pump() {
    while (active.size < Math.max(1, parallel)) {
      const i = queue.findIndex(mayStart);
      if (i < 0) break;
      const job = queue.splice(i, 1)[0];
      if (!running) {
        running = true;
        uploaded = 0;
        existing = 0;
      }
      active.set(job, { tourId: job.tourId, name: jobName(job), progress: 0, copy: !!job.source });
      run(job);
    }
    onChange();
    if (running && active.size === 0) {
      running = false;
      onChange();
      onFinished(uploaded, { existing });
    }
  }

  async function run(job) {
    try {
      const result = await uploadOne(job);
      if (result === 'exists') existing++;
      else if (result) uploaded++;
    } catch (e) {
      console.error(e);
      if (e instanceof AuthError || e instanceof BusyError) {
        // Anmeldung abgelaufen oder kein Internet: alle restlichen warten auf "Nochmals versuchen"
        stopReason = e instanceof AuthError ? 'Anmeldung abgelaufen.' : 'Keine Verbindung zu OneDrive.';
        for (const j of [job, ...queue.splice(0)]) failed.push({ tourId: j.tourId, name: jobName(j), reason: stopReason, job: j });
      } else {
        failed.push({ tourId: job.tourId, name: jobName(job), reason: e.message || String(e), job });
      }
    } finally {
      active.delete(job);
      pump();
    }
  }

  /**
   * Ordner für eine Tour, die noch keinen hat. Gibt es den Berg-Ordner schon (auch anders geschrieben,
   * z. B. "Foehnmauer" für "Föhnmauer"), kommt die Tour dort hinein – zuerst aus früheren Touren, sonst auf OneDrive gesucht.
   */
  async function newTourFolderPath(doc, tour, storage) {
    const mountain = tour.mountain.value;
    const base = mountainBase(storage.root, tour.tourType.value, storage.groupFolders);
    const known = doc.tours
      .filter((t) => t.deleted == null && t.id !== tour.id && t.oneDriveFolder?.value?.path)
      .map((t) => ({ path: t.oneDriveFolder.value.path, start: t.dates?.value?.start }));
    let dir = mountainFolderFromTours(known, base, mountain);
    if (!dir && drive.listChildrenByPath) dir = mountainFolderFromListing(await drive.listChildrenByPath(base), base, mountain);
    return `${dir ?? `${base}/${mountainFolderName(mountain)}`}/${tourFolderName(tour.dates.value.start, tour.routeName?.value)}`;
  }

  /** true = hochgeladen/kopiert, 'exists' = Kopie war schon da, false = übersprungen (Tour inzwischen gelöscht) */
  async function uploadOne(job) {
    const { tourId, kind, source } = job;
    const file = job.file ?? { name: source.name, type: source.mimeType ?? '' };
    const doc = book.current();
    const tour = doc.tours.find((t) => t.id === tourId && t.deleted == null);
    if (!tour) return false;
    const folder = tour.oneDriveFolder?.value ?? null;
    const storage = storageSettings(doc);
    const folderPath = folder?.path ?? (await newTourFolderPath(doc, tour, storage));
    let name;
    if (kind) name = `${KIND_FOLDER[kind]}/${cleanFileName(file.name) ?? `${kind === 'TOPO' ? 'Topo' : 'GPX'}_${clock()}`}`;
    else {
      // Nummer: auch die Fotos zählen, die gerade gleichzeitig hochgeladen werden
      const before = [...active.keys()].filter((j) => j !== job && j.tourId === tourId && !j.kind).length;
      const number = tour.photos.filter((p) => p.deleted == null).length + before + 1;
      name = cleanFileName(file.name) ?? photoFileName(tour.mountain.value, tour.dates.value.start, number, file.type);
    }

    const progress = (p) => {
      if (active.has(job)) active.set(job, { ...active.get(job), progress: p });
      onChange();
    };
    let item;
    let already = false;
    if (source) ({ item, already } = await copyOne(source, name, folder, folderPath));
    else if (folder?.id) {
      try {
        item = await drive.upload({ folderId: folder.id, name }, file, progress);
      } catch (e) {
        if (e.status !== 404) throw e;
        // Ordner gibt es nicht mehr: über den Pfad neu anlegen
      }
    }
    if (!item) item = await drive.upload({ path: `${folderPath}/${name}` }, file, progress);
    if (source) progress(1);

    const now = clock();
    await book.update((d) => {
      let next = addFile(d, tourId, { fileName: item.name, oneDriveItemId: item.id, oneDrivePath: item.path }, kind, now);
      const t = next.tours.find((x) => x.id === tourId);
      const known = t?.oneDriveFolder?.value;
      if (!kind && (!known?.id || item.parentId !== known.id)) {
        // Ordner der Tour merken – weitere Fotos landen immer hier
        next = setFolder(next, tourId, parentOf(item.path), item.parentId, now);
      } else if (kind && !known?.path) {
        // Tour-Ordner = Ordner oberhalb von "Topos"/"GPX" (seine Nummer kommt mit dem ersten Foto)
        next = setFolder(next, tourId, parentOf(parentOf(item.path)), null, now);
      }
      // Erstes Hochladen eines neuen Kontos: verwendeten Ablageordner fest eintragen (ändert sich so nie von selbst)
      if (!next.settings.oneDriveRoot) next = setSetting(next, 'oneDriveRoot', storage.root, now);
      if (!next.settings.groupFolders) next = setSetting(next, 'groupFolders', storage.groupFolders, now);
      return next;
    });
    return already ? 'exists' : true;
  }

  /** Kopie auf OneDrive in den Tour-Ordner (legt ihn bei Bedarf an). Ergebnis: { item, already } */
  async function copyOne(source, name, folder, folderPath) {
    let folderId = folder?.id ?? (await drive.ensureFolder(folderPath));
    for (let attempt = 0; ; attempt++) {
      try {
        for (let n = 0; n < 50; n++) {
          const candidate = numberedName(name, n);
          const there = await drive.itemInFolder(folderId, candidate);
          if (!there) return { item: await drive.copyInto(source.id, folderId, candidate, source.driveId ?? null), already: false };
          if (source.size != null && there.size === source.size) return { item: there, already: true };
        }
        throw new Error('Zu viele Dateien mit diesem Namen.');
      } catch (e) {
        // Ordner der Tour gibt es nicht mehr: über den Pfad neu anlegen (einmal)
        if (e.status !== 404 || attempt > 0 || !folder?.id) throw e;
        folderId = await drive.ensureFolder(folderPath);
      }
    }
  }

  return {
    add,
    addCopies,
    retryFailed,
    clearFailed() {
      failed.splice(0);
      onChange();
    },
    isRunning: () => running,
    /** Stand für die Anzeige */
    status() {
      const list = [...active.values()];
      return { running, active: list, current: list[0] ?? null, waiting: queue.length, uploaded, existing, failed: [...failed], stopReason };
    },
  };
}

function jobName(job) {
  return job.file?.name ?? job.source?.name ?? '';
}

/** "IMG_1.jpg", 2 → "IMG_1 2.jpg" (wie OneDrive bei gleichen Namen) */
export function numberedName(name, n) {
  if (!n) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}

function parentOf(path) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
