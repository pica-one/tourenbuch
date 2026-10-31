// Fotobuch: alle gelikten Fotos (♥) der Touren in einem Zeitraum als PDF, A4 Querformat, zum Drucken lassen.
// Jede Tour beginnt auf einer neuen Seite, oben Tourname · Route · Datum; pro Seite 1–4 Fotos, locker gemischt.
// Touren ohne gelikte Fotos kommen nicht vor. Videos und Topos auch nicht.

import { isLiked, isVideoName, visibleTours } from './tourbook.js';
import { dateRange, esc, todayIso, topbar } from './ui.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';

// Seite A4 quer in mm
export const PAGE = { w: 297, h: 210, margin: 12, captionH: 10, gap: 4 };
/** Druckqualität: Bildpunkte pro mm (200 dpi ≈ 7.9) – gut für Fotobücher, Datei bleibt handlich. */
const PX_PER_MM = 7.9;

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

/** Foto in Druckqualität laden (2048 px von OneDrive) -> ImageBitmap */
async function loadPhoto(drive, photo) {
  const url = await drive.thumbnailUrl(photo.oneDriveItemId, 'c2048x2048');
  if (!url) throw new Error(`„${photo.fileName}“ ist auf OneDrive nicht mehr zu finden.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`„${photo.fileName}“ konnte nicht geladen werden.`);
  return createImageBitmap(await res.blob());
}

/** Bild für ein Feld zuschneiden (cover) bzw. einpassen (contain) und als JPEG liefern. */
function renderCell(bitmap, cell) {
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
  canvas.width = Math.max(1, Math.min(Math.round(w * PX_PER_MM), Math.round(sw)));
  canvas.height = Math.max(1, Math.round(canvas.width * (h / w)));
  const ctx2d = canvas.getContext('2d');
  ctx2d.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.9), x, y, w, h };
}

/**
 * Erstellt das PDF. onProgress(fertig, gesamt). Ergebnis: Blob (application/pdf).
 * Die Fotos werden der Reihe nach geladen, damit auch grosse Bücher wenig Speicher brauchen.
 */
export async function createPhotobookPdf(drive, selection, onProgress = () => {}) {
  const { jsPDF } = await loadJsPdf();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const total = selection.reduce((n, x) => n + x.photos.length, 0);
  let done = 0;
  let first = true;
  for (const { tour, photos } of selection) {
    for (const group of groupPhotos(photos)) {
      if (!first) pdf.addPage('a4', 'landscape');
      first = false;
      // Tourname · Route · Datum über den Fotos
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(60, 60, 60);
      pdf.text(captionOf(tour), PAGE.margin, PAGE.margin + 5);
      const items = [];
      for (const photo of group) {
        const bitmap = await loadPhoto(drive, photo);
        items.push({ bitmap, ratio: bitmap.width / bitmap.height });
      }
      const ordered = orderForLayout(items);
      const cells = layoutCells(ordered.map((i) => i.ratio));
      ordered.forEach((item, i) => {
        const img = renderCell(item.bitmap, cells[i]);
        pdf.addImage(img.data, 'JPEG', img.x, img.y, img.w, img.h, undefined, 'FAST');
        item.bitmap.close?.();
        onProgress(++done, total);
      });
    }
  }
  return pdf.output('blob');
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
      <p><strong>${selection.length} ${selection.length === 1 ? 'Tour' : 'Touren'} · ${photoTotal} ${photoTotal === 1 ? 'Foto' : 'Fotos'} mit ♥</strong></p>
      ${selection.length ? `<ul class="pblist">${selection.map((x) => `<li>${esc(captionOf(x.tour))} <span class="muted">(${x.photos.length})</span></li>`).join('')}</ul>` : '<p class="muted">Keine Fotos mit ♥ in diesem Zeitraum. Like Fotos in der Grossansicht mit dem Herz.</p>'}
      ${state.running
        ? `<div class="upload"><div class="uploadtext">Erstelle PDF … Foto ${state.progress[0]} von ${state.progress[1]}</div>
           <div class="bar"><span style="width:${Math.round((100 * state.progress[0]) / Math.max(1, state.progress[1]))}%"></span></div></div>`
        : `<button class="btn wide" id="pbCreate" ${selection.length && !ctx.demo ? '' : 'disabled'}>PDF erstellen</button>`}
      ${state.error ? `<p class="formerror">${esc(state.error)}</p>` : ''}
      <p class="muted" style="font-size:.85rem">Tipp: am PC erstellen – bei vielen Fotos braucht das PDF einiges an Speicher.
        Die Fotos werden in Druckqualität (ca. 200 dpi) von OneDrive geladen.</p>
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
  root.querySelector('#pbCreate')?.addEventListener('click', async () => {
    state.running = true;
    state.error = null;
    state.progress = [0, photoTotal];
    renderPhotobook(root, ctx, state);
    try {
      const blob = await createPhotobookPdf(ctx.drive, selection, (d, t) => {
        state.progress = [d, t];
        const text = root.querySelector('.uploadtext');
        const bar = root.querySelector('.bar span');
        if (text) text.textContent = `Erstelle PDF … Foto ${d} von ${t}`;
        if (bar) bar.style.width = `${Math.round((100 * d) / Math.max(1, t))}%`;
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Fotobuch_${state.from}_bis_${state.to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch (e) {
      console.error(e);
      state.error = e.message || 'Das PDF konnte nicht erstellt werden.';
    } finally {
      state.running = false;
      if (root.isConnected && location.hash.startsWith('#/fotobuch')) renderPhotobook(root, ctx, state);
    }
  });
}
