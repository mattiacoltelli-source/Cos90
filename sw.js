const CACHE_NAME = "cinetracker-v1";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ui.js",
  "./cine-core.js",
  "./storage.js",
  "./tmdb.js",
  "./supabase.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// INSTALL
self.addEventListener("install", (event) => {
  self.skipWaiting(); // attiva subito
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // prende controllo subito
});

// FETCH → network first
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});