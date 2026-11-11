// Sicherung auf OneDrive – gleich wie in der Android-App (OneDriveBackup.kt):
// Ordner "<Ablageordner>/Tourenbuch_Backups" mit
// - "tourenbuch-sicherung-aktuell.json": immer der neueste Stand (wird jedes Mal ersetzt)
// - "tourenbuch-sicherung-JJJJ-MM.json": ein Stand pro Monat (wird im selben Monat ersetzt, ältere bleiben liegen)
// Inhalt = Kopie der Daten-Datei (gleiches Format). So gibt es auch dann Sicherungen, wenn nur die Web-App benutzt wird.

import { encode } from './format.js';
import { storageSettings } from './naming.js';

export const BACKUP_FOLDER = 'Tourenbuch_Backups';
export const LATEST_FILE = 'tourenbuch-sicherung-aktuell.json';
/** Ohne Änderung aus dem Web trotzdem so oft sichern (falls die Handy-App nie läuft). */
export const BACKUP_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** Die beiden Dateien der Sicherung (Monat nach der Uhr dieses Geräts). */
export function backupPaths(doc, now) {
  const folder = `${storageSettings(doc).root}/${BACKUP_FOLDER}`;
  const d = new Date(now);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return [`${folder}/${LATEST_FILE}`, `${folder}/tourenbuch-sicherung-${month}.json`];
}

/** Sichern nötig? Nach einer Änderung aus dem Web immer, sonst wenn die letzte Web-Sicherung alt ist. */
export function backupDue({ wrote, lastBackup, now }) {
  return !!wrote || !lastBackup || now - lastBackup > BACKUP_MAX_AGE_MS;
}

/** Schreibt die Sicherung (ersetzt die beiden Dateien). drive.replaceFile(pfad, text). */
export async function writeBackup(drive, doc, now, deviceName = 'Web-App') {
  const text = encode({ ...doc, savedAt: now, savedBy: deviceName });
  for (const path of backupPaths(doc, now)) await drive.replaceFile(path, text);
}
