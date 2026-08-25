import { supabase } from "./supabase.js";

const USER_ID = "default";

const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;
const DB_CACHE_KEY = "cineTrackerDBCache";

// ─── FIX 3: VERSIONING CACHE ─────────────────────────────────────────────────
// Se in futuro cambi la struttura dei dati, incrementa CACHE_VERSION di 1.
// La cache vecchia verrà ignorata automaticamente e ricaricata da Supabase.
const CACHE_VERSION = 1;

// ─── CACHE LOCALE ────────────────────────────────────────────────────────────

function saveLocalCache(db) {
  try {
    localStorage.setItem(DB_CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      data: db
    }));
    return true;
  } catch (e) {
    console.warn("Cache locale non salvata", e);
    return false;
  }
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(DB_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // FIX 3: se la versione non corrisponde, invalida la cache
    if (!parsed || parsed.version !== CACHE_VERSION) {
      localStorage.removeItem(DB_CACHE_KEY);
      return null;
    }

    const db = parsed.data;
    if (db && Array.isArray(db.seen) && Array.isArray(db.watchlist)) {
      return db;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── FIX 2: RETRY CON EXPONENTIAL BACKOFF ────────────────────────────────────
// Ritenta una funzione asincrona fino a maxAttempts volte.
// Delays automatici: 1s → 2s → 4s tra un tentativo e l'altro.
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`Tentativo ${attempt}/${maxAttempts} fallito, riprovo tra ${delay}ms…`, e);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}

// ─── FIX DATA-LOSS: baseline affidabile ──────────────────────────────────────
// _pushToSupabase cancella su Supabase le righe remote assenti in `db` (mirror
// sync). Questo è sicuro SOLO se `db` riflette davvero lo stato completo
// (caricato con successo da Supabase, o da una cache che a sua volta derivava
// da un caricamento riuscito). Se il primo caricamento fallisce e l'app
// procede con un db vuoto "di fallback", NON dobbiamo lasciare che un
// successivo salvataggio interpreti tutto il resto come "orfano" e lo cancelli.
let reliableBaseline = false;

export function hasReliableBaseline() {
  return reliableBaseline;
}

// ─── LOAD DB ─────────────────────────────────────────────────────────────────
// Ritorna subito la cache locale (istantaneo), poi
// sincronizza da Supabase in background aggiornando la cache.

export async function loadDB() {
  const cache = loadLocalCache();

  if (cache) {
    reliableBaseline = true; // la cache deriva da un sync riuscito in passato
    syncFromSupabase(); // solo in background, non aspettiamo
    return cache;
  }

  // Prima apertura assoluta (o cache invalidata per versioning): aspettiamo Supabase
  return await syncFromSupabase();
}

async function syncFromSupabase() {
  try {
    const res = await supabase
      .from("Coltel")
      .select("*")
      .eq("user_id", USER_ID);

    if (!res || res.error) {
      console.warn("Supabase error:", res?.error);
      return null;
    }

    const data = res.data || [];

    const seen = data
      .filter(r => r.list === "seen")
      .map(r => r.data);

    const watchlist = data
      .filter(r => r.list === "watchlist")
      .map(r => r.data);

    const db = { seen, watchlist };
    saveLocalCache(db);
    reliableBaseline = true;
    return db;

  } catch (e) {
    console.error("SYNC ERROR:", e);
    return null;
  }
}

// ─── SAVE DB ─────────────────────────────────────────────────────────────────
// Aggiorna subito la cache locale, poi salva su Supabase in background
// con retry automatico in caso di errore di rete (FIX 2).
//
// FIX RACE CONDITION: i push vengono incodati su `pushChain` così che ogni
// _pushToSupabase parta solo dopo che il precedente è completamente finito.
// Senza questo, due saveDB() ravvicinati (es. "segna visto" + "salva voto")
// potevano sovrapporre due cicli fetch→delete→upsert e produrre cancellazioni
// o upsert basati su uno stato remoto non più aggiornato.
let pushChain = Promise.resolve();

export async function saveDB(db) {
  // 1. Salva subito in locale (istantaneo). Il chiamante usa questo esito
  // per sapere se può davvero dire all'utente "salvato" (vedi app.js): con
  // localStorage pieno, salvare qui fallisce in silenzio e senza questo
  // valore di ritorno l'app mostrava comunque un toast di successo.
  const savedLocally = saveLocalCache(db);

  // 2. Push su Supabase in background con retry automatico, in coda.
  // NB: non si fa await di pushChain qui apposta — saveDB deve restare
  // "fire and forget" verso la rete (i chiamanti fanno `await saveDB(db)`
  // aspettandosi che si risolva subito, per aggiornare la UI all'istante
  // anche offline). L'incodamento serve solo a evitare che due push si
  // sovrappongano, non a farli attendere dal chiamante.
  pushChain = pushChain
    .then(() => withRetry(() => _pushToSupabase(db)))
    .catch(e => {
      console.warn("Errore sync Supabase dopo tutti i tentativi:", e);
    });

  return savedLocally;
}

