import { supabase } from "./supabase.js";

const USER_ID = "default";

const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;

export async function loadDB() {
  try {
    const res = await supabase
      .from("Coltel")
      .select("*")
      .eq("user_id", USER_ID);

    console.log("SUPABASE DATA:", res.data);
    console.log("SUPABASE ERROR:", res.error);

    if (!res || res.error) {
      console.warn("Supabase error:", res?.error);
      return { seen: [], watchlist: [] };
    }

    const data = res.data || [];

    const seen = data
      .filter(r => r.list === "seen")
      .map(r => r.data);

    const watchlist = data
      .filter(r => r.list === "watchlist")
      .map(r => r.data);

    return { seen, watchlist };
  } catch (e) {
    console.error("LOAD ERROR:", e);
    return { seen: [], watchlist: [] };
  }
}

export async function saveDB(db) {
  try {
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

    // Upsert: inserisce o aggiorna solo le righe cambiate
    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("Coltel")
        .upsert(rows, { onConflict: "user_id,tmdb_id,list" });
      if (upsertError) throw upsertError;
    }

    // Rimuove righe che non sono più nel db locale
    const currentKeys = rows.map(r => `${r.tmdb_id}_${r.list}`);
    const { data: existing, error: fetchError } = await supabase
      .from("Coltel")
      .select("id, tmdb_id, list")
      .eq("user_id", USER_ID);

    if (!fetchError && existing) {
      const toDelete = existing
        .filter(r => !currentKeys.includes(`${r.tmdb_id}_${r.list}`))
        .map(r => r.id);

      if (toDelete.length > 0) {
        await supabase.from("Coltel").delete().in("id", toDelete);
      }
    }
  } catch (e) {
    console.warn("Errore salvataggio DB Supabase", e);
  }
}

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
