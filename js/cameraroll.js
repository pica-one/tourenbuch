// Fotos aus der OneDrive-App übernehmen: Die OneDrive-App am Handy lädt die Fotos MIT Aufnahmeort in den Ordner
// "Eigene Aufnahmen" (Camera Roll). Hier wählt man sie aus; sie werden auf OneDrive in den Tour-Ordner kopiert
// (uploader.addCopies). Grund: Android entfernt den Ort, wenn ein Browser die Fotos hochlädt.
// Der Knopf erscheint nur, wenn es den Ordner gibt und etwas darin ist – wer die OneDrive-App nicht nutzt, sieht nichts.

import { icon } from './icons.js';
import { isMediaItem, isVideoName } from './tourbook.js';
import { esc, fmtDate, showToast } from './ui.js';

const MAX_AUTO_PAGES = 30; // beim Suchen nach Fotos vom Tourtag höchstens so viele Seiten (je 100) von selbst laden

/** Gibt es den Ordner der OneDrive-App (mit Inhalt)? Einmal pro Sitzung gefragt. */
let rollPromise = null;
export function cameraRollInfo(drive) {
  if (!drive?.cameraRoll) return Promise.resolve(null);
  if (!rollPromise) {
    rollPromise = drive.cameraRoll().then((r) => (r && r.childCount > 0 ? r : null));
    rollPromise.catch(() => (rollPromise = null)); // Fehler: beim nächsten Mal nochmals fragen
  }
  return rollPromise;
}

