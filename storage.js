import { supabase } from "./supabase.js";

const USER_ID = "default";

const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;

async function loadDB() {
  try {
    const { data, error } = await supabase
      .from("Coltel")
      .select("*")
      .eq("user_id", USER_ID);

    if (error) throw error;

    const seen = (data || [])
      .filter((r) => r.list === "seen")
      .map((r) => r.data);

    const watchlist = (data || [])
      .filter((r) => r.list === "watchlist")
      .map((r) => r.data);

    return { seen, watchlist };
  } catch (e) {
    console.warn("Errore caricamento DB Supabase, fallback vuoto", e);
    return { seen: [], watchlist: [] };
  }
}

async function saveDB(db) {
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

    const { error: delError } = await supabase
      .from("Coltel")
      .delete()
      .eq("user_id", USER_ID);

    if (delError) throw delError;

    if (rows.length > 0) {
      const { error: insError } = await supabase.from("Coltel").insert(rows);
      if (insError) throw insError;
    }
  } catch (e) {
    console.warn("Errore salvataggio DB Supabase", e);
  }
}

function loadSuggestHistory() {
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

function saveSuggestHistory(history) {
  localStorage.setItem(
    SUGGEST_HISTORY_KEY,
    JSON.stringify((history || []).slice(0, SUGGEST_HISTORY_MAX))
  );
}
