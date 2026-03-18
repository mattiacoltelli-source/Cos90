const CACHE_NAME = "cinetracker-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./cine-core.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Non intercettare chiamate API TMDb: sempre rete
  if (url.origin === "https://api.themoviedb.org") {
    event.respondWith(fetch(request));
    return;
  }

  // Non intercettare immagini TMDb: sempre rete
  if (url.origin === "https://image.tmdb.org") {
    event.respondWith(fetch(request));
    return;
  }

  // Per i file della tua app: network first, fallback cache
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);

        // Salva in cache solo richieste same-origin riuscite
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          url.origin === self.location.origin
        ) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }

        return networkResponse;
      } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        // fallback home per navigazioni offline
        if (request.mode === "navigate") {
          const homeFallback = await caches.match("./index.html");
          if (homeFallback) return homeFallback;
        }

        throw error;
      }
    })()
  );
});