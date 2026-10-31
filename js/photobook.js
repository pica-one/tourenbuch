// Fotobuch: alle gelikten Fotos (♥) der Touren in einem Zeitraum als PDF, A4 Querformat, zum Drucken lassen.
// Jede Tour beginnt auf einer neuen Seite, oben Tourname · Route · Datum; pro Seite 1–4 Fotos, locker gemischt.
// Touren ohne gelikte Fotos kommen nicht vor. Videos und Topos auch nicht.

import { isLiked, isVideoName, visibleTours } from './tourbook.js';
import { dateRange, esc, todayIso, topbar } from './ui.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';

// Seite A4 quer in mm
export const PAGE = { w: 297, h: 210, margin: 12, captionH: 10, gap: 4 };
/**
 * Druckqualität: Bildpunkte pro mm und Quelle der Fotos.
 * standard: 200 dpi aus der 2048-Pixel-Version von OneDrive – gut für Fotobücher, Datei bleibt handlich.
 * high: 300 dpi aus dem Original (etwa 3–4 Mal grösser, dauert länger; am besten am PC).
 */
export const QUALITY = {
  standard: { pxPerMm: 7.9, jpeg: 0.9, original: false },
  high: { pxPerMm: 11.8, jpeg: 0.92, original: true },
};

/** Touren im Zeitraum mit ihren gelikten Fotos (ohne Videos), älteste zuerst. */
export function photobookSelection(doc, fromIso, toIso) {
  return visibleTours(doc)
    .filter((t) => t.dates.value.start >= fromIso && t.dates.value.start <= toIso)
    .map((t) => ({ tour: t, photos: t.photos.filter((p) => isLiked(p) && p.oneDriveItemId && !isVideoName(p.fileName)) }))
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
  creme: { label: 'Creme', bg: [246, 241, 232], title: [52, 44, 36], text: [128, 116, 100], accent: [166, 124, 82], frame: true },
  weiss: { label: 'Weiss', bg: [255, 255, 255], title: [34, 34, 34], text: [120, 120, 120], accent: [46, 94, 78], frame: false },
  dunkel: { label: 'Dunkel', bg: [30, 31, 33], title: [240, 238, 232], text: [165, 160, 150], accent: [201, 169, 110], frame: false },
};

const FRAME_MM = 1.5;

// Schrift für die Tournamen (Bebas Neue, frei verwendbar), mit Prüfsumme wie jsPDF
const TITLE_FONT_URL = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/bebas-neue@0.4.1/400Regular/BebasNeue_400Regular.ttf';
const TITLE_FONT_SRI = 'sha256-gw6hhqz/wjFu0aTkIxkka6O0awTjOiEQeSSb+QEZPwQ=';
let titleFont = null;

/** Schrift laden (base64) oder null – dann wird eine Standardschrift genommen. */
async function loadTitleFont() {
  if (titleFont) return titleFont;
  try {
    const res = await fetch(TITLE_FONT_URL, { integrity: TITLE_FONT_SRI });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    titleFont = btoa(bin);
    return titleFont;
  } catch {
    return null;
  }
}

/** Kopf einer Seite: Akzent-Balken, Tourname gross, daneben Route · Datum; unten rechts die Seitenzahl. */
function drawPage(pdf, tour, theme, hasTitleFont, pageNo) {
  const { w, h, margin } = PAGE;
  pdf.setFillColor(...theme.bg);
  pdf.rect(0, 0, w, h, 'F');
  pdf.setFillColor(...theme.accent);
  pdf.rect(margin, margin, 1.6, 7, 'F');
  const x = margin + 4.5;
  const base = margin + 6.6;
  if (hasTitleFont) pdf.setFont('BebasNeue', 'normal');
  else pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(hasTitleFont ? 24 : 16);
  pdf.setTextColor(...theme.title);
  const title = hasTitleFont ? tour.mountain.value.toUpperCase() : tour.mountain.value;
  pdf.text(title, x, base);
  const titleW = pdf.getTextWidth(title); // in der Titelschrift messen
  const sub = [tour.routeName?.value, dateRange(tour.dates.value)].filter(Boolean).join('  ·  ');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(...theme.text);
  pdf.text(sub, x + titleW + 4, base);
  pdf.setFontSize(8);
  pdf.text(String(pageNo), w - margin, h - 5, { align: 'right' });
}

/**
 * Fotos einer Tour auf Seiten verteilen: locker gemischt 1–4 Fotos pro Seite (mehrere öfter als einzelne).
 * random = Zufallszahl 0..1 (für Tests einstellbar). Ergebnis: Liste von Foto-Gruppen.
 */
