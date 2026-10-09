// Bildschirm einer Tour: Angaben, Details, Fotos (Raster + Betrachter), Topo, GPX – Reihenfolge wie in der App.

import { icon, typeBadge, typeLabel } from './icons.js';
import { reconcileFolder, reconcileText, removeFile } from './tourbook.js';
import { dateRange, dayCount, esc, showToast, stars, topbar } from './ui.js';
import { openViewer } from './viewer.js';

/** Vorschaubilder: itemId -> { thumb, large } (für diese Sitzung; OneDrive-Adressen laufen nach einiger Zeit ab) */
const thumbs = new Map();
const folderLoaded = new Map(); // folderId -> Zeitpunkt
const THUMB_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * ctx: { book, drive, uploader, demo, afterChange() }
 */
export function renderTour(root, id, ctx) {
  const t = ctx.book.current().tours.find((x) => x.id === id && x.deleted == null);
  if (!t) {
    root.innerHTML = topbar('Tour', { back: true }) + '<div class="empty">Diese Tour gibt es nicht mehr.</div>';
    return;
  }
  const label = typeLabel(t.tourType.value, t.customType?.value);
  const d = t.dates.value;
  const days = dayCount(d);
  const partners = t.partners?.value ?? [];
  const folder = t.oneDriveFolder?.value;
  const photos = t.photos.filter((p) => p.deleted == null);
  const topos = t.attachments.filter((a) => a.deleted == null && a.kind === 'TOPO');
  const gpx = t.attachments.filter((a) => a.deleted == null && a.kind === 'GPX');
  const offline = ctx.demo;

  root.innerHTML = `
    ${topbar(t.mountain.value, {
      back: true,
      actions: `<span><a class="iconbtn" href="#/edit/${encodeURIComponent(t.id)}" aria-label="Bearbeiten">${icon('edit')}</a><button class="iconbtn" data-action="delete" data-id="${esc(t.id)}" aria-label="Löschen">${icon('delete')}</button></span>`,
    })}
    <div class="section">
      <div class="panel">
        <div class="head">${typeBadge(t.tourType.value, 56, esc(label))}
          <div><div class="title">${esc(t.mountain.value)}</div>${t.routeName?.value ? `<div class="sub">${esc(t.routeName.value)}</div>` : ''}</div>
        </div>
        <dl class="rows">
          <dt>Tourenart</dt><dd>${esc(label)}</dd>
          <dt>Datum</dt><dd>${dateRange(d)}${days > 1 ? ` <span class="muted">(${days} Tage)</span>` : ''}</dd>
          <dt>Bewertung</dt><dd class="stars">${stars(t.rating?.value ?? 0)}</dd>
          ${partners.length ? `<dt>Partner</dt><dd>${esc(partners.join(', '))}</dd>` : ''}
          ${folder?.path ? `<dt>OneDrive</dt><dd><button class="linkbtn" data-open-folder>${esc(folder.path)}</button></dd>` : ''}
        </dl>
      </div>
    </div>
    ${t.details?.value ? `<div class="section"><h2>Details</h2><div class="panel notes">${esc(t.details.value)}</div></div>` : ''}

    <div class="section">
      <div class="sectionhead"><h2>Fotos${photos.length ? ` <span class="muted">(${photos.length})</span>` : ''}</h2>
        <button class="btn outline small" data-add="PHOTO" ${offline ? 'disabled' : ''}>${icon('add', 18)} Fotos</button></div>
      ${folder?.path && !offline ? `<button class="btn outline wide folderSync" data-folder-sync>${icon('sync', 18)} Mit OneDrive abgleichen</button>` : ''}
      <div id="uploadstatus"></div>
      ${photos.length
        ? `<div class="grid">${photos.map((p, i) => `<button class="cell" data-photo="${i}" aria-label="${esc(p.fileName)}"><img data-item="${esc(p.oneDriveItemId)}" alt="" loading="lazy"></button>`).join('')}</div>`
        : '<div class="panel muted">Keine Fotos</div>'}
    </div>
    ${fileSection('Topo', 'TOPO', topos, offline)}
    ${fileSection('GPX', 'GPX', gpx, offline)}
    <input type="file" id="pickPHOTO" accept="image/*" multiple hidden>
    <input type="file" id="pickTOPO" accept="image/*,application/pdf,.pdf" multiple hidden>
    <input type="file" id="pickGPX" accept=".gpx,application/gpx+xml" multiple hidden>`;

  // Ordner im OneDrive-Web öffnen
  root.querySelector('[data-open-folder]')?.addEventListener('click', () => openItem(ctx, folder));

  // Hinzufügen
  root.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => root.querySelector(`#pick${b.dataset.add}`).click();
  });
  for (const kind of ['PHOTO', 'TOPO', 'GPX']) {
    root.querySelector(`#pick${kind}`).onchange = (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (files.length) ctx.uploader.add(t.id, files, kind === 'PHOTO' ? null : kind);
    };
  }
  updateUploadStatus(root, t.id, ctx.uploader);
  root.querySelector('[data-folder-sync]')?.addEventListener('click', (e) => syncFolder(ctx, t.id, e.currentTarget));

  // Topo/GPX: herunterladen, entfernen
  root.querySelectorAll('[data-download]').forEach((b) => (b.onclick = () => download(ctx, b.dataset.download)));
  root.querySelectorAll('[data-remove-file]').forEach((b) => {
    b.onclick = async () => {
      const f = t.attachments.find((a) => a.id === b.dataset.removeFile);
      if (!f || !confirm(`„${f.fileName}“ aus dieser Tour entfernen? Auf OneDrive bleibt die Datei erhalten.`)) return;
      await ctx.book.update((doc) => removeFile(doc, t.id, f.id, Date.now()));
      ctx.afterChange();
    };
  });

  // Fotos: Betrachter
  root.querySelectorAll('[data-photo]').forEach((b) => {
    b.onclick = () =>
      openViewer({
        photos: [...photos],
        start: Number(b.dataset.photo),
        drive: ctx.drive,
        thumbs,
        onRemove: offline
          ? null
          : async (p) => {
              await ctx.book.update((doc) => removeFile(doc, t.id, p.id, Date.now()));
              ctx.afterChange();
            },
      });
  });

  fillThumbs(root, ctx.drive);
  if (!offline && photos.length) loadThumbs(ctx.drive, folder, photos).then(() => fillThumbs(root, ctx.drive));
}

