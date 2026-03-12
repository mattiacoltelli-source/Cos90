// Service Worker minimale per evitare cache vecchie

self.addEventListener("install", (event) => {
  // Attiva subito il nuovo service worker
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Prende il controllo immediatamente
  event.waitUntil(self.clients.claim());
});

// NON intercettiamo le fetch, quindi nessuna cache
self.addEventListener("fetch", () => {});