// Fotobuch: alle gelikten Fotos (♥) der Touren in einem Zeitraum als PDF, A4 Querformat, zum Drucken lassen.
// Jede Tour beginnt auf einer neuen Seite, oben Tourname · Route · Datum; pro Seite 1–4 Fotos, locker gemischt.
// Touren ohne gelikte Fotos kommen nicht vor. Videos und Topos auch nicht.

import { isLiked, isVideoName, visibleTours } from './tourbook.js';
import { dateRange, esc, todayIso, topbar } from './ui.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';

// Seite A4 quer in mm (Endformat nach dem Zuschneiden). Alle Masse unten beziehen sich darauf.
export const PAGE = { w: 297, h: 210, margin: 12, captionH: 10, gap: 4 };
/**
 * Vorgaben von bookfactory.ch "PDF to Book" (pdf-to-book.bookfactory.ch, Stand 11.2026):
 * 3 mm Beschnitt rundum (PDF also 303 × 216 mm, beim Hochladen "mit Beschnitt" wählen),
 * Hardcover Klebebindung mindestens 16 Seiten in 2er-Schritten, Schriften eingebettet, Bilder ab 220 dpi (300 optimal).
 */
export const BOOK = { bleed: 3, minPages: 16, minDpi: 220 };
/**
 * Druckqualität: Bildpunkte pro mm und Quelle der Fotos.
 * high (Standard): 300 dpi aus dem Original – so will es die Druckerei.
 * standard: 200 dpi aus der 2048-Pixel-Version von OneDrive – kleine Datei, z. B. zum Anschauen (Druckerei warnt).
 */
export const QUALITY = {
  standard: { pxPerMm: 7.9, jpeg: 0.9, original: false },
  high: { pxPerMm: 11.8, jpeg: 0.92, original: true },
};

/**
 * Aufnahmezeit aus dem Dateinamen als sortierbarer Text "jjjjmmtthhmmss" (z. B. IMG_20260712_101530.jpg,
 * IMG20260712101530.jpg, PXL_20260712_101530123.jpg, IMG-20260712-WA0013.jpg). null = kein Datum im Namen.
 */
export function captureKey(fileName) {
  const m = /(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:[-_ ]?([0-2]\d)[-_.]?([0-5]\d)[-_.]?([0-5]\d))?/.exec(fileName || '');
  return m ? `${m[1]}${m[2]}${m[3]}${m[4] ?? '00'}${m[5] ?? '00'}${m[6] ?? '00'}` : null;
}

/** Fotos in Aufnahme-Reihenfolge; ohne Datum im Namen nach dem Zeitpunkt des Hinzufügens. */
export function sortByCapture(photos) {
  const key = (p) => captureKey(p.fileName) ?? '';
  return [...photos].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && kb && ka !== kb) return ka < kb ? -1 : 1;
    if (ka && kb) return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
    return (a.added ?? 0) - (b.added ?? 0);
  });
}

/** Touren im Zeitraum mit ihren gelikten Fotos (ohne Videos), älteste zuerst, Fotos nach Aufnahmezeit. */
export function photobookSelection(doc, fromIso, toIso) {
  return visibleTours(doc)
    .filter((t) => t.dates.value.start >= fromIso && t.dates.value.start <= toIso)
    .map((t) => ({ tour: t, photos: sortByCapture(t.photos.filter((p) => isLiked(p) && p.oneDriveItemId && !isVideoName(p.fileName))) }))
    .filter((x) => x.photos.length > 0)
    .sort((a, b) => (a.tour.dates.value.start < b.tour.dates.value.start ? -1 : a.tour.dates.value.start > b.tour.dates.value.start ? 1 : 0));
}

export function captionOf(tour) {
  return [tour.mountain.value, tour.routeName?.value, dateRange(tour.dates.value)].filter(Boolean).join(' · ');
}

/**
 * Aussehen der Seiten: Hintergrund, Farben für Titel/Text, Akzent (kleiner Balken vor dem Titel),
 * frame = weisser Rand um die Fotos (wie Abzüge).
 */
export const THEMES = {
  creme: { label: 'Creme', bg: [246, 241, 232], title: [52, 44, 36], text: [96, 84, 70], accent: [166, 124, 82], frame: true },
  weiss: { label: 'Weiss', bg: [255, 255, 255], title: [34, 34, 34], text: [85, 85, 85], accent: [46, 94, 78], frame: false },
  dunkel: { label: 'Dunkel', bg: [30, 31, 33], title: [240, 238, 232], text: [200, 195, 185], accent: [201, 169, 110], frame: false },
};

const FRAME_MM = 1.5;

// Schriften (frei verwendbar), mit Prüfsumme wie jsPDF. Sie werden ins PDF eingebettet – das verlangt die Druckerei,
// darum gibt es keine Ersatzschrift: ohne sie kein PDF.
const FONTS = {
  BebasNeue: { // Tournamen
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/bebas-neue@0.4.1/400Regular/BebasNeue_400Regular.ttf',
    sri: 'sha256-gw6hhqz/wjFu0aTkIxkka6O0awTjOiEQeSSb+QEZPwQ=',
  },
  Roboto: { // Route, Datum, Seitenzahl
    url: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.4.3/400Regular/Roboto_400Regular.ttf',
    sri: 'sha256-FSVkBeyw2IBniDOlgnYO+tU4qykyMYtSyBBbJn0VlFk=',
  },
};
const fontData = {};

/** Schrift laden (base64). */
async function loadFont(name) {
  if (fontData[name]) return fontData[name];
  let res;
  try {
    res = await fetch(FONTS[name].url, { integrity: FONTS[name].sri });
  } catch {
    res = null;
  }
  if (!res?.ok) throw new Error('Die Schriften für das PDF konnten nicht geladen werden (Internet?). Bitte nochmals versuchen.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  fontData[name] = btoa(bin);
  return fontData[name];
}

/** Hintergrund einer Seite, bis in den Beschnitt (der beim Zuschneiden wegfällt). */
function drawBackground(pdf, theme) {
  pdf.setFillColor(...theme.bg);
  pdf.rect(0, 0, PAGE.w + 2 * BOOK.bleed, PAGE.h + 2 * BOOK.bleed, 'F');
}

/** Kopf einer Seite: Akzent-Balken, Tourname gross, daneben Route · Datum; unten rechts die Seitenzahl. */
function drawPage(pdf, tour, theme, pageNo, header = true) {
  const { w, h, margin } = PAGE;
  const b = BOOK.bleed;
  drawBackground(pdf, theme);
  drawPageNo(pdf, theme, pageNo);
  if (!header) return; // Folgeseiten einer Tour: ohne Titel, mehr Platz für die Fotos
  pdf.setFillColor(...theme.accent);
  pdf.rect(b + margin, b + margin, 1.6, 7, 'F');
  const x = b + margin + 4.5;
  const base = b + margin + 6.6;
  pdf.setFont('BebasNeue', 'normal');
  pdf.setFontSize(24);
  pdf.setTextColor(...theme.title);
  const title = tour.mountain.value.toUpperCase();
  pdf.text(title, x, base);
  const titleW = pdf.getTextWidth(title); // in der Titelschrift messen
  const sub = [tour.routeName?.value, dateRange(tour.dates.value)].filter(Boolean).join('  ·  ');
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(12.5);
  pdf.setTextColor(...theme.text);
  pdf.text(sub, x + titleW + 5, base);
}

function drawPageNo(pdf, theme, pageNo) {
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...theme.text);
  pdf.text(String(pageNo), BOOK.bleed + PAGE.w - PAGE.margin, BOOK.bleed + PAGE.h - 5, { align: 'right' });
}

