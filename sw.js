// ─── sw.js ───────────────────────────────────────────────────────────────────
// Service worker "leggero": la sua unica funzione è permettere all'app di
// accorgersi quando esiste una versione più nuova online, così può proporre
// il pulsante "Aggiorna" invece di richiedere disinstallazione/pulizia cache.
//
// Tiene anche una cache dei SOLI file dell'app (stesso dominio), così l'app
// si apre anche offline e senza aspettare la rete a ogni avvio:
//  - pagina (index.html): prima la rete, la cache solo se la rete non risponde
//    entro 4 secondi o manca. Una versione nuova arriva quindi sempre.
//  - file con "?v=<hash>" (JS, CSS): il nome cambia a ogni release (lo fa il
//    workflow bump-asset-version), quindi una copia in cache non può essere
//    "vecchia": si usa sempre quella, senza rete.
//  - tutto il resto dello stesso dominio (icone, manifest): prima la rete.
// Mai in cache: Supabase, TMDb, font, Sentry (altri domini) — i dati restano
// sempre freschi e le locandine usano la cache normale del browser.
// La cache porta il numero di versione qui sotto: a ogni release la vecchia
// viene cancellata, quindi non può restare nulla di una versione precedente.
//
// Ad ogni release, cambia questo numero: è quello che fa capire al browser
// che il file è cambiato e quindi c'è una versione nuova da proporre.
const SW_VERSION = "9576e74";
const SHELL = `cinetracker-shell-${SW_VERSION}`;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", () => {
  // Non ci attiviamo subito: aspettiamo che l'utente prema "Aggiorna" in app.
});

// Prendiamo il controllo dei tab già aperti (clients.claim) SOLO quando
// questa attivazione arriva da un aggiornamento scelto dall'utente
// (messaggio SKIP_WAITING, vedi sotto). Alla primissima installazione non
// c'è nulla da aggiornare: reclamare comunque il tab appena caricato fa
// scattare "controllerchange" in app.js, che ricarica la pagina da sola
// pochi secondi dopo l'apertura, senza preavviso.
let claimOnActivate = false;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Cancella ogni cache di versioni precedenti (anche quelle della vecchia
    // strategia stale-while-revalidate): resta solo quella di questa release.
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k.startsWith("cinetracker-") && k !== SHELL).map(k => caches.delete(k))
      ))
      .then(() => { if (claimOnActivate) return self.clients.claim(); })
  );
});

self.addEventListener("message", (event) => {
  // Dopo che l'utente ha premuto "Aggiorna": passiamo subito alla versione nuova.
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    claimOnActivate = true;
    self.skipWaiting();
    return;
  }

  // L'app, a pagina caricata, ci manda l'elenco dei suoi file: li mettiamo in
  // cache subito, così l'app funziona offline già dalla seconda apertura
  // (senza questo, la cache si riempirebbe solo alla terza).
  if (event.data?.type === "CACHE_URLS" && Array.isArray(event.data.urls)) {
    const sameOrigin = event.data.urls.filter(u => {
      try { return new URL(u, self.location.href).origin === self.location.origin; } catch { return false; }
    });
    event.waitUntil(
      caches.open(SHELL).then(cache =>
        Promise.all(sameOrigin.map(u => cache.add(u).catch(() => {})))
      )
    );
  }
});

function cacheable(res) {
  return res && res.ok && res.type === "basic";
}

// File versionati: la copia in cache è sempre quella giusta.
async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) cache.put(request, res.clone());
  return res;
}

// Pagina e file senza versione: la rete ha la precedenza, la cache copre
// offline e rete lenta. Se la rete risponde dopo il timeout, la risposta
// finisce comunque in cache per la prossima volta.
async function networkFirst(event, isNavigation) {
  const request = event.request;
  const cache = await caches.open(SHELL);
  const net = fetch(request).then(res => {
    if (cacheable(res)) cache.put(request, res.clone());
    return res;
  });
  event.waitUntil(net.catch(() => {}));

  try {
    return await Promise.race([
      net,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS)),
    ]);
  } catch {
    const hit = await cache.match(request, { ignoreSearch: isNavigation })
      || (isNavigation && await cache.match("./index.html", { ignoreSearch: true }));
    return hit || net; // niente in cache: si aspetta la rete (o fallisce come prima)
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return; // sempre rivalidato dal browser

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, true));
  } else if (url.searchParams.has("v")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(event, false));
  }
});
