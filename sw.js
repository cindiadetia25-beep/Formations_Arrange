// ============================================================================
// BAGIAN 1: KONFIGURASI NAMA CACHE & DAFTAR FILE OFFLINE
// ============================================================================
const CACHE_NAME = 'paskibra-v16';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// ============================================================================
// BAGIAN 2: INSTALL SERVICE WORKER & SIMPAN ASET AWAL
// ============================================================================
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// ============================================================================
// BAGIAN 3: AKTIVASI & PEMBERSIHAN CACHE VERSI LAMA
// ============================================================================
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ============================================================================
// BAGIAN 4: INTERCEPT REQUEST (NETWORK-FIRST UNTUK SINKRONISASI TERBARU)
// ============================================================================
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
