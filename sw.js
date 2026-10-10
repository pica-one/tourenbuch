// Offline-Speicher der Web-App ("Service Worker"): Die Seite selbst (HTML, CSS, JavaScript, Symbole)
// wird im Browser gespeichert, damit die App auch ohne Internet startet. Die Touren liegen ohnehin im Browser.
// Strategie: zuerst übers Netz (immer die neuste Version), ohne Internet aus dem Speicher.
// Anfragen an Microsoft/OneDrive gehen nie über diesen Speicher.

const CACHE = 'tourenbuch-v3';
const MSAL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/auth.js',
  'js/edit.js',
  'js/format.js',
  'js/icons.js',
  'js/merge.js',
  'js/naming.js',
  'js/onedrive.js',
  'js/store.js',
  'js/stats.js',
  'js/sync.js',
  'js/tour.js',
  'js/tourbook.js',
  'js/ui.js',
  'js/upload.js',
  'js/viewer.js',
  'icons/icon-192.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL);
      await cache.add(new Request(MSAL, { mode: 'cors' })).catch(() => {});
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && req.url !== MSAL) return; // Microsoft, OneDrive, Vorschaubilder: direkt

  if (req.url === MSAL) {
    // Feste Version: aus dem Speicher, sonst holen
    event.respondWith(caches.match(MSAL).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // Ohne Suchteil speichern (z. B. ?code=… nach der Anmeldung)
          const key = url.pathname.endsWith('/') ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(async () => {
        // Kein Internet: gespeicherte Version (Startseite für jede Seitenadresse)
        const hit = await caches.match(url.origin + url.pathname);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const start = await caches.match(new URL('./', self.registration.scope).href);
          if (start) return start;
        }
        return Response.error();
      }),
  );
});