/**
 * Einzelfoto randlos über die ganze Seite bis in den Beschnitt (ohne Seitenzahl).
 * tour gesetzt = erste Seite der Tour: Titel weiss mit feinem Schatten oben links aufs Foto.
 */
function drawFullBleed(pdf, item, tour, quality) {
  const W = PAGE.w + 2 * BOOK.bleed;
  const H = PAGE.h + 2 * BOOK.bleed;
  const img = renderCell(item.bitmap, { x: 0, y: 0, w: W, h: H, fit: 'cover' }, quality);
  pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
  if (tour) {
    const x = BOOK.bleed + PAGE.margin;
    const y = BOOK.bleed + PAGE.margin + 8;
    const name = tour.mountain.value.toUpperCase();
    const sub = [tour.routeName?.value, dateRange(tour.dates.value)].filter(Boolean).join('  ·  ');
    for (const [color, d] of [[[0, 0, 0], 0.35], [[255, 255, 255], 0]]) {
      pdf.setFont('BebasNeue', 'normal');
      pdf.setFontSize(30);
      pdf.setTextColor(...color);
      pdf.text(name, x + d, y + d);
      pdf.setFont('Roboto', 'normal');
      pdf.setFontSize(12.5);
      pdf.text(sub, x + d, y + 7 + d);
    }
  }
  return img;
}

/**
 * Tour mit nur einem Hochformat-Foto: Foto links über die ganze Höhe, rechts daneben gross Tourname, Route, Datum
 * (statt eines einzelnen Hochformats mit viel leerer Fläche).
 */
function drawPortraitSolo(pdf, tour, theme, pageNo, item, quality) {
  const { w, h, margin } = PAGE;
  const b = BOOK.bleed;
  drawBackground(pdf, theme);
  drawPageNo(pdf, theme, pageNo);
  const f = theme.frame ? FRAME_MM : 0;
  const ph = h - 2 * margin;
  const pw = Math.min(ph * item.ratio, (w - 2 * margin) * 0.55);
  const cell = limitToDpi({ x: b + margin + f, y: b + margin + f, w: pw - 2 * f, h: ph - 2 * f, fit: 'contain' }, item.bitmap);
  const img = renderCell(item.bitmap, cell, quality);
  if (f) {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(img.x - f, img.y - f, img.w + 2 * f, img.h + 2 * f, 'F');
  }
  pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
  const tx = img.x + img.w + f + 16;
  const tw = b + w - margin - tx;
  const cy = b + h / 2;
  pdf.setFillColor(...theme.accent);
  pdf.rect(tx, cy - 22, 1.6, 12, 'F');
  pdf.setFont('BebasNeue', 'normal');
  pdf.setFontSize(40);
  pdf.setTextColor(...theme.title);
  const lines = pdf.splitTextToSize(tour.mountain.value.toUpperCase(), tw - 6);
  pdf.text(lines, tx + 5, cy - 11.5);
  const below = cy - 11.5 + (lines.length - 1) * 15 + 10;
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(13);
  pdf.setTextColor(...theme.text);
  const route = tour.routeName?.value;
  if (route) pdf.text(pdf.splitTextToSize(route, tw - 6), tx + 5, below);
  pdf.text(dateRange(tour.dates.value), tx + 5, below + (route ? 7 : 0) * pdf.splitTextToSize(route || '', tw - 6).length);
  return img;
}

/** Titel des Buchs aus dem Zeitraum: "Touren 2026" bzw. "Touren 2025 – 2026". */
export function bookTitle(fromIso, toIso) {
  const a = fromIso.slice(0, 4);
  const b = toIso.slice(0, 4);
  return a === b ? `Touren ${a}` : `Touren ${a} – ${b}`;
}

/** Titelseite: grosser Titel in der Mitte, darunter Zeitraum und Anzahl Touren. */
function drawTitlePage(pdf, theme, title, sub) {
  const b = BOOK.bleed;
  const cx = b + PAGE.w / 2;
  drawBackground(pdf, theme);
  pdf.setFont('BebasNeue', 'normal');
  pdf.setFontSize(64);
  pdf.setTextColor(...theme.title);
  pdf.text(title.toUpperCase(), cx, b + PAGE.h / 2, { align: 'center' });
  pdf.setFillColor(...theme.accent);
  pdf.rect(cx - 15, b + PAGE.h / 2 + 7, 30, 1.2, 'F');
  pdf.setFont('Roboto', 'normal');
  pdf.setFontSize(13);
  pdf.setTextColor(...theme.text);
  pdf.text(sub, cx, b + PAGE.h / 2 + 18, { align: 'center' });
}

const OVERVIEW = { rowH: 7.2, perColumn: 21, bigRows: 12 };

/** Wie viele Seiten die Übersicht für n Touren braucht (2 Spalten pro Seite). */
export function overviewPageCount(n) {
  return Math.max(1, Math.ceil(n / (2 * OVERVIEW.perColumn)));
}

/** Übersicht: Datum, Tourname, Route, Seite – in zwei Spalten. entries = [{ tour, page }]. */
function drawOverview(pdf, theme, entries, firstPageNo, pageCount) {
  const { w, h, margin } = PAGE;
  const b = BOOK.bleed;
  const perPage = 2 * OVERVIEW.perColumn;
  const colW = (w - 2 * margin - 12) / 2;
  for (let p = 0; p < pageCount; p++) {
    pdf.setPage(firstPageNo + p);
    drawBackground(pdf, theme);
    pdf.setFillColor(...theme.accent);
    pdf.rect(b + margin, b + margin, 1.6, 7, 'F');
    pdf.setFont('BebasNeue', 'normal');
    pdf.setFontSize(24);
    pdf.setTextColor(...theme.title);
    pdf.text('INHALT', b + margin + 4.5, b + margin + 6.6);
    const rows = entries.slice(p * perPage, (p + 1) * perPage);
    // Wenige Touren: eine Spalte, grössere Schrift; viele: zwei Spalten
    const big = rows.length <= OVERVIEW.bigRows;
    const s = big ? { rowH: 12, name: 20, small: 11.5, colW: 200, top: 30 } : { rowH: OVERVIEW.rowH, name: 14, small: 9, colW, top: 22 };
    pdf.setFont('Roboto', 'normal');
    pdf.setFontSize(s.small);
    const dateW = Math.max(0, ...rows.map(({ tour }) => pdf.getTextWidth(dateRange(tour.dates.value))));
    rows.forEach(({ tour, page }, i) => {
      const col = big ? 0 : Math.floor(i / OVERVIEW.perColumn);
      const x = big ? b + (w - s.colW) / 2 : b + margin + col * (colW + 12);
      const y = b + margin + s.top + (big ? i : i % OVERVIEW.perColumn) * s.rowH;
      pdf.setFont('Roboto', 'normal');
      pdf.setFontSize(s.small);
      pdf.setTextColor(...theme.text);
      pdf.text(dateRange(tour.dates.value), x, y);
      pdf.text(String(page), x + s.colW, y, { align: 'right' });
      if (big) {
        // feine Linie unter jeder Zeile
        pdf.setDrawColor(...theme.text);
        pdf.setLineWidth(0.1);
        pdf.line(x, y + s.rowH * 0.4, x + s.colW, y + s.rowH * 0.4);
      }
      pdf.setFont('BebasNeue', 'normal');
      pdf.setFontSize(s.name);
      pdf.setTextColor(...theme.title);
      const name = tour.mountain.value.toUpperCase();
      const nx = x + dateW + 6;
      pdf.text(name, nx, y);
      const route = tour.routeName?.value;
      if (route) {
        const rx = nx + pdf.getTextWidth(name) + 3;
        pdf.setFont('Roboto', 'normal');
        pdf.setFontSize(s.small);
        pdf.setTextColor(...theme.text);
        const room = x + s.colW - 10 - rx;
        if (room > 8) pdf.text(pdf.splitTextToSize(route, room)[0], rx, y);
      }
    });
    pdf.setFont('Roboto', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...theme.text);
    pdf.text(String(firstPageNo + p), b + w - margin, b + h - 5, { align: 'right' });
  }
}

