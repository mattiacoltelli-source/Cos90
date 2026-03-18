const CACHE_NAME = "cinetracker-v1";
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
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(networkRes => {
        if (
          networkRes &&
          networkRes.status === 200 &&
          req.url.startsWith(self.location.origin)
        ) {
          const responseClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, responseClone);
          });
        }
        return networkRes;
      }).catch(() => {
        if (req.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});