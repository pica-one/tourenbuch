// Die Web-App: Start, Abgleich und Bildschirme (Liste, Tour, Einstellungen).

import * as auth from './auth.js';
import { renderEdit } from './edit.js';
import { FormatError, TOUR_TYPES } from './format.js';
import { icon, typeBadge, typeLabel, TYPE_NAMES } from './icons.js';
import { AuthError, BusyError, createOneDrive } from './onedrive.js';
import * as store from './store.js';
import { createSync } from './sync.js';
import { renderStats } from './stats.js';
import { renderTour as renderTourScreen, updateUploadStatus } from './tour.js';
import { allPartnerNames, createTourBook, deleteTour, favorites, isVideoName, setFavorite, visibleTours } from './tourbook.js';
import { dateRange, dateTime, esc, mediaCount, showToast, stars, topbar } from './ui.js';
import { createUploader } from './upload.js';

const APP_VERSION = 'Web 0.1';
const SYNC_THROTTLE_MS = 2 * 60 * 1000;
const DEMO_KEY = 'tourenbuch-demo'; // nur zum Testen ohne Anmeldung

const root = document.getElementById('app');
const book = createTourBook(store);
const drive = createOneDrive(auth.getToken);
const sync = createSync({ store: book, drive });
const uploader = createUploader({
  book,
  drive,
  onChange: () => renderUploadOnly(),
  onFinished: (count) => {
    if (count) {
      showToast(count === 1 ? '1 Datei hochgeladen' : `${count} Dateien hochgeladen`);
      syncNow();
    }
  },
});

// Während hochgeladen wird: vor dem Schliessen der Seite warnen
window.addEventListener('beforeunload', (e) => {
  if (uploader.isRunning()) e.preventDefault();
});

/** Fortschritt anzeigen: nicht bei jedem Prozent alles neu zeichnen, höchstens 4x pro Sekunde. */
let uploadDrawPending = false;
function renderUploadOnly() {
  if (uploadDrawPending) return;
  uploadDrawPending = true;
  setTimeout(() => {
    uploadDrawPending = false;
    if (location.hash.startsWith('#/tour/')) updateUploadStatus(root, decodeURIComponent(location.hash.split('/')[2]), uploader);
    else renderUploadBanner();
  }, 250);
}

/** Kleiner Hinweis in der Liste, solange hochgeladen wird. */
function renderUploadBanner() {
  const box = document.getElementById('uploadbanner');
  if (!box) return;
  const s = uploader.status();
  box.innerHTML = s.running ? `<div class="status">Lade hoch: ${esc(s.current?.name ?? '')}${s.waiting ? ` · noch ${s.waiting} weitere` : ''}</div>` : '';
}

const state = {
  user: null,
  demo: false,
  syncing: false,
  syncProblem: null, // { text, action? }
  lastSync: 0,
  search: '',
  typeFilter: null,
};

// ---------- Start ----------

async function start() {
  // Die stille Anmeldung lädt die Seite kurz unsichtbar in einem Rahmen: dort nichts starten
  if (window.self !== window.top) return;
  applyTheme(localStorage.getItem('tourenbuch-theme') || 'system');
  state.demo = localStorage.getItem(DEMO_KEY) === '1';
  try {
    state.user = state.demo ? { name: 'Demo', username: 'nur zum Testen' } : await auth.initAuth();
  } catch (e) {
    console.error(e);
    showToast('Anmeldung fehlgeschlagen: ' + (e.message || e));
  }
  let meta = await store.loadMeta();
  // Anderes Konto als zuletzt? Dann gehören die gespeicherten Touren nicht dieser Person: zuerst leeren
  if (state.user && !state.demo) {
    const owner = state.user.username.toLowerCase();
    if (meta.owner && meta.owner !== owner) {
      await store.clearAll();
      meta = {};
    }
    if (meta.owner !== owner) await store.saveMeta({ owner });
  }
  state.lastSync = meta.lastSync ?? 0;
  await book.load();
  book.subscribe(() => render());
  window.addEventListener('hashchange', () => render(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastSync > SYNC_THROTTLE_MS) syncNow();
  });
  window.addEventListener('online', () => syncNow());
  render(true);
  if (state.user) syncNow();
}

// ---------- Abgleich ----------