/** Seitenzahl fürs Buch: mindestens minPages, immer gerade (0 = nicht auffüllen). */
export function bookPageCount(pages, minPages) {
  if (!minPages) return pages;
  return Math.max(minPages, pages + (pages % 2));
}

/**
 * Fotos einer Tour auf Seiten verteilen: locker gemischt 2–4 Fotos pro Seite (nur bei 1 Foto insgesamt eines).
 * random = Zufallszahl 0..1 (für Tests einstellbar). Ergebnis: Liste von Foto-Gruppen.
 */
export function groupPhotos(photos, random = Math.random) {
  // Einzelfotos gibt es nur, wenn sie ausdrücklich gewählt sind (eigene Seite) – hier immer 2–4
  const sizes = [2, 2, 3, 3, 4, 4, 4];
  const groups = [];
  let rest = [...photos];
  while (rest.length) {
    let n = sizes[Math.floor(random() * sizes.length)];
    if (rest.length - n === 1) n = n === 4 ? 3 : n + 1; // kein einzelnes Foto allein übrig lassen
    n = Math.min(n, rest.length);
    groups.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  return groups;
}

/**
 * Felder (mm) für die Fotos einer Seite. ratios = Breite/Höhe der Fotos.
 * 1 Foto: ganze Fläche; 2: nebeneinander (Hochformat) oder übereinander (Querformat);
 * 3: ein grosses + zwei kleine; 4: 2 × 2.
 */
export function layoutCells(ratios, random = Math.random, header = true) {
  const { w, h, margin, gap } = PAGE;
  const captionH = header ? PAGE.captionH : 0;
  const x0 = margin;
  const y0 = margin + captionH;
  const W = w - 2 * margin;
  const H = h - 2 * margin - captionH;
  const n = ratios.length;
  const landscape = ratios.filter((r) => r >= 1).length;
  if (n === 1) return [{ x: x0, y: y0, w: W, h: H, fit: 'contain' }];
  if (n === 2) {
    if (landscape === 2) {
      const ch = (H - gap) / 2;
      return [{ x: x0, y: y0, w: W, h: ch }, { x: x0, y: y0 + ch + gap, w: W, h: ch }].map((c) => ({ ...c, fit: 'cover' }));
    }
    const cw = (W - gap) / 2;
    return [{ x: x0, y: y0, w: cw, h: H }, { x: x0 + cw + gap, y: y0, w: cw, h: H }].map((c) => ({ ...c, fit: 'cover' }));
  }
  if (n === 3) {
    if (landscape === 0) {
      const cw = (W - 2 * gap) / 3;
      return [0, 1, 2].map((i) => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: H, fit: 'cover' }));
    }
    // Ein grosses Foto (links oder rechts, zufällig) und zwei kleine übereinander
    const big = (W - gap) * 0.62;
    const small = W - gap - big;
    const ch = (H - gap) / 2;
    const bigLeft = random() < 0.5;
    const bx = bigLeft ? x0 : x0 + small + gap;
    const sx = bigLeft ? x0 + big + gap : x0;
    return [
      { x: bx, y: y0, w: big, h: H },
      { x: sx, y: y0, w: small, h: ch },
      { x: sx, y: y0 + ch + gap, w: small, h: ch },
    ].map((c) => ({ ...c, fit: 'cover' }));
  }
  const cw = (W - gap) / 2;
  const ch = (H - gap) / 2;
  return [0, 1, 2, 3].map((i) => ({ x: x0 + (i % 2) * (cw + gap), y: y0 + Math.floor(i / 2) * (ch + gap), w: cw, h: ch, fit: 'cover' }));
}

/** Für das grosse Feld bei 3 Fotos das "passendste" (Querformat) nach vorne nehmen. */
function orderForLayout(items) {
  if (items.length !== 3) return items;
  // Ins grosse Feld das Querformat mit den meisten Bildpunkten (kleine, z. B. WhatsApp-Fotos, würden unscharf)
  let i = -1;
  items.forEach((x, k) => {
    if (x.ratio >= 1 && (i < 0 || (x.bitmap?.width ?? 0) > (items[i].bitmap?.width ?? 0))) i = k;
  });
  return i > 0 ? [items[i], ...items.filter((_, k) => k !== i)] : items;
}

/** Einzelnes Foto: nicht grösser drucken, als es für 220 dpi Bildpunkte hat (Feld schrumpft, bleibt zentriert). */
function limitToDpi(cell, bitmap) {
  if (cell.fit !== 'contain' || !bitmap?.width) return cell;
  const maxW = (bitmap.width / BOOK.minDpi) * 25.4; // grösste Breite in mm bei 220 dpi
  const ratio = bitmap.width / bitmap.height;
  const shownW = Math.min(cell.w, cell.h * ratio); // so breit wäre das Foto im Feld
  const s = Math.min(1, maxW / shownW);
  if (s >= 1) return cell;
  // Seitenverhältnis des Feldes behalten; contain zentriert das Foto darin
  const w = cell.w * s;
  const h = cell.h * s;
  return { ...cell, x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

// ---------- PDF erstellen ----------

let jsPdfLoading = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (!jsPdfLoading) {
    jsPdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.integrity = JSPDF_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.jspdf);
      s.onerror = () => {
        jsPdfLoading = null;
        reject(new Error('Das PDF-Werkzeug konnte nicht geladen werden (Internet?).'));
      };
      document.head.appendChild(s);
    });
  }
  return jsPdfLoading;
}

/** Wartezeiten zwischen den Versuchen, ein Foto zu laden (OneDrive bremst bei vielen grossen Bildern kurz). */
const RETRY_WAITS_MS = [1000, 3000, 8000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Datei von einer vorab berechtigten Adresse laden; null = auf OneDrive nicht (mehr) vorhanden. */
async function fetchBlob(url) {
  if (!url) return null;
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error(`${new URL(url).host}: ${e.message}`);
  }
  if (!res.ok) throw Object.assign(new Error(`${new URL(url).host}: HTTP ${res.status}`), { status: res.status });
  return res.blob();
}

/** Bild lesen; null = Format kann der Browser nicht lesen (z. B. HEIC vom iPhone). */
async function decode(blob, original) {
  try {
    return await createImageBitmap(blob, original ? { imageOrientation: 'from-image' } : undefined);
  } catch {
    return null;
  }
}

const SIZE = 'c2048x2048';

/**
 * Foto laden -> ImageBitmap, oder null wenn es nicht geht (Grund in problems).
 * Standard: 2048-Pixel-Version; hoch: das Original (nicht lesbar, z. B. HEIC -> doch die 2048-Pixel-Version).
 * Jede Version zuerst über die vorab berechtigte Adresse, sonst direkt über Graph mit Anmeldung.
 * Klappt keiner der Wege (z. B. "Failed to fetch"), nach einer Pause nochmals versuchen.
 */
