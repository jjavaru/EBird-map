// Service worker: makes the app installable and usable with poor or no signal.
// - App files: network first (so deploys show up right away), cache as fallback.
// - MapLibre library: cache first (the URL is version-pinned).
// - Map style/tiles/fonts: cache first, refreshed in the background; capped in size.
// - /api is never cached here; the page keeps its own copy of the last results.
const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const TILE_CACHE = 'tiles'; // survives version bumps; tiles don't depend on app code
const MAX_TILES = 2000;

const APP_FILES = [
  '/',
  '/demo-data.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  'https://unpkg.com/maplibre-gl@4.1.2/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.1.2/dist/maplibre-gl.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // straight to network
    event.respondWith(networkFirst(req));
  } else if (url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(req, APP_CACHE));
  } else if (url.hostname.endsWith('cartocdn.com')) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Navigations (any URL, e.g. /?demo) fall back to the cached app page
    const cached = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' && await cache.match('/'));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).then(() => trimCache(cache));
    return res;
  });
  if (cached) {
    refresh.catch(() => {}); // offline: the cached copy is all we've got
    return cached;
  }
  return refresh;
}

let trimming = false;
async function trimCache(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys(); // insertion order: oldest first
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) {
      await cache.delete(key);
    }
  } finally {
    trimming = false;
  }
}