// ─── FIX RACE CONDITION REALTIME ─────────────────────────────────────────────
// Il listener realtime (chiamato da app.js quando arriva un cambiamento da un
// altro dispositivo) deve leggere lo stato remoto SOLO dopo che ogni nostro
// salvataggio già in coda è stato scritto — altrimenti potrebbe leggere
// Supabase mentre un nostro upsert è ancora in volo, ottenere uno stato senza
// quella modifica, e quel refresh "vecchio" farebbe poi cancellare come
// "orfano" un titolo che in realtà è stato appena salvato con successo.
// Per questo instradiamo anche il refresh sulla stessa `pushChain`: eredita
// automaticamente l'ordinamento FIFO con i salvataggi già incodati.
export function queueRealtimeSync(applyFn) {
  pushChain = pushChain
    .then(() => syncFromSupabase())
    .then(newDB => { if (newDB) applyFn(newDB); })
    .catch(e => {
      console.warn("Errore sync realtime:", e);
    });
  return pushChain;
}

async function _pushToSupabase(db) {
  // FIX DATA-LOSS: la cancellazione "a specchio" presuppone che `db`
  // rappresenti davvero l'intera libreria. Se non abbiamo mai ottenuto una
  // baseline affidabile da Supabase (es. il caricamento iniziale è fallito
  // e l'app è partita con una libreria vuota "di fallback"), saltiamo la
  // fase di DELETE: meglio lasciare righe remote "in più" temporaneamente
  // che cancellare per errore l'intera libreria dell'utente.
  if (!reliableBaseline) {
    console.warn("Baseline non affidabile: salto la cancellazione delle righe orfane su Supabase.");
  } else {
    const { data: remoteRows, error: fetchError } = await supabase
      .from("Coltel")
      .select("tmdb_id, list")
      .eq("user_id", USER_ID);

    if (!fetchError && remoteRows) {
      const localKeys = new Set([
        ...(db.seen      || []).map(item => `${item.id}|seen`),
        ...(db.watchlist || []).map(item => `${item.id}|watchlist`),
      ]);

      const toDelete = remoteRows.filter(
        row => !localKeys.has(`${row.tmdb_id}|${row.list}`)
      );

      if (toDelete.length > 0) {
        await Promise.all(
          toDelete.map(row =>
            supabase
              .from("Coltel")
              .delete()
              .eq("user_id", USER_ID)
              .eq("tmdb_id", row.tmdb_id)
              .eq("list", row.list)
          )
        );
      }
    }
  }

  // UPSERT degli item correnti
  const rawRows = [
    ...(db.seen || []).map((item) => ({
      user_id: USER_ID,
      tmdb_id: item.id,
      media_type: item.media_type,
      list: "seen",
      rating: item.rating ?? null,
      rating_label: item.ratingLabel ?? null,
      data: item,
    })),
    ...(db.watchlist || []).map((item) => ({
      user_id: USER_ID,
      tmdb_id: item.id,
      media_type: item.media_type,
      list: "watchlist",
      rating: null,
      rating_label: null,
      data: item,
    })),
  ];

  // FIX COLLISIONE FILM/SERIE: il vincolo di unicità su Supabase è
  // (user_id, tmdb_id, list) e NON include media_type. TMDb usa id numerici
  // indipendenti per film e serie, quindi un film e una serie con lo stesso
  // id nella stessa lista producono due righe con la stessa chiave di
  // conflitto nello stesso upsert — Postgres rifiuta l'intera istruzione
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"),
  // facendo fallire la sincronizzazione dell'intero batch, non solo delle
  // righe in collisione. Deduplichiamo qui come rete di sicurezza, prima di
  // costruire la query: nel caso raro di collisione teniamo un solo item
  // (il primo, cioè quello aggiunto più di recente grazie a unshift) e
  // scartiamo l'altro con un warning, invece di far fallire tutto il push.
  const seenKeys = new Set();
  const rows = [];
  for (const row of rawRows) {
    const key = `${row.tmdb_id}|${row.list}`;
    if (seenKeys.has(key)) {
      console.warn(`Collisione id TMDb tra film e serie (id=${row.tmdb_id}, lista=${row.list}): tengo solo il primo, l'altro non verrà sincronizzato su Supabase.`);
      continue;
    }
    seenKeys.add(key);
    rows.push(row);
  }

  if (!rows.length) return;

  const { error } = await supabase
    .from("Coltel")
    .upsert(rows, { onConflict: "user_id,tmdb_id,list" });

  if (error) throw error;
}

// ─── REPORT (profilo + consigli generati da Claude ogni 6 mesi) ─────────────
// Sola lettura dal client: la riga viene scritta solo dalla Edge Function
// "generate-report" (chiave service_role, mai esposta qui). Il client legge
// l'ultima riga e può richiedere una rigenerazione on-demand tramite la
// stessa funzione, invocata con la chiave pubblica già usata per il resto.

export async function loadLatestReport() {
  try {
    const res = await supabase
      .from("monthly_report")
      .select("generated_at, payload")
      .eq("user_id", USER_ID)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (!res || res.error || !res.data?.length) return null;
    return res.data[0];
  } catch (e) {
    console.warn("Lettura report fallita:", e);
    return null;
  }
}

export async function regenerateReport() {
  const { data, error } = await supabase.functions.invoke("generate-report");
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── SUGGEST HISTORY ─────────────────────────────────────────────────────────

export function loadSuggestHistory() {
  try {
    const raw = localStorage.getItem(SUGGEST_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("Storico suggerimenti corrotto, reset automatico", e);
    try { localStorage.setItem(SUGGEST_HISTORY_KEY, JSON.stringify([])); } catch {}
    return [];
  }
}

export function saveSuggestHistory(history) {
  try {
    localStorage.setItem(
      SUGGEST_HISTORY_KEY,
      JSON.stringify((history || []).slice(0, SUGGEST_HISTORY_MAX))
    );
  } catch (e) {
    console.warn("Salvataggio storico suggerimenti fallito", e);
  }
}