async function loadPhoto(drive, photo, wait, quality, problems) {
  const id = photo.oneDriveItemId;
  const original = [
    async () => fetchBlob(await drive.downloadUrl(id)),
    drive.contentBlob && (() => drive.contentBlob(id)),
  ];
  const preview = [
    async () => fetchBlob(await drive.thumbnailUrl(id, SIZE)),
    drive.thumbnailBlob && (() => drive.thumbnailBlob(id, SIZE)),
  ];
  // Standard: wenn die Vorschau nicht geht, notfalls das Original
  const ways = (quality.original ? [...original.map((w) => [w, true]), ...preview.map((w) => [w, false])]
    : [...preview.map((w) => [w, false]), [original[1], true]]).filter(([w]) => w);
  for (let attempt = 0; ; attempt++) {
    let lastError = null;
    for (const [way, isOriginal] of ways) {
      try {
        const blob = await way();
        if (!blob) return null; // auf OneDrive nicht mehr vorhanden
        const bitmap = await decode(blob, isOriginal);
        if (bitmap) return bitmap;
      } catch (e) {
        if (e?.status === 404) return null;
        lastError = e;
      }
    }
    if (attempt >= RETRY_WAITS_MS.length) {
      problems.push(lastError?.message || 'Format nicht lesbar');
      return null;
    }
    await wait(RETRY_WAITS_MS[attempt]);
  }
}

/** Bild für ein Feld zuschneiden (cover) bzw. einpassen (contain) und als JPEG liefern. */
function renderCell(bitmap, cell, quality) {
  const ratio = bitmap.width / bitmap.height;
  let { x, y, w, h } = cell;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (cell.fit === 'contain') {
    // ganzes Foto zeigen, in der Fläche zentriert
    if (ratio > w / h) {
      const nh = w / ratio;
      y += (h - nh) / 2;
      h = nh;
    } else {
      const nw = h * ratio;
      x += (w - nw) / 2;
      w = nw;
    }
  } else if (ratio > w / h) {
    sw = bitmap.height * (w / h); // Seiten abschneiden
    sx = (bitmap.width - sw) / 2;
  } else {
    sh = bitmap.width / (w / h); // oben/unten abschneiden
    sy = (bitmap.height - sh) / 2;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.min(Math.round(w * quality.pxPerMm), Math.round(sw)));
  canvas.height = Math.max(1, Math.round(canvas.width * (h / w)));
  const ctx2d = canvas.getContext('2d');
  ctx2d.imageSmoothingQuality = 'high';
  ctx2d.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (cell.shade) {
    // Unten sanft abdunkeln (Verlauf direkt im Bild, ohne Transparenz im PDF): shade = Anteil der Höhe
    const top = canvas.height * (1 - cell.shade);
    const grad = ctx2d.createLinearGradient(0, top, 0, canvas.height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, top, canvas.width, canvas.height - top);
  }
  const data = canvas.toDataURL('image/jpeg', quality.jpeg);
  canvas.width = canvas.height = 0; // Speicher gleich freigeben
  return { data, x, y, w, h, dpi: Math.round(sw / (w / 25.4)) }; // dpi: wie viele Bildpunkte des Fotos pro Zoll gedruckt
}

/**
 * Erstellt das PDF. onProgress(fertig, gesamt). Ergebnis: { blob (application/pdf), missing: [Dateinamen] }.
 * Fotos, die auch nach mehreren Versuchen nicht laden, fehlen im PDF und stehen in missing.
 * Die Fotos werden der Reihe nach geladen, damit auch grosse Bücher wenig Speicher brauchen.
 */
export async function createPhotobookPdf(drive, selection, onProgress = () => {},
  { wait = sleep, quality = QUALITY.high, theme = THEMES.creme, minPages = BOOK.minPages, intro = true, overview = true, title, from, to, random = Math.random, singles = new Set() } = {}) {
  // Seite mit Beschnitt: 303 × 216 mm
  const format = [PAGE.w + 2 * BOOK.bleed, PAGE.h + 2 * BOOK.bleed];
  // putOnlyUsedFonts (in newPdf): sonst stehen die 14 Standardschriften (nicht eingebettet) im PDF und die Druckerei meckert
  const pdf = await newPdf(format);
  const total = selection.reduce((n, x) => n + x.photos.length, 0);
  const missing = [];
  const problems = [];
  let done = 0;
  // Vorne Titelseite und Übersicht (werden am Schluss gezeichnet, wenn die Seitenzahlen bekannt sind)
  const overviewPages = intro && overview ? overviewPageCount(selection.length) : 0;
  const introPages = intro ? 1 + overviewPages : 0;
  for (let i = 1; i < introPages; i++) pdf.addPage(format, 'landscape');
  let pages = introPages;
  const entries = [];
  const lowRes = []; // Fotos, die für ihr Feld zu wenig Bildpunkte haben (Druckerei warnt)
  // Allein auf einer Seite nur Querformate mit genug Bildpunkten für die ganze Breite (beim Druck aus dem Original)
  const fullW = ((PAGE.w - 2 * PAGE.margin) / 25.4) * BOOK.minDpi;
  const needsPartner = (it) => it.ratio < 1 || (quality.original && it.bitmap.width < 0.9 * fullW);
  for (const { tour, photos } of selection) {
    // Seitenplan: gewählte Einzelfotos je auf eine ganze Seite, die übrigen in Gruppen zu 2–4;
    // in Aufnahme-Reihenfolge, aber die Tour beginnt mit einer Gruppenseite (dort steht der Titel)
    const isSingle = (p) => singles.has(p.oneDriveItemId);
    const plan = [
      ...groupPhotos(photos.filter((p) => !isSingle(p)), random).map((g) => ({ single: false, g })),
      ...photos.filter(isSingle).map((p) => ({ single: true, g: [p] })),
    ];
    plan.sort((a, b) => photos.indexOf(a.g[0]) - photos.indexOf(b.g[0]));
    const firstGroup = plan.findIndex((x) => !x.single);
    if (firstGroup > 0) plan.unshift(plan.splice(firstGroup, 1)[0]);
    let firstPage = null;
    const early = new Map(); // schon geladene Fotos (Blick voraus aufs letzte Foto)
    const fetchItem = async (photo) => {
      if (early.has(photo)) {
        const item = early.get(photo);
        early.delete(photo);
        return item;
      }
      const bitmap = await loadPhoto(drive, photo, wait, quality, problems);
      if (bitmap) return { bitmap, ratio: bitmap.width / bitmap.height, fileName: photo.fileName, photo };
      missing.push(photo.fileName);
      onProgress(++done, total);
      return null;
    };
    for (let pi = 0; pi < plan.length; pi++) {
      if (plan[pi].single) {
        // Einzelfoto: randlos über die ganze Seite
        const item = await fetchItem(plan[pi].g[0]);
        if (!item) continue;
        if (pages++) pdf.addPage(format, 'landscape');
        const header = firstPage == null;
        firstPage ??= pages;
        const img = drawFullBleed(pdf, item, header ? tour : null, quality);
        if (img.dpi < BOOK.minDpi) lowRes.push({ fileName: item.fileName, dpi: img.dpi, page: pages, tour: tour.mountain.value });
        item.bitmap.close?.();
        onProgress(++done, total);
        continue;
      }
      const later = plan.slice(pi + 1).filter((x) => !x.single).map((x) => x.g); // weitere Gruppen dieser Tour
      const items = [];
      const load = async (photo) => {
        const item = await fetchItem(photo);
        if (item) items.push(item);
      };
      for (const photo of plan[pi].g) await load(photo);
      // Ein Hochformat (oder ein zu kleines Foto, z. B. von WhatsApp) nie allein auf eine Seite: das nächste Foto dazunehmen
      while (items.length === 1 && needsPartner(items[0])) {
        const next = later.find((g) => g.length);
        if (!next) break;
        await load(next.shift());
      }
      // Bliebe danach nur noch ein Hochformat übrig, kommt es schon auf diese Seite
      const rest = later.flat();
      // (ist diese Seite schon voll, wandert eines ihrer Fotos zu ihm auf die nächste)
      if (rest.length === 1 && items.length) {
        const item = await fetchItem(rest[0]);
        const g = later.find((x) => x.length);
        if (!item) g.shift();
        else if (needsPartner(item) && items.length < 4) {
          g.shift();
          items.push(item);
        } else {
          early.set(rest[0], item);
          if (needsPartner(item)) {
            const moved = items.pop();
            g.unshift(moved.photo);
            early.set(moved.photo, moved);
          }
        }
      }
      if (!items.length) continue;
      if (pages++) pdf.addPage(format, 'landscape');
      const header = firstPage == null; // Titel nur auf der ersten Seite der Tour
      firstPage ??= pages;
      if (items.length === 1) {
        // Nur ein Foto übrig (z. B. Tour mit einem einzigen Foto): Foto + Titel daneben, kein Einzelfoto
        const img = drawPortraitSolo(pdf, tour, theme, pages, items[0], quality);
        if (img.dpi < BOOK.minDpi) lowRes.push({ fileName: items[0].fileName, dpi: img.dpi, page: pages, tour: tour.mountain.value });
        items[0].bitmap.close?.();
        onProgress(++done, total);
        continue;
      }
      drawPage(pdf, tour, theme, pages, header);
      const ordered = orderForLayout(items);
      const cells = layoutCells(ordered.map((i) => i.ratio), random, header);
      const f = theme.frame ? FRAME_MM : 0;
      const b = BOOK.bleed;
      ordered.forEach((item, i) => {
        const c = limitToDpi(cells[i], item.bitmap);
        const img = renderCell(item.bitmap, { ...c, x: c.x + b + f, y: c.y + b + f, w: c.w - 2 * f, h: c.h - 2 * f }, quality);
        if (f) {
          // weisser Rand wie bei einem Abzug
          pdf.setFillColor(255, 255, 255);
          pdf.rect(img.x - f, img.y - f, img.w + 2 * f, img.h + 2 * f, 'F');
        }
        pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
        if (img.dpi < BOOK.minDpi) lowRes.push({ fileName: item.fileName, dpi: img.dpi, page: pages, tour: tour.mountain.value });
        item.bitmap.close?.();
        onProgress(++done, total);
      });
    }
    if (firstPage) entries.push({ tour, page: firstPage });
  }
  const reason = problems.length ? ` (Grund: ${problems[problems.length - 1]})` : '';
  if (!entries.length) throw new Error(`Keines der Fotos konnte von OneDrive geladen werden${reason}. Bitte Internet prüfen und nochmals versuchen.`);
  // Auf die Seitenzahl der Druckerei auffüllen (leere Seiten in der Hintergrundfarbe am Schluss)
  const filled = pages;
  const bookPages = bookPageCount(pages, minPages);
  while (pages < bookPages) {
    pdf.addPage(format, 'landscape');
    drawBackground(pdf, theme);
    pages++;
  }
  if (intro) {
    const first = from ?? selection[0].tour.dates.value.start;
    const last = to ?? selection[selection.length - 1].tour.dates.value.start;
    const n = entries.length;
    pdf.setPage(1);
    drawTitlePage(pdf, theme, title || bookTitle(first, last), `${dateRange({ start: first, end: last })}  ·  ${n} ${n === 1 ? 'Tour' : 'Touren'}`);
    if (overviewPages) drawOverview(pdf, theme, entries, 2, overviewPages);
    pdf.setPage(pages);
  }
  return { blob: pdf.output('blob'), missing, reason, pages, blankPages: pages - filled, lowRes };
}

