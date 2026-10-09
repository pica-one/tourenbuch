// Fotos, Topos und GPX-Dateien zu OneDrive hochladen – der Reihe nach, wie PhotoUploader.kt in der App:
// Fotos in den Tour-Ordner (wird bei Bedarf angelegt), Topos/GPX in dessen Unterordner "Topos" bzw. "GPX".
// Die Dateien bleiben nur im Speicher: wird die Seite vorher geschlossen, müssen sie neu ausgewählt werden.

import { cleanFileName, DEFAULT_ROOT, photoFileName, tourFolderPath } from './naming.js';
import { AuthError, BusyError } from './onedrive.js';
import { addFile, setFolder } from './tourbook.js';

export const KIND_FOLDER = { TOPO: 'Topos', GPX: 'GPX' };

export function createUploader({ book, drive, onChange = () => {}, onFinished = () => {}, clock = () => Date.now() }) {
  const queue = []; // { tourId, file, kind }
  let running = false;
  let current = null; // { tourId, name, progress }
  let uploaded = 0;
  const failed = []; // { tourId, name, reason, job }
  let stopReason = null;

  function add(tourId, files, kind = null) {
    for (const file of files) queue.push({ tourId, file, kind });
    stopReason = null;
    onChange();
    if (!running) process();
  }

  function retryFailed() {
    const jobs = failed.splice(0).map((f) => f.job);
    if (jobs.length) {
      queue.push(...jobs);
      stopReason = null;
      if (!running) process();
    }
    onChange();
  }

  async function process() {
    running = true;
    uploaded = 0;
    try {
      while (queue.length) {
        const job = queue.shift();
        current = { tourId: job.tourId, name: job.file.name, progress: 0 };
        onChange();
        try {
          if (await uploadOne(job)) uploaded++;
        } catch (e) {
          console.error(e);
          if (e instanceof AuthError || e instanceof BusyError) {
            // Anmeldung abgelaufen oder kein Internet: alle restlichen warten auf "Nochmals versuchen"
            stopReason = e instanceof AuthError ? 'Anmeldung abgelaufen.' : 'Keine Verbindung zu OneDrive.';
            for (const j of [job, ...queue.splice(0)]) failed.push({ tourId: j.tourId, name: j.file.name, reason: stopReason, job: j });
          } else {
            failed.push({ tourId: job.tourId, name: job.file.name, reason: e.message || String(e), job });
          }
        }
      }
    } finally {
      running = false;
      current = null;
      onChange();
      onFinished(uploaded);
    }
  }

  /** true = hochgeladen, false = übersprungen (Tour inzwischen gelöscht) */
  async function uploadOne({ tourId, file, kind }) {
    const doc = book.current();
    const tour = doc.tours.find((t) => t.id === tourId && t.deleted == null);
    if (!tour) return false;
    const folder = tour.oneDriveFolder?.value ?? null;
    const folderPath =
      folder?.path ??
      tourFolderPath(
        doc.settings.oneDriveRoot?.value ?? DEFAULT_ROOT,
        tour.tourType.value,
        tour.mountain.value,
        tour.dates.value.start,
        tour.routeName?.value,
        doc.settings.groupFolders?.value ?? true,
      );
    let name;
    if (kind) name = `${KIND_FOLDER[kind]}/${cleanFileName(file.name) ?? `${kind === 'TOPO' ? 'Topo' : 'GPX'}_${clock()}`}`;
    else {
      const number = tour.photos.filter((p) => p.deleted == null).length + 1;
      name = cleanFileName(file.name) ?? photoFileName(tour.mountain.value, tour.dates.value.start, number, file.type);
    }

    const progress = (p) => {
      current = { ...current, progress: p };
      onChange();
    };
    let item;
    if (folder?.id) {
      try {
        item = await drive.upload({ folderId: folder.id, name }, file, progress);
      } catch (e) {
        if (e.status !== 404) throw e;
        // Ordner gibt es nicht mehr: über den Pfad neu anlegen
      }
    }
    if (!item) item = await drive.upload({ path: `${folderPath}/${name}` }, file, progress);

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
      return next;
    });
    return true;
  }

  return {
    add,
    retryFailed,
    clearFailed() {
      failed.splice(0);
      onChange();
    },
    isRunning: () => running,
    /** Stand für die Anzeige */
    status() {
      return { running, current, waiting: queue.length, uploaded, failed: [...failed], stopReason };
    },
  };
}

function parentOf(path) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
