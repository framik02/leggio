// Tiene l'app disponibile anche senza rete. Cambiare VERSIONE a ogni rilascio.
const VERSIONE = 'leggio-0.1.0';
const FILE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/voce.js', 'js/libri.js', 'js/lettore.js',
  'js/import/comune.js', 'js/import/epub.js', 'js/import/pdf.js', 'js/import/testo.js',
  'vendor/jszip.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'fonts/literata-latin-wght-normal.woff2', 'fonts/literata-latin-wght-italic.woff2',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-400-italic.woff2',
  'fonts/atkinson-hyperlegible-latin-700-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-italic.woff2',
  'icons/icona-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSIONE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

// Prima la rete per i file dell'app, così gli aggiornamenti arrivano; la cache se offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