// ---------- Umschlag ----------

/**
 * Umschlag Hardcover A4 quer nach der bookfactory-Musterdatei (cover_hang_glue_297x210_16.pdf):
 * PDF = 17 mm Beschnitt (wird um den Deckel geschlagen) + Rückseite 301 + Rücken + Vorderseite 301 + 17, Höhe 17 + 215 + 17.
 * Rücken: 6 mm bei 16 Seiten, wächst mit der Seitenzahl (Wert aus der Musterdatei des Konfigurators).
 * 10 mm neben dem Rücken ist der Falz (Gelenk): dort nichts Wichtiges.
 */
export const COVER = { bleed: 17, panelW: 301, h: 215, hinge: 10, spine: 6, maxBack: 4 };

/** Grösse des Umschlag-PDFs in mm. */
export function coverSize(spineMm) {
  return { w: 2 * COVER.bleed + 2 * COVER.panelW + spineMm, h: 2 * COVER.bleed + COVER.h };
}

/** Foto in ein Feld setzen (zugeschnitten), mit Rahmen je nach Aussehen. */
function placePhoto(pdf, item, cell, theme, quality) {
  const f = theme.frame ? FRAME_MM : 0;
  const img = renderCell(item.bitmap, { x: cell.x + f, y: cell.y + f, w: cell.w - 2 * f, h: cell.h - 2 * f, fit: 'cover' }, quality);
  if (f) {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(img.x - f, img.y - f, img.w + 2 * f, img.h + 2 * f, 'F');
  }
  pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
  return img;
}

/**
 * Umschlag-PDF: vorne ein grosses Titelfoto und darunter der Titel, hinten bis 4 kleine Fotos, Rücken einfarbig.
 * front = Foto (aus der Auswahl), back = Fotos für hinten. Ergebnis: { blob, missing, lowRes, size }.
 */
export async function createCoverPdf(drive, { front, back = [], title = '', spine = COVER.spine, theme = THEMES.creme,
  quality = QUALITY.high, wait = sleep } = {}) {
  if (!front) throw new Error('Bitte zuerst ein Titelbild wählen.');
  const size = coverSize(spine);
  const pdf = await newPdf([size.w, size.h]);
  const { bleed: B, panelW, h } = COVER;
  const problems = [];
  const missing = [];
  const lowRes = [];
  pdf.setFillColor(...theme.bg);
  pdf.rect(0, 0, size.w, size.h, 'F');

  // Vorderseite: Foto oben, Titel darunter
  const fx = B + panelW + spine; // linke Kante der Vorderseite
  const m = 18;
  const frontItem = await loadItem(drive, front, wait, quality, problems);
  if (!frontItem) throw new Error(`Das Titelbild konnte nicht geladen werden${problems.length ? ` (Grund: ${problems.at(-1)})` : ''}.`);
  // Titelbild über die ganze Vorderseite, bis in den Beschnitt (ab dem Rücken bis zum Rand)
  const fullW = size.w - fx;
  const title1 = title.trim();
  // mit Titel: unten abdunkeln, damit der weisse Titel auf jedem Foto lesbar ist
  const fimg = renderCell(frontItem.bitmap, { x: fx, y: 0, w: fullW, h: size.h, fit: 'cover', shade: title1 ? 75 / size.h : 0 }, quality);
  pdf.addImage(fimg.data, 'JPEG', fimg.x, fimg.y, fimg.w, fimg.h, undefined, 'FAST');
  if (fimg.dpi < BOOK.minDpi) lowRes.push({ fileName: front.fileName, dpi: fimg.dpi });
  frontItem.bitmap.close?.();
  if (title1) {
    const cx = fx + COVER.hinge + (panelW - COVER.hinge) / 2; // Mitte der sichtbaren Fläche neben dem Falz
    const ty = B + h - m - 8;
    pdf.setFont('BebasNeue', 'normal');
    let fs = 64;
    pdf.setFontSize(fs);
    while (fs > 20 && pdf.getTextWidth(title1.toUpperCase()) > panelW - COVER.hinge - 2 * m) pdf.setFontSize((fs -= 2));
    pdf.setTextColor(255, 255, 255);
    pdf.text(title1.toUpperCase(), cx, ty, { align: 'center' });
  }

  // Rückseite: bis 4 Fotos in der Mitte
  const items = [];
  for (const photo of back.slice(0, COVER.maxBack)) {
    const it = await loadItem(drive, photo, wait, quality, problems);
    if (it) items.push(it);
    else missing.push(photo.fileName);
  }
  if (items.length) {
    const bx = B + 34;
    const by = B + 34;
    const W = panelW - 68;
    const H = h - 68 - 14; // unten etwas mehr Luft
    const gap = 5;
    const n = items.length;
    const cells = n === 4
      ? [0, 1, 2, 3].map((i) => ({ x: bx + (i % 2) * ((W + gap) / 2), y: by + Math.floor(i / 2) * ((H + gap) / 2), w: (W - gap) / 2, h: (H - gap) / 2 }))
      : Array.from({ length: n }, (_, i) => {
        // nebeneinander, Höhe aus dem Durchschnitt der Seitenverhältnisse, nicht höher als H
        const cw = (W - (n - 1) * gap) / n;
        const ch = Math.min(H, n === 1 ? H : cw / 0.8);
        return { x: bx + i * (cw + gap), y: by + (H - ch) / 2, w: cw, h: ch };
      });
    items.forEach((it, i) => {
      const img = placePhoto(pdf, it, cells[i], theme, quality);
      if (img.dpi < BOOK.minDpi) lowRes.push({ fileName: it.fileName, dpi: img.dpi });
      it.bitmap.close?.();
    });
  }
  return { blob: pdf.output('blob'), missing, lowRes, size };
}