function fileSection(title, kind, files, offline) {
  return `<div class="section">
    <div class="sectionhead"><h2>${title}</h2>
      <button class="btn outline small" data-add="${kind}" ${offline ? 'disabled' : ''}>${icon('add', 18)} ${title}</button></div>
    ${files.length
      ? `<div class="panel"><ul class="files">${files.map((f) => `<li><span class="name">${esc(f.fileName)}</span>
          <button class="iconbtn" data-download="${esc(f.oneDriveItemId)}" aria-label="Herunterladen" ${offline ? 'disabled' : ''}>${icon('download')}</button>
          <button class="iconbtn" data-remove-file="${esc(f.id)}" aria-label="Entfernen" ${offline ? 'disabled' : ''}>${icon('close', 20)}</button></li>`).join('')}</ul></div>`
      : `<div class="panel muted">Kein ${title}</div>`}
  </div>`;
}

/** Nur den Hochlade-Fortschritt neu zeichnen (wird oft aufgerufen). */
export function updateUploadStatus(root, tourId, uploader) {
  const box = root.querySelector('#uploadstatus');
  if (!box) return;
  box.innerHTML = uploadStatus(tourId, uploader);
  box.querySelector('[data-retry]')?.addEventListener('click', () => uploader.retryFailed());
}

