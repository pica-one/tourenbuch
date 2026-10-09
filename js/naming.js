// Ordner- und Dateinamen auf OneDrive – genau wie OneDriveNaming.kt in der App:
//   <Stammordner>/<Berg_oder_Ort>/<JJJJMMTT>_<Route>   (ohne Route nur <JJJJMMTT>)
//   Klettergarten, Klettersteig und Bike zusätzlich in einem Sammelordner (einstellbar).
// Mehrtägige Touren verwenden das Startdatum. Leerzeichen werden zu "_".

export const DEFAULT_ROOT = 'Pictures/Klettern_Bergsteigen';
export const UNKNOWN_MOUNTAIN = 'Unbekannter_Berg';
const MAX_SEGMENT_LENGTH = 80;
const CNTRL = /[\x00-\x1F\x7F]/g;

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', '.lock', 'desktop.ini',
  'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** "Piz / XYZ" -> "Piz-XYZ", "Südgrat: Variante A" -> "Südgrat_Variante_A". "" wenn nichts übrig bleibt. */
export function cleanSegment(text) {
  let s = String(text ?? '')
    .replace(CNTRL, ' ')
    .replace(/[/\\|]/g, ' - ')
    .replace(/[:*?"<>]/g, ' ')
    .replaceAll('_vti_', ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_?-_?/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_');
  s = trimChars(s, '_-. ~');
  if (s.length > MAX_SEGMENT_LENGTH) s = trimEnd(s.slice(0, MAX_SEGMENT_LENGTH), '_-.');
  if (RESERVED.has(s.toLowerCase())) s = `${s}_`;
  return s;
}

/** " /Pictures//Klettern_Bergsteigen/ " -> "Pictures/Klettern_Bergsteigen" */
export function cleanRoot(root) {
  const cleaned = String(root ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => trimChars(p.replace(/[:*?"<>|]/g, '').replace(CNTRL, ''), '. '))
    .join('/');
  return cleaned.trim() ? cleaned : DEFAULT_ROOT;
}

export function datePart(iso) {
  return iso.replaceAll('-', '');
}

export function tourFolderName(startIso, route) {
  const r = route ? cleanSegment(route) : '';
  return r ? `${datePart(startIso)}_${r}` : datePart(startIso);
}

export function mountainFolderName(mountain) {
  return cleanSegment(mountain) || UNKNOWN_MOUNTAIN;
}

export function groupFolder(type) {
  return { KLETTERGARTEN: 'Klettergarten', KLETTERSTEIG: 'Klettersteige', BIKETOUR: 'Bike' }[type] ?? null;
}

/** z. B. "Pictures/Klettern_Bergsteigen/Klettersteige/Pinut/20171014" */
export function tourFolderPath(root, type, mountain, startIso, route, useGroupFolders = true) {
  return [cleanRoot(root), useGroupFolders ? groupFolder(type) : null, mountainFolderName(mountain), tourFolderName(startIso, route)]
    .filter(Boolean)
    .join('/');
}

/** Dateiname so, wie er ist – nur Zeichen, die OneDrive nicht erlaubt, werden zu "_". null wenn unbrauchbar. */
export function cleanFileName(name) {
  const clean = trimChars(String(name ?? '').replace(CNTRL, '_').replace(/[/\\:*?"<>|]/g, '_').trim(), '. ');
  if (!clean) return null;
  const base = clean.includes('.') ? clean.slice(0, clean.lastIndexOf('.')) : clean;
  return RESERVED.has(base.toLowerCase()) ? null : clean;
}

/** Ersatzname eines Fotos ohne brauchbaren Namen: "20260927_Titlis_01.jpg" */
export function photoFileName(mountain, startIso, number, mimeType) {
  return `${datePart(startIso)}_${mountainFolderName(mountain)}_${String(number).padStart(2, '0')}.${extension(mimeType)}`;
}

function extension(mimeType) {
  return { 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif' }[mimeType?.toLowerCase()] ?? 'jpg';
}

function trimChars(s, chars) {
  return trimEnd(trimStart(s, chars), chars);
}
function trimStart(s, chars) {
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}
function trimEnd(s, chars) {
  let i = s.length;
  while (i > 0 && chars.includes(s[i - 1])) i--;
  return s.slice(0, i);
}