async function loadItem(drive, photo, wait, quality, problems) {
  const bitmap = await loadPhoto(drive, photo, wait, quality, problems);
  return bitmap ? { bitmap, ratio: bitmap.width / bitmap.height, fileName: photo.fileName } : null;
}

/** Neues PDF (mm, quer) mit den eingebetteten Schriften. */
async function newPdf(format) {
  const { jsPDF } = await loadJsPdf();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format, compress: true, putOnlyUsedFonts: true });
  for (const name of Object.keys(FONTS)) {
    pdf.addFileToVFS(`${name}.ttf`, await loadFont(name));
    pdf.addFont(`${name}.ttf`, name, 'normal');
  }
  return pdf;
}

// ---------- Bildschirm ----------

/** Datei herunterladen. */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

const lowResText = (lowRes, where) => (lowRes.length
  ? ` ${lowRes.length === 1 ? 'Dieses Foto ist' : 'Diese Fotos sind'} für die Grösse ${where} eher klein `
    + `(unter ${BOOK.minDpi} dpi, darum warnt bookfactory): `
    + lowRes.map((x) => `${x.fileName} (${[x.tour, x.page && `Seite ${x.page}`, `${x.dpi} dpi`].filter(Boolean).join(', ')})`).join(', ') + '.'
  : '');

// Vorschaubilder für die Umschlag-Auswahl (OneDrive-Element -> Adresse)
const thumbs = new Map();
async function loadThumbs(root, drive) {
  const imgs = [...root.querySelectorAll('img[data-thumb]')];
  for (const img of imgs) if (thumbs.has(img.dataset.thumb)) img.src = thumbs.get(img.dataset.thumb);
  const todo = imgs.filter((img) => !thumbs.has(img.dataset.thumb));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const img = todo[next++];
      try {
        const url = await drive.thumbnailUrl(img.dataset.thumb, 'c300x300');
        if (url) {
          thumbs.set(img.dataset.thumb, url);
          root.querySelectorAll(`img[data-thumb="${CSS.escape(img.dataset.thumb)}"]`).forEach((x) => (x.src = url));
        }
      } catch {
        /* fehlendes Vorschaubild ist kein Problem */
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// Auswahl fürs Buch im Browser merken (nur auf diesem Gerät), damit sie nach dem Neuladen noch da ist
const CHOICES_KEY = 'tourenbuch-fotobuch';
function loadChoices(state) {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICES_KEY) || '{}');
    if (Array.isArray(c.excluded)) state.excluded = new Set(c.excluded);
    if (Array.isArray(c.singles)) state.singles = new Set(c.singles);
    if (typeof c.title === 'string') state.title = c.title;
    if (typeof c.overview === 'boolean') state.overview = c.overview;
    if (typeof c.theme === 'string' && THEMES[c.theme]) state.theme = c.theme;
    if (c.spine > 0) state.spine = c.spine;
    if (typeof c.coverFront === 'string') state.coverFront = c.coverFront;
    if (Array.isArray(c.coverBack)) state.coverBack = c.coverBack;
  } catch {
    /* nichts gemerkt */
  }
}
function saveChoices(state) {
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify({
      excluded: [...(state.excluded ?? [])], singles: [...(state.singles ?? [])], title: state.title, overview: state.overview,
      theme: state.theme, spine: state.spine, coverFront: state.coverFront, coverBack: state.coverBack,
    }));
  } catch {
    /* Speichern nicht möglich - dann eben nur bis zum Neuladen */
  }
}

/**
 * state bleibt zwischen Aufrufen erhalten: from, to, quality, theme, excluded (abgewählte Touren), overview, title,
 * running/progress/info/error fürs Buch; spine, coverFront, coverBack, pickFor, coverRunning/coverInfo/coverError.
 */
