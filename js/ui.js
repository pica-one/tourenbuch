// Kleine Hilfen für die Darstellung, die mehrere Bildschirme brauchen.

import { icon } from './icons.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function topbar(title, { back = false, actions = '' } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="iconbtn" data-action="back" aria-label="Zurück">${icon('back')}</button>` : '<span style="width:44px"></span>'}
    <h1>${esc(title)}</h1>
    ${actions || '<span style="width:44px"></span>'}
  </header>`;
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Eintägig: "27.09.2026". Mehrtägig: "27.09.2026 – 29.09.2026". */
export function dateRange({ start, end }) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

/** Anzahl Tage inklusive Start und Ende. */
export function dayCount({ start, end }) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

export function stars(r) {
  const n = Math.max(0, Math.min(5, r));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function photoCount(n) {
  return n === 1 ? '1 Foto' : `${n} Fotos`;
}

/** "44 Fotos · 2 Videos" (Videos nur, wenn es welche hat) */
export function mediaCount(photos, videos) {
  const v = videos === 1 ? '1 Video' : `${videos} Videos`;
  if (!videos) return photoCount(photos);
  return photos ? `${photoCount(photos)} · ${v}` : v;
}

export function dateTime(ms) {
  return new Date(ms).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Heute als "JJJJ-MM-TT" (lokale Zeit). */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let toastTimer = null;
export function showToast(text) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- Vorschläge (wie Suggestions.kt) ----------

/** Leerzeichen am Rand weg, mehrfache Leerzeichen innen zu einem. */
export function normalizeText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

export function sameText(a, b) {
  return normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();
}

/** Frühere Eingaben (neueste zuerst) ohne Doppelte: häufige zuerst, bei Gleichstand die zuletzt verwendete. */
export function rankByUse(values) {
  const groups = new Map();
  values.map(normalizeText).filter(Boolean).forEach((v, index) => {
    const key = v.toLowerCase();
    if (!groups.has(key)) groups.set(key, { value: v, index, count: 0 });
    groups.get(key).count++;
  });
  return [...groups.values()].sort((a, b) => b.count - a.count || a.index - b.index).map((g) => g.value);
}
