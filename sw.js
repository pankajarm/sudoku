// Bump this version whenever a runtime asset changes in a release.
const CACHE_VERSION = 'v3';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `sudoku:${encodeURIComponent(SCOPE.href)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const ASSETS = [
  './', './index.html', './styles.css', './src/app.js', './src/engine.js',
  './src/game.js', './src/puzzles.js', './src/storage.js', './src/clock.js',
  './favicon.svg', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
].map((path) => new URL(path, SCOPE).href);
const ASSET_URLS = new Set(ASSETS);
const PAGE_URL = new URL('./index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  // Keep the current worker if a complete new release cannot be cached.
  // No skipWaiting: an update must never replace an open game.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload', redirect: 'error' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)));
    } catch {
      // Storage restrictions must not prevent the online game from working.
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  url.hash = '';
  url.search = '';
  if (!ASSET_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cacheKey = request.mode === 'navigate' && (url.href === SCOPE.href || url.href === PAGE_URL)
      ? PAGE_URL : url.href;
    let cache;
    try {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // Browsers can deny or evict storage. Fall back to the network.
    }
    try {
      const response = await fetch(request);
      // Restore evicted entries so a successful online visit repairs offline play.
      // Never save redirects, partial/error responses, or another origin's data.
      if (cache && response.status === 200 && !response.redirected &&
          response.type !== 'opaque' && new URL(response.url || request.url).origin === SCOPE.origin) {
        try { await cache.put(cacheKey, response.clone()); } catch { /* Storage can fill up while playing. */ }
      }
      return response;
    } catch {
      return new Response(request.mode === 'navigate'
        ? '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sudoku is offline</title><h1>Reconnect to load Sudoku</h1><p>This browser has not saved a complete offline copy yet. Connect to the internet and reload.</p></html>'
        : 'This Sudoku asset is unavailable offline.', {
        status: 503,
        headers: { 'Content-Type': request.mode === 'navigate' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' },
      });
    }
  })());
});