/** Hochladen: Fortschritt und Fehler dieser Tour */
function uploadStatus(tourId, uploader) {
  const s = uploader.status();
  const mine = s.current?.tourId === tourId;
  const failed = s.failed.filter((f) => f.tourId === tourId);
  let html = '';
  if (mine) {
    const pct = Math.round((s.current.progress ?? 0) * 100);
    html += `<div class="upload"><div class="uploadtext">Lade hoch: ${esc(s.current.name)} (${pct} %)${s.waiting ? ` · noch ${s.waiting} weitere` : ''}</div>
      <div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }
  if (failed.length) {
    html += `<div class="upload error">${failed.length === 1 ? '1 Datei wurde' : `${failed.length} Dateien wurden`} nicht hochgeladen: ${esc(failed[0].reason)}
      <button class="btn outline small" data-retry>Nochmals versuchen</button></div>`;
  }
  return html;
}

function fillThumbs(root, drive) {
  root.querySelectorAll('img[data-item]').forEach((img) => {
    const itemId = img.dataset.item;
    const t = thumbs.get(itemId);
    if (!t?.thumb || img.dataset.tries) return;
    if (img.getAttribute('src') !== t.thumb) img.src = t.thumb;
    // Kurz nach dem Hochladen ist das Vorschaubild bei OneDrive manchmal noch nicht fertig:
    // zuerst die andere Grösse versuchen, dann nach einigen Sekunden eine neue Adresse holen.
    img.onerror = async () => {
      const tries = Number(img.dataset.tries || 0) + 1;
      img.dataset.tries = String(tries);
      const known = thumbs.get(itemId);
      if (tries === 1 && known?.large && known.large !== img.src) {
        img.src = known.large;
        return;
      }
      if (tries > 3) return;
      await new Promise((r) => setTimeout(r, 3000 * tries));
      if (!img.isConnected) return;
      try {
        const url = await drive.thumbnailUrl(itemId, 'c400x400');
        if (url) {
          thumbs.set(itemId, { thumb: url, large: null, at: Date.now() });
          img.src = url;
        }
      } catch {
        /* dann bleibt es grau */
      }
    };
  });
}

/** Vorschaubilder holen: zuerst alle des Tour-Ordners auf einmal, fehlende einzeln. */
async function loadThumbs(drive, folder, photos) {
  const fresh = (id) => {
    const t = thumbs.get(id);
    return t && Date.now() - t.at < THUMB_MAX_AGE_MS;
  };
  try {
    if (folder?.id && Date.now() - (folderLoaded.get(folder.id) ?? 0) > THUMB_MAX_AGE_MS && photos.some((p) => !fresh(p.oneDriveItemId))) {
      folderLoaded.set(folder.id, Date.now());
      for (const item of await drive.listWithThumbnails(folder.id)) {
        if (item.thumb) thumbs.set(item.id, { thumb: item.thumb, large: item.large, at: Date.now() });
      }
    }
  } catch (e) {
    console.warn('Ordner-Vorschaubilder', e);
  }
  const missing = photos.filter((p) => !fresh(p.oneDriveItemId));
  // höchstens 4 gleichzeitig
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const p = missing[next++];
      try {
        const url = await drive.thumbnailUrl(p.oneDriveItemId, 'c400x400');
        if (url) thumbs.set(p.oneDriveItemId, { thumb: url, large: null, at: Date.now() });
      } catch {
        /* einzelnes fehlendes Bild ist kein Problem */
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** "Mit OneDrive abgleichen": Fotos/Topos/GPX, die am PC in den Ordner gelegt oder dort gelöscht wurden, übernehmen. */
async function syncFolder(ctx, tourId, button) {
  const tour = ctx.book.current().tours.find((x) => x.id === tourId);
  const folder = tour?.oneDriveFolder?.value;
  if (!folder?.path) return showToast('Diese Tour hat noch keinen Ordner auf OneDrive.');
  button.disabled = true;
  button.classList.add('spin');
  try {
    const folderId = folder.id ?? (await ctx.drive.itemIdByPath(folder.path));
    const items = folderId ? await ctx.drive.listChildren(folderId) : null;
    if (!items) return showToast('Der Ordner der Tour wurde auf OneDrive nicht gefunden (verschoben oder gelöscht?).');
    const online = { photos: items.filter((i) => !i.isFolder), TOPO: [], GPX: [] };
    for (const [kind, name] of [['TOPO', 'Topos'], ['GPX', 'GPX']]) {
      const sub = items.find((i) => i.isFolder && i.name.toLowerCase() === name.toLowerCase());
      if (sub) online[kind] = ((await ctx.drive.listChildren(sub.id)) ?? []).filter((i) => !i.isFolder);
    }
    let result = null;
    await ctx.book.update((doc) => {
      result = reconcileFolder(doc, tourId, online, Date.now());
      return result.doc === doc ? null : result.doc;
    });
    folderLoaded.delete(folderId); // Vorschaubilder neu holen
    showToast(reconcileText(result));
    if (result.added || result.removed || result.addedFiles || result.removedFiles) ctx.afterChange();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Abgleich mit OneDrive fehlgeschlagen.');
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.classList.remove('spin');
    }
  }
}

async function openItem(ctx, folder) {
  if (!folder || ctx.demo) return;
  // Fenster sofort öffnen (sonst blockiert der Browser), Adresse danach setzen
  const win = window.open('', '_blank');
  try {
    const url = folder.id ? await ctx.drive.webUrl(folder.id) : await ctx.drive.webUrlByPath(folder.path);
    if (url && win) win.location.href = url;
    else {
      win?.close();
      showToast('Ordner auf OneDrive nicht gefunden.');
    }
  } catch (e) {
    win?.close();
    showToast(e.message);
  }
}

async function download(ctx, itemId) {
  if (!itemId || ctx.demo) return;
  try {
    const url = await ctx.drive.downloadUrl(itemId);
    if (!url) return showToast('Datei auf OneDrive nicht gefunden.');
    location.href = url; // OneDrive liefert die Datei als Download
  } catch (e) {
    showToast(e.message);
  }
}
