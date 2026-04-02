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
  } catch (e) {
    console.warn("Cache locale non salvata", e);
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

// ─── LOAD DB ─────────────────────────────────────────────────────────────────
// Ritorna subito la cache locale (istantaneo), poi
// sincronizza da Supabase in background aggiornando la cache.

export async function loadDB() {
  const cache = loadLocalCache();

  if (cache) {
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
    return db;

  } catch (e) {
    console.error("SYNC ERROR:", e);
    return null;
  }
}

// ─── SAVE DB ─────────────────────────────────────────────────────────────────
// Aggiorna subito la cache locale, poi salva su Supabase in background
// con retry automatico in caso di errore di rete (FIX 2).

export async function saveDB(db) {
  // 1. Salva subito in locale (istantaneo)
  saveLocalCache(db);

  // 2. Push su Supabase in background con retry automatico
  withRetry(() => _pushToSupabase(db)).catch(e => {
    console.warn("Errore sync Supabase dopo tutti i tentativi:", e);
  });
}

async function _pushToSupabase(db) {
  // DELETE righe orfane (fix precedente mantenuto)
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

  // UPSERT degli item correnti
  const rows = [
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

  if (!rows.length) return;

  const { error } = await supabase
    .from("Coltel")
    .upsert(rows, { onConflict: "user_id,tmdb_id,list" });

  if (error) throw error;
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
