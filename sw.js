// ─── CINETRACKER SERVICE WORKER ──────────────────────────────────────────────
// Versione cache: incrementa CACHE_NAME quando aggiorni i file statici,
// così la vecchia cache viene eliminata automaticamente.
const CACHE_NAME = "cinetracker-v1";

// File statici da mettere in cache al primo avvio
const STATIC_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ui.js",
  "./tmdb.js",
  "./storage.js",
  "./supabase.js",
  "./cine-core.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
// Al primo avvio: mette in cache tutti i file statici

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_FILES);
    })
  );
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
// Elimina le cache vecchie quando viene installata una nuova versione

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
// Strategia: Cache First per i file statici, Network First per le API
//
// - File statici (JS, CSS, HTML, immagini): serviti dalla cache, veloci
// - Chiamate TMDB e Supabase: sempre dalla rete (dati freschi),
//   con fallback alla cache se offline

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Chiamate API esterne → sempre dalla rete
  const isApi =
    url.hostname.includes("themoviedb.org") ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("esm.sh");

  if (isApi) {
    // Network First: prova la rete, se fallisce usa cache
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // File statici → Cache First: serve dalla cache, aggiorna in background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });

      // Restituisce subito la cache se disponibile, altrimenti aspetta la rete
      return cached || networkFetch;
    })
  );
});