/** Tag eines Fotos "JJJJ-MM-TT": Aufnahmedatum, sonst aus dem Namen (20260501_…, PXL_20260501…), sonst Änderungsdatum. */
export function photoDay(item) {
  if (item.taken) return item.taken.slice(0, 10);
  const m = /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(item.name ?? '') ?? /(?:^|\D)(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/.exec(item.name ?? '');
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  if (!item.modified) return null;
  const d = new Date(item.modified);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Liegt das Foto in den Tagen der Tour? */
export function onTourDays(item, dates) {
  const day = photoDay(item);
  return !!day && day >= dates.start && day <= (dates.end || dates.start);
}

/**
 * Auswahl öffnen. tour: die Tour; onCopy(sources) bekommt die gewählten Dateien.
 */
export function openCameraRoll({ drive, tour, onCopy }) {
  const dates = tour.dates.value;
  const inTour = new Set(tour.photos.filter((p) => p.deleted == null).map((p) => p.fileName.toLowerCase()));
  const st = {
    stack: [], // [{ id, name }] – geöffnete Ordner
    items: [],
    next: null,
    loading: false,
    error: null,
    pages: 0,
    filter: 'day', // 'day' = nur vom Tourtag, 'all'
    selected: new Map(), // id -> item
  };

  const box = document.createElement('div');
  box.className = 'picker';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Fotos aus der OneDrive-App');
  document.body.appendChild(box);
  document.body.classList.add('noscroll');

  const close = () => {
    box.remove();
    document.body.classList.remove('noscroll');
    window.removeEventListener('hashchange', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('hashchange', close);
  document.addEventListener('keydown', onKey);

  const current = () => st.stack[st.stack.length - 1];
  const media = () => st.items.filter((i) => !i.isFolder && isMediaItem({ name: i.name, mimeType: i.mimeType }));
  const visible = () => media().filter((i) => st.filter === 'all' || onTourDays(i, dates));
  const folders = () => st.items.filter((i) => i.isFolder).sort((a, b) => b.name.localeCompare(a.name, 'de', { numeric: true }));
  const isThere = (i) => inTour.has(i.name.toLowerCase());

  function draw() {
    const list = visible();
    const choosable = list.filter((i) => !isThere(i));
    const allOn = choosable.length > 0 && choosable.every((i) => st.selected.has(i.id));
    const day = fmtDate(dates.start) + (dates.end && dates.end !== dates.start ? ` – ${fmtDate(dates.end)}` : '');
    const scroll = box.querySelector('.picker-body')?.scrollTop ?? 0;
    box.innerHTML = `
      <div class="picker-bar">
        <button class="iconbtn" data-close aria-label="Schliessen">${icon('close')}</button>
        <div class="picker-title">Aus der OneDrive-App<small>${esc(st.stack.map((f) => f.name).join(' › '))}</small></div>
      </div>
      <div class="chips picker-chips">
        <button class="chip ${st.filter === 'day' ? 'on' : ''}" data-filter="day">Vom Tourtag (${esc(day)})</button>
        <button class="chip ${st.filter === 'all' ? 'on' : ''}" data-filter="all">Alle</button>
      </div>
      <div class="picker-body">
        ${st.stack.length > 1 ? `<button class="btn outline small picker-up" data-up>${icon('back', 18)} Zurück zu «${esc(st.stack[st.stack.length - 2].name)}»</button>` : ''}
        ${folders().length ? `<div class="picker-folders">${folders().map((f) => `<button class="btn outline small" data-folder="${esc(f.id)}">${icon('folder', 18)} ${esc(f.name)}</button>`).join('')}</div>` : ''}
        ${list.length
          ? `<div class="grid">${list.map((i) => {
              const there = isThere(i);
              const on = st.selected.has(i.id);
              return `<button class="cell pick${on ? ' on' : ''}${there ? ' there' : ''}" data-item="${esc(i.id)}" ${there ? 'disabled' : ''} aria-pressed="${on}" aria-label="${esc(i.name)}${there ? ' (schon in der Tour)' : ''}">
                ${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy">` : `<span class="noimg">${esc(i.name)}</span>`}
                ${isVideoName(i.name) ? '<span class="play" aria-hidden="true">▶</span>' : ''}
                ${there ? '<span class="thereLabel">schon da</span>' : '<span class="tick" aria-hidden="true">✓</span>'}
              </button>`;
            }).join('')}</div>`
          : st.loading
            ? ''
            : `<div class="panel muted">${st.error
                ? esc(st.error)
                : st.filter === 'day'
                  ? `Keine Fotos vom Tourtag gefunden.${folders().length ? ' Vielleicht liegen sie in einem der Ordner oben.' : ''} <button class="linkbtn" data-filter="all">Alle zeigen</button>`
                  : 'Keine Fotos in diesem Ordner.'}</div>`}
        ${st.loading ? '<div class="panel muted">Lade …</div>' : st.next ? '<button class="btn outline wide" data-more>Ältere laden</button>' : ''}
      </div>
      <div class="picker-foot">
        <span class="muted">${st.selected.size} ausgewählt</span>
        ${choosable.length ? `<button class="btn outline small" data-all="${allOn ? 'off' : 'on'}">${allOn ? 'Keine' : 'Alle'}</button>` : ''}
        <button class="btn" data-copy ${st.selected.size ? '' : 'disabled'}>In die Tour kopieren</button>
      </div>`;
    const body = box.querySelector('.picker-body');
    if (body) body.scrollTop = scroll;

    box.querySelector('[data-close]').onclick = close;
    box.querySelectorAll('[data-filter]').forEach((b) => {
      b.onclick = () => {
        st.filter = b.dataset.filter;
        draw();
        autoLoad();
      };
    });
    box.querySelector('[data-up]')?.addEventListener('click', () => {
      st.stack.pop();
      openFolder();
    });
    box.querySelectorAll('[data-folder]').forEach((b) => {
      b.onclick = () => {
        const f = st.items.find((i) => i.id === b.dataset.folder);
        st.stack.push({ id: f.id, name: f.name });
        openFolder();
      };
    });
    box.querySelectorAll('.cell[data-item]').forEach((b) => {
      b.onclick = () => {
        const i = st.items.find((x) => x.id === b.dataset.item);
        if (st.selected.has(i.id)) st.selected.delete(i.id);
        else st.selected.set(i.id, i);
        draw();
      };
    });
    box.querySelector('[data-all]')?.addEventListener('click', (e) => {
      const on = e.currentTarget.dataset.all === 'on';
      for (const i of choosable) on ? st.selected.set(i.id, i) : st.selected.delete(i.id);
      draw();
    });
    box.querySelector('[data-more]')?.addEventListener('click', () => loadPage());
    box.querySelector('[data-copy]').onclick = () => {
      const sources = [...st.selected.values()].map((i) => ({ id: i.id, name: i.name, size: i.size, mimeType: i.mimeType, driveId: i.driveId }));
      close();
      onCopy(sources);
    };
  }

  async function loadPage() {
    if (st.loading) return;
    const folder = current();
    st.loading = true;
    st.error = null;
    draw();
    try {
      const page = await drive.listPage(folder.id, st.next);
      if (current() !== folder) return; // inzwischen anderer Ordner
      st.items.push(...page.items);
      st.next = page.next;
      st.pages++;
    } catch (e) {
      console.error(e);
      st.error = e.message || 'OneDrive-Ordner konnte nicht gelesen werden.';
    } finally {
      if (current() === folder) {
        st.loading = false;
        draw();
      }
    }
    autoLoad();
  }

  /** Nur vom Tourtag: weiterladen, solange die geladenen Fotos noch neuer als die Tour sind (neueste kommen zuerst). */
  function autoLoad() {
    if (st.filter !== 'day' || !st.next || st.loading || st.error || st.pages >= MAX_AUTO_PAGES) return;
    const days = media().map(photoDay).filter(Boolean);
    const oldest = days.length ? days.reduce((a, b) => (a < b ? a : b)) : null;
    if (!oldest || oldest >= dates.start) loadPage();
  }

  function openFolder() {
    st.items = [];
    st.next = null;
    st.pages = 0;
    st.loading = false;
    loadPage();
  }

  draw();
  cameraRollInfo(drive)
    .then((roll) => {
      if (!roll) {
        close();
        showToast('Kein Ordner der OneDrive-App gefunden.');
        return;
      }
      st.stack = [{ id: roll.id, name: roll.name }];
      openFolder();
    })
    .catch((e) => {
      st.error = e.message || String(e);
      draw();
    });
}