async function syncNow() {
  if (!state.user || state.demo) return;
  if (!navigator.onLine) {
    state.syncProblem = { text: 'Kein Internet – Änderungen werden später abgeglichen.' };
    render();
    return;
  }
  state.syncing = true;
  render();
  try {
    await sync.run();
    state.lastSync = Date.now();
    state.syncProblem = null;
    await store.saveMeta({ lastSync: state.lastSync });
  } catch (e) {
    console.error(e);
    if (e instanceof AuthError) state.syncProblem = { text: 'Anmeldung abgelaufen.', action: 'relogin' };
    else if (e instanceof FormatError) state.syncProblem = { text: e.message };
    else if (e instanceof BusyError) state.syncProblem = { text: e.message + ' Später nochmals.' };
    else state.syncProblem = { text: 'Abgleich fehlgeschlagen: ' + (e.message || e) };
  } finally {
    state.syncing = false;
    render();
  }
}

// ---------- Darstellung ----------

let lastRoute = null;

function render(routeChanged = false) {
  const route = location.hash.replace(/^#\/?/, '');
  if (routeChanged || route !== lastRoute) window.scrollTo(0, 0);
  lastRoute = route;
  // Eingabefeld mit Fokus (z. B. Suche) nach dem Neuzeichnen wieder aktivieren
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  renderScreen(route);
  const again = focused && document.getElementById(focused);
  if (again) {
    again.focus();
    if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret);
  }
}

function renderScreen(route) {
  if (!state.user) return renderWelcome();
  const [screen, id] = route.split('/');
  if (screen !== 'new' && screen !== 'edit') editOpenFor = null;
  if (screen === 'tour' && id) return renderTour(decodeURIComponent(id));
  if (screen === 'new' || (screen === 'edit' && id)) {
    // Formular nicht neu zeichnen, solange es offen ist (sonst gingen Eingaben verloren)
    if (editOpenFor === route) return;
    editOpenFor = route;
    return renderEdit(root, {
      book,
      id: id ? decodeURIComponent(id) : null,
      done: (tourId) => {
        editOpenFor = null;
        location.replace(`#/tour/${encodeURIComponent(tourId)}`);
        syncNow();
      },
      cancel: () => {
        editOpenFor = null;
        goBack();
      },
    });
  }
  if (screen === 'settings') return renderSettings();
  if (screen === 'stats') {
    renderStats(root, book, statsState);
    return bindActions();
  }
  return renderList();
}

const statsState = { year: null };

let editOpenFor = null;

function goBack() {
  if (history.length > 1) history.back();
  else location.hash = '#/';
}

function renderWelcome() {
  root.innerHTML = `
    <div class="welcome">
      ${typeBadge('BERGSTEIGEN', 72, '')}
      <h1>Tourenbuch</h1>
      <p>Dein Tourenbuch liegt in deinem eigenen OneDrive. Melde dich mit deinem Microsoft-Konto an,
         um deine Touren zu sehen und zu erfassen.</p>
      <button class="btn" id="signin">Mit Microsoft anmelden</button>
    </div>`;
  root.querySelector('#signin').onclick = () => auth.signIn();
}

function syncButton() {
  if (state.demo) return '';
  return `<button class="iconbtn${state.syncing ? ' spin' : ''}" data-action="sync" aria-label="Jetzt abgleichen" ${state.syncing ? 'disabled' : ''}>${icon('sync')}</button>`;
}

function statusLine() {
  const p = state.syncProblem;
  if (!p) return '';
  const btn = p.action === 'relogin' ? '<button class="btn outline" data-action="relogin">Neu anmelden</button>' : '';
  return `<div class="status error">${esc(p.text)}${btn}</div>`;
}

// --- Liste ---

