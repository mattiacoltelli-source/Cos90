// ─── CINETRACKER SERVICE WORKER ──────────────────────────────────────────────
const CACHE_NAME = "cinetracker-2026-04-04-0944";

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────

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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  const isApi =
    url.hostname.includes("themoviedb.org") ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("esm.sh");

  if (isApi) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
