const CACHE_NAME = 'dabrawl-shell-v4';
const APP_ROOT = new URL('./', self.registration.scope);
const APP_URL = new URL('./index.html', self.registration.scope).href;
const CORE_URLS = [APP_URL, new URL('./manifest.json', self.registration.scope).href, new URL('./icon.svg', self.registration.scope).href];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_URLS.map(async url => {
      try { const response = await fetch(url, { cache: 'reload' }); if (response.ok) await cache.put(url, response); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('dabrawl-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always try the network first for page navigations. This makes installed
  // home-screen copies see new GitHub Pages releases instead of pinning old HTML.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_URL, response.clone());
        }
        return response;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(APP_URL)) || new Response('DaBrawl is offline. Reconnect and open the app again.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('/icon.svg')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) || Response.error();
      }
    })());
  }
});