function renderList() {
  const tours = visibleTours(book.current());
  const usedTypes = TOUR_TYPES.filter((t) => tours.some((x) => x.tourType.value === t));
  root.innerHTML = `
    ${topbar('Meine Touren', {
      actions: `<span>${syncButton()}<a class="iconbtn" href="#/stats" aria-label="Statistik">${icon('chart')}</a><button class="iconbtn" data-action="settings" aria-label="Einstellungen">${icon('settings')}</button></span>`,
    })}
    ${statusLine()}
    <div id="uploadbanner"></div>
    <label class="search">${icon('search', 20)}<input id="search" type="search" placeholder="Berg, Route, Partner …" value="${esc(state.search)}" aria-label="Suchen"></label>
    <div class="chips">
      ${usedTypes.map((t) => `<button class="chip${state.typeFilter === t ? ' on' : ''}" data-type="${t}">${esc(TYPE_NAMES[t])}</button>`).join('')}
    </div>
    <div id="results"></div>
    <a class="fab" href="#/new">${icon('add')}<span>Neue Tour</span></a>`;
  const input = root.querySelector('#search');
  input.oninput = () => {
    state.search = input.value;
    renderResults(tours);
  };
  root.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      state.typeFilter = state.typeFilter === c.dataset.type ? null : c.dataset.type;
      renderList();
    };
  });
  bindActions();
  renderResults(tours);
  renderUploadBanner();
}

function renderResults(tours) {
  const q = state.search.trim().toLowerCase();
  const shown = tours.filter((t) => (!state.typeFilter || t.tourType.value === state.typeFilter) && (!q || searchText(t).includes(q)));
  const box = root.querySelector('#results');
  if (!tours.length) {
    box.innerHTML = `<div class="empty">${state.syncing ? 'Touren werden von OneDrive geladen …' : 'Noch keine Touren.'}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="count">${shown.length === tours.length ? `${tours.length} Touren` : `${shown.length} von ${tours.length} Touren`}</div>
    <div class="cards">${shown.map(card).join('')}</div>
    ${shown.length ? '' : '<div class="empty">Keine Tour passt zur Suche.</div>'}`;
}

function searchText(t) {
  return [t.mountain.value, t.routeName?.value, typeLabel(t.tourType.value, t.customType?.value), ...(t.partners?.value ?? []), t.details?.value, t.dates.value.start.slice(0, 4)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function card(t) {
  const label = typeLabel(t.tourType.value, t.customType?.value);
  const atts = t.attachments.filter((a) => a.deleted == null);
  const media = t.photos.filter((p) => p.deleted == null);
  const videos = media.filter((p) => isVideoName(p.fileName)).length;
  const partners = t.partners?.value ?? [];
  return `<a class="card" href="#/tour/${encodeURIComponent(t.id)}">
    ${typeBadge(t.tourType.value, 40, esc(label))}
    <div class="body">
      <div class="date"><span>${dateRange(t.dates.value)}</span>
        ${atts.some((a) => a.kind === 'TOPO') ? '<span class="mark">Topo</span>' : ''}
        ${atts.some((a) => a.kind === 'GPX') ? '<span class="mark">GPX</span>' : ''}</div>
      <div class="mountain">${esc(t.mountain.value)}</div>
      ${t.routeName?.value ? `<div class="route">${esc(t.routeName.value)}</div>` : ''}
      ${partners.length ? `<div class="partners">mit ${esc(partners.join(', '))}</div>` : ''}
      <div class="foot"><span class="type">${esc(label)}</span><span class="stars">${stars(t.rating?.value ?? 0)}</span><span>${mediaCount(media.length - videos, videos)}</span></div>
    </div>
  </a>`;
}

// --- Tour-Ansicht ---

function renderTour(id) {
  renderTourScreen(root, id, { book, drive, uploader, demo: state.demo, afterChange: syncNow });
  bindActions();
}

// --- Einstellungen ---

function renderSettings() {
  const doc = book.current();
  const rootFolder = doc.settings.oneDriveRoot?.value ?? 'Pictures/Klettern_Bergsteigen';
  const groups = doc.settings.groupFolders?.value ?? true;
  const theme = localStorage.getItem('tourenbuch-theme') || 'system';
  root.innerHTML = `
    ${topbar('Einstellungen', { back: true })}
    <div class="section"><h2>Konto</h2><div class="panel">
      <div class="setting"><div class="label">${esc(state.user.name)}<small>${esc(state.user.username)}</small></div>
        <button class="btn outline" data-action="signout">Abmelden</button></div>
    </div></div>
    ${state.demo ? '' : `<div class="section"><h2>Abgleich</h2><div class="panel">
      <div class="setting"><div class="label">Zuletzt abgeglichen<small>${state.lastSync ? dateTime(state.lastSync) : 'noch nie'}</small></div>
        <button class="btn" data-action="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Läuft …' : 'Jetzt abgleichen'}</button></div>
      ${state.syncProblem ? `<div class="setting"><div class="label" style="color:var(--error)">${esc(state.syncProblem.text)}</div></div>` : ''}
      <div class="setting"><div class="label"><small>Die Touren werden mit der Datei <b>Apps/Tourenbuch/tourenbuch-daten.json</b>
        in deinem OneDrive abgeglichen – gleich wie in der Android-App.</small></div></div>
    </div></div>`}
    <div class="section"><h2>Tourenpartner</h2><div class="panel">
      <div class="setting"><div class="label"><small>Favoriten (★) erscheinen beim Erfassen einer Tour zum schnellen Antippen – höchstens 5.</small></div></div>
      ${partnerRows(doc)}
    </div></div>
    <div class="section"><h2>Fotos auf OneDrive</h2><div class="panel">
      <div class="setting"><div class="label">Ablageordner<small>${esc(rootFolder)}</small></div></div>
      <div class="setting"><div class="label">Sammelordner verwenden<small>${groups ? 'Ja' : 'Nein'} (Klettergarten, Klettersteige, Bike)</small></div></div>
    </div></div>
    <div class="section"><h2>Darstellung</h2><div class="panel">
      <div class="setting"><div class="label">Farbschema</div>
        <select id="theme">
          <option value="system"${theme === 'system' ? ' selected' : ''}>Wie Gerät</option>
          <option value="light"${theme === 'light' ? ' selected' : ''}>Hell</option>
          <option value="dark"${theme === 'dark' ? ' selected' : ''}>Dunkel</option>
        </select></div>
    </div></div>
    <p class="muted" style="text-align:center">Tourenbuch ${APP_VERSION}</p>`;
  bindActions();
  root.querySelectorAll('[data-partner]').forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.partner;
      const on = b.getAttribute('aria-pressed') !== 'true';
      if (on && favorites(book.current()).length >= 5) return showToast('Höchstens 5 Favoriten – zuerst einen anderen entfernen.');
      await book.update((d) => setFavorite(d, name, on, Date.now()));
      syncNow();
    };
  });
  root.querySelector('#theme').onchange = (e) => {
    localStorage.setItem('tourenbuch-theme', e.target.value);
    applyTheme(e.target.value);
  };
}

