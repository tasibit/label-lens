/* HalalCheck — service worker
 * Cache-first, versioned precache of the app shell + vendor + lang data + icons.
 * Registration itself is gated in app.js to https:/localhost/127.0.0.1 — this file assumes it's safe
 * to run once registered.
 */
'use strict';

var VERSION = 'v53'; // bump on any precache list change
var CACHE = 'hc-' + VERSION;
var ASSET_CACHE = 'hc-assets'; // OCR core + language files, written by the page after a complete download (ocr.js)
var HEAVY = /\/vendor\/(tesseract\/tesseract-core-|lang\/|ppocr\/)/;   // big OCR assets never stream through the SW (Chrome kills idle SWs mid-download)

var PRECACHE_URLS = [
  './ppocr.js',
  './',
  './index.html',
  './styles.css',
  './db.js',
  './db_ok.js',
  './db_codes.js',
  './db_products.js',
  './analyzer.js',
  './ocr.js',
  './app.js',
  './manifest.webmanifest',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  // The OCR core (4 MB) and language files (1.7 MB each) are NOT precached: on a slow mobile link the
  // install download competed with the first OCR run and doubled the traffic (04/10, phone test in China).
  // They are cached by the fetch handler the first time "Read text" downloads them, and are offline after that.
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            // Don't let one missing optional asset (e.g. eng data not precached) fail install.
            console.warn('[hc-sw] precache skip', url, err && err.message);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE && k !== ASSET_CACHE; })
          .filter(function (k) { return /^hc-/.test(k); })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // same-origin only; never intercept cross-origin

  if (HEAVY.test(url.pathname)) {
    // Big files: serve from the asset cache if present, otherwise let the browser fetch them DIRECTLY.
    // Streaming a 4 MB body through the worker got the download killed when Chrome stopped the idle
    // service worker ~30 s later (phone test 04/10: six aborted downloads). The page caches them itself.
    event.respondWith(caches.match(req).then(function (cached) { return cached || fetch(req); }));
    return;
  }

  // App shell: NETWORK FIRST (4 s budget) so the phone always runs the newest files when online, cache fallback
  // when offline or slow. Cache-first made every update need two loads (phone test 04/10: an old app.js kept
  // running after a reload while the new worker was still installing).
  event.respondWith(new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      caches.match(req).then(function (cached) { if (cached && !settled) { settled = true; resolve(cached); } });
    }, 4000);
    fetch(req).then(function (resp) {
      clearTimeout(timer);
      if (resp && resp.ok) {
        var copy = resp.clone();
        var u = new URL(req.url); var cacheable = req.method === 'GET' && u.origin === self.location.origin && (!u.search || /^\?v=[\w.-]+$/.test(u.search));
        if (cacheable) event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(req, copy); }));
      }
      if (!settled) { settled = true; resolve(resp); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(req).then(function (cached) {
        if (settled) return;
        settled = true;
        if (cached) return resolve(cached);
        if (req.mode === 'navigate') return caches.match('./index.html').then(function (ix) { resolve(ix || new Response('offline', { status: 503 })); });
        resolve(new Response('', { status: 503, statusText: 'offline' }));
      });
    });
  }));
});
