// Service worker: aplikasi tetap bisa dibuka tanpa sinyal.
// Strategi "jaringan dulu": kalau ada sinyal, selalu ambil versi terbaru dari GitHub,
// jadi perbaikan langsung sampai ke semua HP. Kalau tidak ada sinyal, pakai salinan terakhir.
// Nama cache berawalan "kepuh-" dan hanya cache berawalan itu yang dibersihkan,
// supaya tidak mengganggu aplikasi Catatan Sembada lain di alamat yang sama.
const CACHE = 'kepuh-v7';
const ASET = ['./', './index.html', './app.js', './style.css', './config.js', './manifest.webmanifest',
  './ikon-192.png', './ikon-512.png', './logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASET)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.indexOf('kepuh-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // panggilan API ke Google tidak disimpan
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(req, {signal: ctrl.signal, cache: 'no-cache'});
      clearTimeout(t);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const simpanan = await cache.match(req, {ignoreSearch: true});
      if (simpanan) return simpanan;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
