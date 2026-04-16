// ─── VERSIONE ────────────────────────────────────────────────────────────────
// Cambia questo numero ad ogni deploy per invalidare la cache precedente.
const CACHE_VERSION = "v6";
const CACHE_NAME = `cinetracker-${CACHE_VERSION}`;

// ─── FILE DA PRECACHARE ───────────────────────────────────────────────────────
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

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("cinetracker-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
// Strategia per tipo di richiesta:
//
// • File app (JS, CSS, HTML, immagini) → stale-while-revalidate
//   Risponde subito dalla cache (veloce), aggiorna in background.
//   Al prossimo caricamento l'utente ha già la versione fresca.
//
// • API TMDB / Supabase / CDN esterni → network-first
//   Dati sempre freschi. Se offline, fallback alla cache se disponibile.
//   I dati live non vanno mai serviti stantii senza tentare la rete.

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isAppFile = url.origin === self.location.origin;

  if (event.request.method !== "GET") return;

  if (isAppFile) {
    // Stale-while-revalidate per i file dell'app
    event.respondWith(staleWhileRevalidate(event.request));
  } else {
    // Network-first per API esterne (TMDB, Supabase)
    event.respondWith(networkFirst(event.request));
  }
});

// ─── STRATEGIE ───────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Aggiorna in background senza bloccare la risposta
  const networkPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Risponde subito dalla cache se disponibile, altrimenti aspetta la rete
  return cached || networkPromise;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("Offline", { status: 503 });
  }
}
