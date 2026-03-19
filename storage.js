const DB_KEY = "cineTrackerDB";
const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { seen: [], watchlist: [] };

    const db = JSON.parse(raw);
    if (!db || typeof db !== "object") return { seen: [], watchlist: [] };
    if (!Array.isArray(db.seen)) db.seen = [];
    if (!Array.isArray(db.watchlist)) db.watchlist = [];

    return db;
  } catch (e) {
    console.warn("CineTracker DB corrotto. Reset.", e);
    const empty = { seen: [], watchlist: [] };
    localStorage.setItem(DB_KEY, JSON.stringify(empty));
    return empty;
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function loadSuggestHistory() {
  try {
    const raw = localStorage.getItem(SUGGEST_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("Storico suggerimenti corrotto. Reset.", e);
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