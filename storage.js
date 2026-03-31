import { supabase } from "./supabase.js";

const USER_ID = "default";

const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;
const DB_CACHE_KEY = "cineTrackerDBCache";

// ─── CACHE LOCALE ────────────────────────────────────

function saveLocalCache(db) {
  try {
    localStorage.setItem(DB_CACHE_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("Cache locale non salvata", e);
  }
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(DB_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.seen) && Array.isArray(parsed.watchlist)) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── LOAD DB ─────────────────────────────────────────
// Ritorna subito la cache locale (istantaneo), poi
// sincronizza da Supabase in background aggiornando la cache.

export async function loadDB() {
  const cache = loadLocalCache();

  // Sync da Supabase in background (non blocca il boot)
  syncFromSupabase();

  // Se abbiamo dati in cache, li usiamo subito
  if (cache) return cache;

  // Prima apertura assoluta: aspettiamo Supabase
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

// ─── SAVE DB ─────────────────────────────────────────
// Aggiorna subito la cache locale, poi salva solo
// gli item modificati su Supabase in background.

export async function saveDB(db) {
  // 1. Salva subito in locale (istantaneo)
  saveLocalCache(db);

  // 2. Upsert su Supabase in background (non blocca l'UI)
  _pushToSupabase(db).catch(e => {
    console.warn("Errore sync Supabase (background)", e);
  });
}

async function _pushToSupabase(db) {
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

// ─── SUGGEST HISTORY ───────────────────────────────

export function loadSuggestHistory() {
  try {
    const raw = localStorage.getItem(SUGGEST_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("Storico suggerimenti corrotto, reset automatico", e);
    localStorage.setItem(SUGGEST_HISTORY_KEY, JSON.stringify([]));
    return [];
  }
}

export function saveSuggestHistory(history) {
  localStorage.setItem(
    SUGGEST_HISTORY_KEY,
    JSON.stringify((history || []).slice(0, SUGGEST_HISTORY_MAX))
  );
}