export function renderPhotobook(root, ctx, state) {
  if (!state.loaded) {
    state.loaded = true;
    loadChoices(state);
  }
  const year = todayIso().slice(0, 4);
  state.from ??= `${year}-01-01`;
  state.to ??= `${year}-12-31`;
  state.quality ??= 'high';
  state.excluded ??= new Set();
  state.singles ??= new Set();
  state.open ??= new Set();
  state.coverOpen ??= new Set();
  state.overview ??= true;
  state.spine ??= COVER.spine;
  state.coverBack ??= [];
  state.pickFor ??= 'front';
  const selection = photobookSelection(ctx.book.current(), state.from, state.to);
  const chosen = selection.filter((x) => !state.excluded.has(x.tour.id));
  const photoTotal = chosen.reduce((n, x) => n + x.photos.length, 0);
  const autoTitle = bookTitle(state.from, state.to);
  const title = state.title ?? autoTitle;
  // Fotos für den Umschlag: alle Fotos im Buch
  const bookPhotos = chosen.flatMap((x) => x.photos.map((p) => ({ p, tour: x.tour })));
  const ids = new Set(bookPhotos.map((x) => x.p.oneDriveItemId));
  if (!ids.has(state.coverFront)) state.coverFront = bookPhotos[0]?.p.oneDriveItemId ?? null;
  state.coverBack = state.coverBack.filter((id) => ids.has(id));
  const busy = state.running || state.coverRunning;
  const dis = busy ? 'disabled' : '';
  const plain = 'display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-weight:normal';
  root.innerHTML = `
    <style>.pbTourBox>summary::-webkit-details-marker{display:none}.pbTourBox>summary{list-style:none}
      .pbArrow{transition:transform .15s}.pbTourBox[open] .pbArrow{transform:rotate(90deg)}</style>
    ${topbar('Fotobuch', { back: true })}
    <div class="section"><div class="panel">
      <p class="muted" style="margin-top:0">Alle Fotos mit ♥ aus den gewählten Touren als PDF (A4 Querformat),
        passend für bookfactory.ch „PDF to Book“ (Hardcover, A4 quer). Vorne eine Titelseite (und auf Wunsch ein Inhaltsverzeichnis),
        dann jede Tour ab einer neuen Seite – der Titel steht auf ihrer ersten Seite; die Fotos in Aufnahme-Reihenfolge.</p>
      <div class="dates">
        <label class="field"><span>Von</span><input type="date" id="pbFrom" value="${state.from}" ${dis}></label>
        <label class="field"><span>Bis</span><input type="date" id="pbTo" value="${state.to}" ${dis}></label>
      </div>
      <p><strong>${chosen.length} ${chosen.length === 1 ? 'Tour' : 'Touren'} · ${photoTotal} ${photoTotal === 1 ? 'Foto' : 'Fotos'} mit ♥</strong>
        ${selection.length > chosen.length ? `<span class="muted">(${selection.length - chosen.length} abgewählt)</span>` : ''}</p>
      ${selection.length ? `<p class="muted" style="font-size:.85rem;margin:4px 0">Haken = Tour kommt ins Buch. ▸ aufklappen und
        Fotos antippen, die als <strong>Einzelfoto</strong> randlos eine ganze Seite bekommen sollen (am besten Querformat –
        Hochformat wird stark beschnitten). Alle anderen kommen zu 2–4 auf eine Seite.</p>
        <div>${selection.map((x) => {
          const nSingle = x.photos.filter((p) => state.singles.has(p.oneDriveItemId)).length;
          return `<details class="pbTourBox" data-id="${esc(x.tour.id)}" ${state.open.has(x.tour.id) ? 'open' : ''} style="margin:2px 0">
          <summary style="${plain};cursor:pointer;align-items:center">
            <span class="pbArrow" style="display:inline-block;width:12px;color:#888">▸</span>
            <input type="checkbox" class="pbTour" data-id="${esc(x.tour.id)}" ${state.excluded.has(x.tour.id) ? '' : 'checked'} ${dis}>
            <span>${esc(captionOf(x.tour))} <span class="muted">(${x.photos.length}${nSingle ? ` · ${nSingle} einzeln` : ''})</span></span></summary>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;margin:6px 0 10px 40px">
            ${x.photos.map((p) => {
              const on = state.singles.has(p.oneDriveItemId);
              return `<button type="button" class="pbSingle" data-id="${esc(p.oneDriveItemId)}" title="${esc(p.fileName)}" ${dis}
                style="position:relative;padding:0;border:3px solid ${on ? '#2e5e4e' : 'transparent'};border-radius:6px;overflow:hidden;aspect-ratio:1;background:#8883;cursor:pointer">
                <img data-thumb="${esc(p.oneDriveItemId)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
                ${on ? '<span style="position:absolute;left:4px;top:4px;background:#2e5e4e;color:#fff;font-size:.7rem;padding:1px 5px;border-radius:4px">Einzelfoto</span>' : ''}
              </button>`;
            }).join('')}
          </div></details>`;
        }).join('')}</div>`
        : '<p class="muted">Keine Fotos mit ♥ in diesem Zeitraum. Like Fotos in der Grossansicht mit dem Herz.</p>'}
      <label class="field" style="margin-top:12px"><span>Titel (Titelseite und Umschlag)</span>
        <input type="text" id="pbTitle" value="${esc(title)}" maxlength="60" ${dis}></label>
      <label style="${plain}"><input type="checkbox" id="pbOverview" ${state.overview ? 'checked' : ''} ${dis}> Inhaltsverzeichnis nach der Titelseite</label>
      <div style="margin:12px 0"><span class="muted" style="font-size:.85rem">Hintergrund</span>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
          ${Object.entries(THEMES).map(([key, t]) => `
            <label style="display:flex;gap:6px;align-items:center;font-weight:normal">
              <input type="radio" name="pbTheme" value="${key}" ${(state.theme ?? 'creme') === key ? 'checked' : ''} ${dis}>
              <span style="width:18px;height:18px;border-radius:4px;border:1px solid #9998;background:rgb(${t.bg.join(',')})"></span>${t.label}
            </label>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:12px"><span class="muted" style="font-size:.85rem">Druckqualität</span>
        <label style="${plain}"><input type="radio" name="pbQuality" value="high" ${state.quality === 'high' ? 'checked' : ''} ${dis}>
          Druck (300 dpi, aus den Originalen) – für die Bestellung; grosse Datei, am besten am PC</label>
        <label style="${plain}"><input type="radio" name="pbQuality" value="standard" ${state.quality !== 'high' ? 'checked' : ''} ${dis}>
          Vorschau (200 dpi) – klein und schnell, zum Anschauen (die Druckerei warnt bei dieser Auflösung)</label>
      </div>
      ${state.running
        ? `<div class="upload"><div class="uploadtext">Erstelle PDF … Foto ${state.progress[0]} von ${state.progress[1]}</div>
           <div class="bar"><span style="width:${Math.round((100 * state.progress[0]) / Math.max(1, state.progress[1]))}%"></span></div></div>`
        : `<button class="btn wide" id="pbCreate" ${chosen.length && !ctx.demo && !busy ? '' : 'disabled'}>Buch-PDF erstellen</button>`}
      ${state.info ? `<p class="muted">${esc(state.info)}</p>` : ''}
      ${state.error ? `<p class="formerror">${esc(state.error)}</p>` : ''}
      <p class="muted" style="font-size:.85rem">Tipp: am PC erstellen – bei vielen Fotos braucht das PDF einiges an Speicher.</p>
    </div></div>
    <div class="section"><div class="panel">
      <h3 style="margin-top:0">Umschlag</h3>
      <p class="muted" style="margin-top:0">Eigenes PDF für den Umschlag (bookfactory verlangt ihn separat): vorne das Titelbild mit
        dem Titel, hinten bis ${COVER.maxBack} Fotos. Hintergrund wie beim Buch.</p>
      <label class="field"><span>Buchrücken in mm (steht in der Umschlag-Musterdatei von bookfactory; 6 bei 16 Seiten)</span>
        <input type="number" id="pbSpine" min="1" max="80" step="0.5" value="${state.spine}" ${dis}></label>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin:10px 0">
        <label style="display:flex;gap:6px;align-items:center;font-weight:normal"><input type="radio" name="pbPick" value="front" ${state.pickFor === 'front' ? 'checked' : ''}> Klick wählt das <strong>Titelbild</strong></label>
        <label style="display:flex;gap:6px;align-items:center;font-weight:normal"><input type="radio" name="pbPick" value="back" ${state.pickFor === 'back' ? 'checked' : ''}> Klick wählt Fotos für <strong>hinten</strong> (${state.coverBack.length}/${COVER.maxBack})</label>
      </div>
      ${chosen.length ? `<div>${chosen.map((x) => {
        const marks = [
          x.photos.some((p) => p.oneDriveItemId === state.coverFront) && 'Titelbild',
          x.photos.filter((p) => state.coverBack.includes(p.oneDriveItemId)).length
            && `${x.photos.filter((p) => state.coverBack.includes(p.oneDriveItemId)).length} hinten`,
        ].filter(Boolean).join(' · ');
        return `<details class="pbTourBox pbCoverBox" data-id="${esc(x.tour.id)}" ${state.coverOpen.has(x.tour.id) ? 'open' : ''} style="margin:2px 0">
        <summary style="${plain};cursor:pointer;align-items:center">
          <span class="pbArrow" style="display:inline-block;width:12px;color:#888">▸</span>
          <span>${esc(captionOf(x.tour))} <span class="muted">(${x.photos.length}${marks ? ` · ${marks}` : ''})</span></span></summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;margin:6px 0 10px 20px">
        ${x.photos.map((p) => ({ p, tour: x.tour })).map(({ p, tour }) => {
          const id = p.oneDriveItemId;
          const isFront = state.coverFront === id;
          const backNo = state.coverBack.indexOf(id) + 1;
          const ring = isFront ? '3px solid #c0392b' : backNo ? '3px solid #2e5e4e' : '3px solid transparent';
          return `<button type="button" class="pbPhoto" data-id="${esc(id)}" title="${esc(`${tour.mountain.value} – ${p.fileName}`)}" ${dis}
            style="position:relative;padding:0;border:${ring};border-radius:6px;overflow:hidden;aspect-ratio:1;background:#8883;cursor:pointer">
            <img data-thumb="${esc(id)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
            ${isFront ? '<span style="position:absolute;left:4px;top:4px;background:#c0392b;color:#fff;font-size:.7rem;padding:1px 5px;border-radius:4px">Titel</span>' : ''}
            ${backNo ? `<span style="position:absolute;left:4px;top:4px;background:#2e5e4e;color:#fff;font-size:.7rem;padding:1px 5px;border-radius:4px">Hinten ${backNo}</span>` : ''}
          </button>`;
        }).join('')}
        </div></details>`;
      }).join('')}</div>` : '<p class="muted">Keine Fotos gewählt.</p>'}
      ${state.coverRunning
        ? '<div class="upload"><div class="uploadtext">Erstelle Umschlag …</div></div>'
        : `<button class="btn wide" id="pbCover" style="margin-top:12px" ${state.coverFront && !ctx.demo && !busy ? '' : 'disabled'}>Umschlag-PDF erstellen</button>`}
      ${state.coverInfo ? `<p class="muted">${esc(state.coverInfo)}</p>` : ''}
      ${state.coverError ? `<p class="formerror">${esc(state.coverError)}</p>` : ''}
    </div></div>`;
  const rerender = () => renderPhotobook(root, ctx, state);
  const from = root.querySelector('#pbFrom');
  const to = root.querySelector('#pbTo');
  const onDate = () => {
    state.from = from.value || state.from;
    state.to = to.value || state.to;
    rerender();
  };
  from.onchange = onDate;
  to.onchange = onDate;
  root.querySelectorAll('.pbTour').forEach((c) => {
    c.onclick = (e) => e.stopPropagation(); // Haken setzen klappt nicht auf/zu
    c.onchange = () => {
      if (c.checked) state.excluded.delete(c.dataset.id);
      else state.excluded.add(c.dataset.id);
      saveChoices(state);
      rerender();
    };
  });
  root.querySelectorAll('.pbTourBox').forEach((d) => (d.ontoggle = () => {
    const set = d.classList.contains('pbCoverBox') ? state.coverOpen : state.open;
    if (d.open) set.add(d.dataset.id);
    else set.delete(d.dataset.id);
  }));
  root.querySelectorAll('.pbSingle').forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    if (state.singles.has(id)) state.singles.delete(id);
    else state.singles.add(id);
    saveChoices(state);
    rerender();
  }));
  const titleInput = root.querySelector('#pbTitle');
  titleInput.oninput = () => {
    state.title = titleInput.value;
    saveChoices(state);
  };
  root.querySelector('#pbOverview').onchange = (e) => {
    state.overview = e.target.checked;
    saveChoices(state);
  };
  root.querySelectorAll('input[name="pbQuality"]').forEach((r) => (r.onchange = () => (state.quality = r.value)));
  root.querySelectorAll('input[name="pbTheme"]').forEach((r) => (r.onchange = () => {
    state.theme = r.value;
    saveChoices(state);
  }));
  const spine = root.querySelector('#pbSpine');
  spine.onchange = () => {
    const v = Number(spine.value);
    if (v > 0) state.spine = v;
    saveChoices(state);
  };
  root.querySelectorAll('input[name="pbPick"]').forEach((r) => (r.onchange = () => {
    state.pickFor = r.value;
    rerender();
  }));
  root.querySelectorAll('.pbPhoto').forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    if (state.pickFor === 'front') {
      state.coverFront = id;
      state.coverBack = state.coverBack.filter((x) => x !== id);
    } else if (state.coverBack.includes(id)) state.coverBack = state.coverBack.filter((x) => x !== id);
    else if (state.coverBack.length < COVER.maxBack && id !== state.coverFront) state.coverBack = [...state.coverBack, id];
    saveChoices(state);
    rerender();
  }));
  if (ctx.drive && !ctx.demo) loadThumbs(root, ctx.drive);
  const options = () => ({
    quality: QUALITY[state.quality] ?? QUALITY.high,
    theme: THEMES[state.theme] ?? THEMES.creme,
    title: (state.title ?? autoTitle).trim(),
  });

  root.querySelector('#pbCreate')?.addEventListener('click', async () => {
    state.running = true;
    state.error = null;
    state.info = null;
    state.progress = [0, photoTotal];
    rerender();
    try {
      const { blob, missing, reason, pages, blankPages, lowRes } = await createPhotobookPdf(ctx.drive, chosen, (d, t) => {
        state.progress = [d, t];
        const text = root.querySelector('.uploadtext');
        const bar = root.querySelector('.bar span');
        if (text) text.textContent = `Erstelle PDF … Foto ${d} von ${t}`;
        if (bar) bar.style.width = `${Math.round((100 * d) / Math.max(1, t))}%`;
      }, { ...options(), overview: state.overview, from: state.from, to: state.to, singles: state.singles });
      state.info = `Das Buch hat ${pages} Seiten`
        + (blankPages ? ` – davon ${blankPages} leer am Schluss, weil bookfactory mindestens ${BOOK.minPages} Seiten `
          + 'in 2er-Schritten verlangt (mehr Fotos liken füllt sie).' : '.')
        + ' Beim Hochladen bei bookfactory „mit Beschnitt“ (3 mm) wählen.'
        + (state.quality === 'high' ? lowResText(lowRes, 'im Buch') : '');
      download(blob, `Fotobuch_${state.from}_bis_${state.to}.pdf`);
      if (missing.length) {
        state.error = `PDF erstellt, aber ${missing.length} ${missing.length === 1 ? 'Foto konnte' : 'Fotos konnten'} nicht geladen werden `
          + `und ${missing.length === 1 ? 'fehlt' : 'fehlen'}: ${missing.join(', ')}${reason}. Am besten nochmals erstellen.`;
      }
    } catch (e) {
      console.error(e);
      state.error = e.message || 'Das PDF konnte nicht erstellt werden.';
    } finally {
      state.running = false;
      if (root.isConnected && location.hash.startsWith('#/fotobuch')) rerender();
    }
  });

  root.querySelector('#pbCover')?.addEventListener('click', async () => {
    state.coverRunning = true;
    state.coverError = null;
    state.coverInfo = null;
    rerender();
    const byId = new Map(bookPhotos.map((x) => [x.p.oneDriveItemId, x.p]));
    try {
      const { blob, missing, lowRes, size } = await createCoverPdf(ctx.drive, {
        ...options(),
        front: byId.get(state.coverFront),
        back: state.coverBack.map((id) => byId.get(id)).filter(Boolean),
        spine: state.spine,
      });
      state.coverInfo = `Umschlag erstellt (${Math.round(size.w)} × ${Math.round(size.h)} mm, Buchrücken ${state.spine} mm). `
        + 'Bei bookfactory als Umschlag hochladen; die Grösse muss zur Musterdatei passen.'
        + (state.quality === 'high' ? lowResText(lowRes, 'auf dem Umschlag') : '');
      if (missing.length) state.coverError = `Nicht geladen (fehlt hinten): ${missing.join(', ')}. Am besten nochmals erstellen.`;
      download(blob, `Umschlag_${state.from}_bis_${state.to}.pdf`);
    } catch (e) {
      console.error(e);
      state.coverError = e.message || 'Der Umschlag konnte nicht erstellt werden.';
    } finally {
      state.coverRunning = false;
      if (root.isConnected && location.hash.startsWith('#/fotobuch')) rerender();
    }
  });
}

