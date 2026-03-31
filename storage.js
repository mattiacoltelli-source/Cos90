import { supabase } from "./supabase.js";

const USER_ID = "default";

const LOCAL_DB_KEY = "cineTrackerDB"; // ➕ AGGIUNTO

const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;

// ─── LOAD DB ─────────────────────────────────────────

// ➕ AGGIUNTO parametro localOnly
export async function loadDB(localOnly = false) {
try {
// ➕ LOCAL FIRST
const localRaw = localStorage.getItem(LOCAL_DB_KEY);
const localDB = localRaw ? JSON.parse(localRaw) : null;

if (localOnly) {  
  return localDB || { seen: [], watchlist: [] };  
}  

const res = await supabase  
  .from("Coltel")  
  .select("*")  
  .eq("user_id", USER_ID);  

if (!res || res.error) {  
  console.warn("Supabase error:", res?.error);  
  return localDB || { seen: [], watchlist: [] }; // ➕ fallback local  
}  

const data = res.data || [];  

const seen = data  
  .filter(r => r.list === "seen")  
  .map(r => r.data);  

const watchlist = data  
  .filter(r => r.list === "watchlist")  
  .map(r => r.data);  

const db = { seen, watchlist };  

// ➕ salva cache  
localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));  

return db;

} catch (e) {
console.error("LOAD ERROR:", e);

// ➕ fallback local  
const localRaw = localStorage.getItem(LOCAL_DB_KEY);  
return localRaw ? JSON.parse(localRaw) : { seen: [], watchlist: [] };

}
}

// ─── SAVE DB (UPSERT) ───────────────────────────────

export async function saveDB(db) {
try {
// ➕ salva subito local (istantaneo)
localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));

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
  .upsert(rows, {  
    onConflict: "user_id,tmdb_id,list",  
  });  

if (error) throw error;

} catch (e) {
console.warn("Errore salvataggio DB Supabase", e);
}
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