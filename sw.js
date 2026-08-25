// ─── sw.js ───────────────────────────────────────────────────────────────────
// Service worker "leggero": la sua unica funzione è permettere all'app di
// accorgersi quando esiste una versione più nuova online, così può proporre
// il pulsante "Aggiorna" invece di richiedere disinstallazione/pulizia cache.
//
// IMPORTANTE: non fa NESSUNA cache offline. Ogni richiesta va sempre alla
// rete come se il service worker non esistesse — zero rischio di vedere
// contenuti vecchi "intrappolati" in una cache.
//
// Ad ogni release, cambia questo numero: è quello che fa capire al browser
// che il file è cambiato e quindi c'è una versione nuova da proporre.
const SW_VERSION = "5";

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
    // Ripulisce le cache lasciate dalla vecchia strategia stale-while-revalidate
    // (versioni precedenti di questo SW cachavano i file sotto "cinetracker-*").
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k.startsWith("cinetracker-")).map(k => caches.delete(k))))
      .then(() => { if (claimOnActivate) return self.clients.claim(); })
  );
});

// Quando l'app manda il messaggio "SKIP_WAITING" (dopo che l'utente ha
// premuto il pulsante Aggiorna), passiamo subito alla versione nuova.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    claimOnActivate = true;
    self.skipWaiting();
  }
});

// Nessun listener "fetch": tutte le richieste passano dritte alla rete.
