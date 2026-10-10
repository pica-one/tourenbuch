// Foto-Betrachter im Vollbild (wie PhotoViewer.kt in der App): wischen, Doppeltipp = zoomen,
// Original herunterladen, teilen. Die Bilder kommen in guter Qualität (2048 px) von OneDrive.

import { icon } from './icons.js';
import { isVideoName } from './tourbook.js';
import { esc, showToast } from './ui.js';

/**
 * photos: [{ id, fileName, oneDriveItemId }], start: Index
 * drive: OneDrive-Zugriff; thumbs: Map itemId -> { thumb, large } (schon geladene Vorschaubilder)
 * onRemove(photo): optional, "Aus Tour entfernen"
 */
export function openViewer({ photos, start, drive, thumbs, onRemove }) {
  let index = start;
  let zoom = false;
  const bigUrls = new Map();

  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Foto');
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const canShare = !!navigator.canShare;

  function draw() {
    const p = photos[index];
    const video = isVideoName(p.fileName);
    const known = thumbs.get(p.oneDriveItemId);
    el.classList.toggle('has-video', video);
    el.innerHTML = `
      <div class="viewer-bar">
        <button class="iconbtn" data-v="close" aria-label="Schliessen">${icon('close')}</button>
        <span class="viewer-title">${esc(p.fileName)}<small>${index + 1} / ${photos.length}${video ? ' · Video' : ''}</small></span>
        ${canShare && !video ? `<button class="iconbtn" data-v="share" aria-label="Teilen">${icon('share')}</button>` : ''}
        <button class="iconbtn" data-v="download" aria-label="Original herunterladen">${icon('download')}</button>
        ${onRemove ? `<button class="iconbtn" data-v="remove" aria-label="Aus Tour entfernen">${icon('delete')}</button>` : ''}
      </div>
      <div class="viewer-stage${zoom && !video ? ' zoomed' : ''}">${
        video
          ? `<video controls playsinline preload="metadata" ${known?.large || known?.thumb ? `poster="${esc(known.large ?? known.thumb)}"` : ''}></video><p class="viewer-msg" hidden></p>`
          : `<img alt="${esc(p.fileName)}" draggable="false">`
      }</div>
      ${photos.length > 1 ? `<button class="viewer-nav prev" data-v="prev" aria-label="Vorheriges">‹</button><button class="viewer-nav next" data-v="next" aria-label="Nächstes">›</button>` : ''}`;
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      action(b.dataset.v);
    }));
    const stage = el.querySelector('.viewer-stage');
    if (video) {
      // Video direkt von OneDrive abspielen (die Adresse ist vorab berechtigt, es wird nur geladen, was man schaut)
      const v = stage.querySelector('video');
      drive
        .downloadUrl(p.oneDriveItemId)
        .then((url) => {
          if (photos[index] !== p || !v.isConnected) return;
          if (url) v.src = url;
          else showMsg(stage, 'Video auf OneDrive nicht gefunden.');
        })
        .catch((e) => showMsg(stage, e.message || 'Video konnte nicht geladen werden.'));
      v.onerror = () => showMsg(stage, 'Dieses Video kann der Browser nicht abspielen – mit ⬇ herunterladen und im Video-Player öffnen.');
    } else {
      const img = stage.querySelector('img');
      img.src = bigUrls.get(p.oneDriveItemId) ?? known?.large ?? known?.thumb ?? '';
      loadBig(p).then((url) => {
        if (url && photos[index] === p) img.src = url;
      });
      stage.ondblclick = toggleZoom;
      bindSwipe(stage); // beim Video nicht: dort wischt man auf der Zeitleiste
    }
    // Nachbarn vorausladen (nur Fotos)
    [index - 1, index + 1].forEach((i) => photos[i] && !isVideoName(photos[i].fileName) && loadBig(photos[i]));
  }

  function showMsg(stage, text) {
    const m = stage.querySelector('.viewer-msg');
    if (!m) return;
    m.textContent = text;
    m.hidden = false;
  }

  async function loadBig(p) {
    if (bigUrls.has(p.oneDriveItemId)) return bigUrls.get(p.oneDriveItemId);
    try {
      const url = await drive.thumbnailUrl(p.oneDriveItemId, 'c2048x2048');
      if (url) {
        bigUrls.set(p.oneDriveItemId, url);
        new Image().src = url;
      }
      return url;
    } catch {
      return null;
    }
  }

  function toggleZoom() {
    if (isVideoName(photos[index].fileName)) return;
    zoom = !zoom;
    el.querySelector('.viewer-stage').classList.toggle('zoomed', zoom);
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    index = next;
    zoom = false;
    draw();
  }

  async function action(a) {
    const p = photos[index];
    if (a === 'close') close();
    else if (a === 'prev') go(-1);
    else if (a === 'next') go(1);
    else if (a === 'download') {
      try {
        const url = await drive.downloadUrl(p.oneDriveItemId);
        if (url) location.href = url;
        else showToast('Foto auf OneDrive nicht gefunden.');
      } catch (e) {
        showToast(e.message);
      }
    } else if (a === 'share') share(p);
    else if (a === 'remove') {
      if (!confirm(`„${p.fileName}“ aus dieser Tour entfernen? Auf OneDrive bleibt das Foto erhalten.`)) return;
      await onRemove(p);
      photos.splice(index, 1);
      if (!photos.length) return close();
      index = Math.min(index, photos.length - 1);
      draw();
    }
  }

  async function share(p) {
    try {
      // Angezeigte Qualität teilen (wie in der App), sonst das Original
      let blob = null;
      const big = await loadBig(p);
      if (big) blob = await fetch(big).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      if (!blob) {
        const url = await drive.downloadUrl(p.oneDriveItemId);
        blob = url ? await fetch(url).then((r) => r.blob()) : null;
      }
      if (!blob) return showToast('Foto konnte nicht geladen werden.');
      const name = p.fileName.replace(/\.[^.]+$/, '') + '.jpg';
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
      else showToast('Teilen wird von diesem Browser nicht unterstützt.');
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Teilen fehlgeschlagen.');
    }
  }

  function bindSwipe(stage) {
    let x0 = null;
    let y0 = null;
    let lastTap = 0;
    stage.onpointerdown = (e) => {
      x0 = e.clientX;
      y0 = e.clientY;
    };
    stage.onpointerup = (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      x0 = null;
      if (!zoom && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
      if (!zoom && dy > 120 && Math.abs(dy) > Math.abs(dx)) return close(); // nach unten wischen = schliessen
      // Doppeltipp auf Touch-Geräten
      if (e.pointerType === 'touch' && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const now = Date.now();
        if (now - lastTap < 300) toggleZoom();
        lastTap = now;
      }
    };
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  function onPop() {
    close(true);
  }

  function close(fromHistory = false) {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    document.body.style.overflow = '';
    el.remove();
    if (!fromHistory) history.back();
  }

  // "Zurück" (Handy-Taste) schliesst den Betrachter statt die Seite zu verlassen
  history.pushState({ viewer: true }, '');
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  draw();
}