export function groupPhotos(photos, random = Math.random) {
  const sizes = [1, 2, 2, 3, 3, 4, 4, 4];
  const groups = [];
  let rest = [...photos];
  while (rest.length) {
    let n = sizes[Math.floor(random() * sizes.length)];
    if (rest.length - n === 1 && n > 1) n -= 1; // kein einzelnes Foto allein übrig lassen
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
export function layoutCells(ratios, random = Math.random) {
  const { w, h, margin, captionH, gap } = PAGE;
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
  const i = items.findIndex((x) => x.ratio >= 1);
  return i > 0 ? [items[i], ...items.filter((_, k) => k !== i)] : items;
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

async function fetchBlob(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.blob();
}

/**
 * Foto laden -> ImageBitmap, oder null wenn es nicht geht. Standard: 2048-Pixel-Version von OneDrive;
 * hoch: das Original (kann der Browser es nicht lesen, z. B. HEIC vom iPhone, dann doch die 2048-Pixel-Version).
 * Bei Netzfehlern ("Failed to fetch") mehrmals versuchen, jedes Mal mit frischer Adresse.
 */
async function loadPhoto(drive, photo, wait, quality) {
  let useOriginal = quality.original;
  for (let attempt = 0; ; attempt++) {
    try {
      if (useOriginal) {
        const url = await drive.downloadUrl(photo.oneDriveItemId);
        if (!url) return null; // auf OneDrive nicht mehr vorhanden
        const blob = await fetchBlob(url);
        try {
          return await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch {
          useOriginal = false; // Format kann der Browser nicht lesen
        }
      }
      const url = await drive.thumbnailUrl(photo.oneDriveItemId, 'c2048x2048');
      if (!url) return null;
      return await createImageBitmap(await fetchBlob(url));
    } catch (e) {
      if (e?.status === 401) throw e; // abgemeldet: nicht weiter versuchen
      if (e?.status === 404) return null;
    }
    if (attempt >= RETRY_WAITS_MS.length) return null;
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
  const data = canvas.toDataURL('image/jpeg', quality.jpeg);
  canvas.width = canvas.height = 0; // Speicher gleich freigeben
  return { data, x, y, w, h };
}

/**
 * Erstellt das PDF. onProgress(fertig, gesamt). Ergebnis: { blob (application/pdf), missing: [Dateinamen] }.
 * Fotos, die auch nach mehreren Versuchen nicht laden, fehlen im PDF und stehen in missing.
 * Die Fotos werden der Reihe nach geladen, damit auch grosse Bücher wenig Speicher brauchen.
 */
export async function createPhotobookPdf(drive, selection, onProgress = () => {}, { wait = sleep, quality = QUALITY.standard, theme = THEMES.creme } = {}) {
  const { jsPDF } = await loadJsPdf();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const font = await loadTitleFont();
  if (font) {
    pdf.addFileToVFS('BebasNeue.ttf', font);
    pdf.addFont('BebasNeue.ttf', 'BebasNeue', 'normal');
  }
  const hasTitleFont = Boolean(font);
  const total = selection.reduce((n, x) => n + x.photos.length, 0);
  const missing = [];
  let done = 0;
  let pages = 0;
  for (const { tour, photos } of selection) {
    for (const group of groupPhotos(photos)) {
      const items = [];
      for (const photo of group) {
        const bitmap = await loadPhoto(drive, photo, wait, quality);
        if (bitmap) items.push({ bitmap, ratio: bitmap.width / bitmap.height });
        else {
          missing.push(photo.fileName);
          onProgress(++done, total);
        }
      }
      if (!items.length) continue;
      if (pages++) pdf.addPage('a4', 'landscape');
      drawPage(pdf, tour, theme, hasTitleFont, pages);
      const ordered = orderForLayout(items);
      const cells = layoutCells(ordered.map((i) => i.ratio));
      const f = theme.frame ? FRAME_MM : 0;
      ordered.forEach((item, i) => {
        const c = cells[i];
        const img = renderCell(item.bitmap, { ...c, x: c.x + f, y: c.y + f, w: c.w - 2 * f, h: c.h - 2 * f }, quality);
        if (f) {
          // weisser Rand wie bei einem Abzug
          pdf.setFillColor(255, 255, 255);
          pdf.rect(img.x - f, img.y - f, img.w + 2 * f, img.h + 2 * f, 'F');
        }
        pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
        item.bitmap.close?.();
        onProgress(++done, total);
      });
    }
  }
  if (!pages) throw new Error('Keines der Fotos konnte von OneDrive geladen werden. Bitte Internet prüfen und nochmals versuchen.');
  return { blob: pdf.output('blob'), missing };
}

// ---------- Bildschirm ----------

/** state = { from, to, running, progress, error } bleibt zwischen Aufrufen erhalten. */
export function renderPhotobook(root, ctx, state) {
  const year = todayIso().slice(0, 4);
  state.from ??= `${year}-01-01`;
  state.to ??= `${year}-12-31`;
  const selection = photobookSelection(ctx.book.current(), state.from, state.to);
  const photoTotal = selection.reduce((n, x) => n + x.photos.length, 0);
  root.innerHTML = `
    ${topbar('Fotobuch', { back: true })}
    <div class="section"><div class="panel">
      <p class="muted" style="margin-top:0">Alle Fotos mit ♥ aus den Touren im gewählten Zeitraum als PDF (A4 Querformat),
        z. B. zum Drucken als Fotobuch. Jede Tour beginnt auf einer neuen Seite mit Tourname, Route und Datum.</p>
      <div class="dates">
        <label class="field"><span>Von</span><input type="date" id="pbFrom" value="${state.from}" ${state.running ? 'disabled' : ''}></label>
        <label class="field"><span>Bis</span><input type="date" id="pbTo" value="${state.to}" ${state.running ? 'disabled' : ''}></label>
      </div>
      <div style="margin-bottom:12px"><span class="muted" style="font-size:.85rem">Hintergrund</span>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
          ${Object.entries(THEMES).map(([key, t]) => `
            <label style="display:flex;gap:6px;align-items:center;font-weight:normal">
              <input type="radio" name="pbTheme" value="${key}" ${(state.theme ?? 'creme') === key ? 'checked' : ''} ${state.running ? 'disabled' : ''}>
              <span style="width:18px;height:18px;border-radius:4px;border:1px solid #9998;background:rgb(${t.bg.join(',')})"></span>${t.label}
            </label>`).join('')}
        </div>
      </div>
      <div style="margin-bottom:12px"><span class="muted" style="font-size:.85rem">Druckqualität</span>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-weight:normal"><input type="radio" name="pbQuality" value="standard" ${state.quality !== 'high' ? 'checked' : ''} ${state.running ? 'disabled' : ''}>
          Standard (200 dpi) – kleine Datei, schnell</label>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;font-weight:normal"><input type="radio" name="pbQuality" value="high" ${state.quality === 'high' ? 'checked' : ''} ${state.running ? 'disabled' : ''}>
          Hoch (300 dpi, aus den Originalen) – etwa 3–4 Mal grösser, dauert länger, am besten am PC</label>
      </div>
      <p><strong>${selection.length} ${selection.length === 1 ? 'Tour' : 'Touren'} · ${photoTotal} ${photoTotal === 1 ? 'Foto' : 'Fotos'} mit ♥</strong></p>
      ${selection.length ? `<ul class="pblist">${selection.map((x) => `<li>${esc(captionOf(x.tour))} <span class="muted">(${x.photos.length})</span></li>`).join('')}</ul>` : '<p class="muted">Keine Fotos mit ♥ in diesem Zeitraum. Like Fotos in der Grossansicht mit dem Herz.</p>'}
      ${state.running
        ? `<div class="upload"><div class="uploadtext">Erstelle PDF … Foto ${state.progress[0]} von ${state.progress[1]}</div>
           <div class="bar"><span style="width:${Math.round((100 * state.progress[0]) / Math.max(1, state.progress[1]))}%"></span></div></div>`
        : `<button class="btn wide" id="pbCreate" ${selection.length && !ctx.demo ? '' : 'disabled'}>PDF erstellen</button>`}
      ${state.error ? `<p class="formerror">${esc(state.error)}</p>` : ''}
      <p class="muted" style="font-size:.85rem">Tipp: am PC erstellen – bei vielen Fotos braucht das PDF einiges an Speicher.</p>
    </div></div>`;
  const from = root.querySelector('#pbFrom');
  const to = root.querySelector('#pbTo');
  const onDate = () => {
    state.from = from.value || state.from;
    state.to = to.value || state.to;
    renderPhotobook(root, ctx, state);
  };
  from.onchange = onDate;
  to.onchange = onDate;
  root.querySelectorAll('input[name="pbQuality"]').forEach((r) => (r.onchange = () => (state.quality = r.value)));
  root.querySelectorAll('input[name="pbTheme"]').forEach((r) => (r.onchange = () => (state.theme = r.value)));
  root.querySelector('#pbCreate')?.addEventListener('click', async () => {
    state.running = true;
    state.error = null;
    state.progress = [0, photoTotal];
    renderPhotobook(root, ctx, state);
    try {
      const { blob, missing } = await createPhotobookPdf(ctx.drive, selection, (d, t) => {
        state.progress = [d, t];
        const text = root.querySelector('.uploadtext');
        const bar = root.querySelector('.bar span');
        if (text) text.textContent = `Erstelle PDF … Foto ${d} von ${t}`;
        if (bar) bar.style.width = `${Math.round((100 * d) / Math.max(1, t))}%`;
      }, { quality: QUALITY[state.quality] ?? QUALITY.standard, theme: THEMES[state.theme] ?? THEMES.creme });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Fotobuch_${state.from}_bis_${state.to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      if (missing.length) {
        state.error = `PDF erstellt, aber ${missing.length} ${missing.length === 1 ? 'Foto konnte' : 'Fotos konnten'} nicht geladen werden `
          + `und ${missing.length === 1 ? 'fehlt' : 'fehlen'}: ${missing.join(', ')}. Am besten nochmals erstellen.`;
      }
    } catch (e) {
      console.error(e);
      state.error = e.status === 401 ? 'Bitte neu bei OneDrive anmelden und nochmals versuchen.'
        : /fetch|network/i.test(e.message || '') ? 'Keine Verbindung zu OneDrive. Bitte Internet prüfen und nochmals versuchen.'
        : e.message || 'Das PDF konnte nicht erstellt werden.';
    } finally {
      state.running = false;
      if (root.isConnected && location.hash.startsWith('#/fotobuch')) renderPhotobook(root, ctx, state);
    }
  });
}
