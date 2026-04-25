/**
 * DBP Command Center — Service Worker
 * Strategy: Cache-first for static assets, Network-first for Firebase.
 */

const CACHE_NAME = 'dbp-cache-v1';

// Files to pre-cache on install (all must exist at the same level as index.html)
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Google Fonts — cached on first use (see fetch handler)
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700;800&display=swap'
];

// Domains that should NEVER be intercepted (Firebase, CDNs)
const NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'www.gstatic.com',        // Firebase SDK scripts
  'firebaselogging',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (likely font URL):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 2. Network-only for Firebase and CDN SDK calls
  if (NETWORK_ONLY_ORIGINS.some((origin) => url.hostname.includes(origin))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Cache-first for everything else (app shell + fonts)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache, but refresh in background (stale-while-revalidate)
        const networkFetch = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, networkResponse.clone())
            );
          }
          return networkResponse;
        }).catch(() => {});
        return cachedResponse;
      }

      // Not in cache — fetch from network and store
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }
        caches.open(CACHE_NAME).then((cache) =>
          cache.put(event.request, networkResponse.clone())
        );
        return networkResponse;
      }).catch(() => {
        // Offline fallback — return the cached index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