function partnerRows(doc) {
  const names = allPartnerNames(doc);
  if (!names.length) return '<div class="setting"><div class="label muted">Noch keine Partner</div></div>';
  const favs = favorites(doc).map((n) => n.toLowerCase());
  return `<div class="partnergrid">${names
    .map((n) => {
      const on = favs.includes(n.toLowerCase());
      return `<button class="favtoggle${on ? ' on' : ''}" data-partner="${esc(n)}" aria-pressed="${on}"><span class="star">${on ? '★' : '☆'}</span>${esc(n)}</button>`;
    })
    .join('')}</div>`;
}

// ---------- Aktionen ----------

function bindActions() {
  root.querySelectorAll('[data-action]').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      const a = el.dataset.action;
      if (a === 'back') goBack();
      else if (a === 'delete') removeTour(el.dataset.id);
      else if (a === 'settings') location.hash = '#/settings';
      else if (a === 'sync') syncNow();
      else if (a === 'relogin') auth.signInAgain();
      else if (a === 'signout') signOut();
    };
  });
}

async function removeTour(id) {
  const t = book.current().tours.find((x) => x.id === id);
  if (!t || !confirm(`Tour „${t.mountain?.value ?? ''}“ löschen? Die Fotos auf OneDrive bleiben erhalten.`)) return;
  await book.update((d) => deleteTour(d, id, Date.now()));
  location.replace('#/');
  showToast('Tour gelöscht');
  syncNow();
}

async function signOut() {
  if (!confirm('Abmelden? Die Touren bleiben auf OneDrive; in diesem Browser werden sie gelöscht.')) return;
  await store.clearAll();
  if (state.demo) {
    localStorage.removeItem(DEMO_KEY);
    location.reload();
  } else auth.signOut();
}

// Offline-Speicher anmelden (damit die App auch ohne Internet startet)
if ('serviceWorker' in navigator && window.self === window.top) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline-Speicher nicht verfügbar', e));
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

start();
