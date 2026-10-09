// Abgleich mit der Daten-Datei auf OneDrive (Datenformat.md, Abschnitt 9) – wie DataSync.kt in der App:
// 1. Daten-Datei laden (eTag merken)  2. zusammenführen  3. eigene Daten aktualisieren
// 4. hochladen, wenn sich etwas geändert hat – nur wenn die Datei noch dieselbe Version hat, sonst nochmals.

import { decode, encode } from './format.js';
import { merge, prune, sameContent } from './merge.js';
import { ConflictError } from './onedrive.js';

export const DATA_PATH = 'Apps/Tourenbuch/tourenbuch-daten.json';
const MAX_ATTEMPTS = 3;

/**
 * store: { load(), update(fn) } – die eigene Kopie; fn(aktuell) gibt das neue Dokument oder null zurück
 * drive: { readFile(path), writeFile(path, text, ifMatch) }
 * Ergebnis: { changedLocally, wrote }
 */
export function createSync({ store, drive, clock = () => Date.now(), deviceName = 'Web-App' }) {
  let running = null;
  let again = false;

  async function once() {
    for (let attempt = 1; ; attempt++) {
      const remoteFile = await drive.readFile(DATA_PATH);
      const remote = remoteFile ? decode(remoteFile.text) : null;
      const local = await store.load();
      const merged = prune(merge(local, remote), clock());

      // Während des Ladens kann der Benutzer etwas geändert haben: mit dem neusten Stand zusammenführen
      // (seine Änderung ist jünger und gewinnt; sie kommt beim nächsten Abgleich in die Datei)
      let changedLocally = false;
      await store.update((current) => {
        const newLocal = prune(merge(current, merged), clock());
        changedLocally = !sameContent(newLocal, current);
        return changedLocally ? newLocal : null;
      });

      if (remote && sameContent(merged, remote)) return { changedLocally, wrote: false };
      const text = encode({ ...merged, savedAt: clock(), savedBy: deviceName });
      try {
        await drive.writeFile(DATA_PATH, text, remoteFile?.eTag ?? null);
        return { changedLocally, wrote: true };
      } catch (e) {
        // Ein anderes Gerät war schneller: von vorne (mit dessen Stand)
        if (e instanceof ConflictError && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }

  /** Startet einen Abgleich. Läuft schon einer, folgt direkt danach ein weiterer. */
  function run() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        let result;
        do {
          again = false;
          result = await once();
        } while (again);
        return result;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { run, isRunning: () => running != null };
}
