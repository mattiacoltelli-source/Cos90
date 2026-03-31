import { supabase } from "./supabase.js";
import {
  uniqueKey,
  normalizedItem,
  sanitizeVoteInput,
  parseUserVote,
  decadeOf,
  posterUrl,
  buildDateRange,
  randomPage,
  escapeHtml,
  mediaLabel,
  rawNumberToFixed
} from "./cine-core.js";
import { loadDB, saveDB, loadSuggestHistory, saveSuggestHistory } from "./storage.js";
import {
  showToast,
  haptic,
  animateStats,
  animateBarGroups,
  initScreens,
  switchScreen,
  getPreviousScreen,
  SCREENS,
  renderShelf,
  renderSearchResults,
  renderLibraryList,
  renderGenreFilters,
  renderGenreBars,
  renderPodium,
  renderRankingList,
  renderTonightFive,
  renderDiscoverResult,
  renderClassicResult,
  renderDetailFacts
} from "./ui.js";
import {
  tmdbSearch,
  tmdbFetchDetail,
  tmdbFetchDiscoverLevel,
  buildFallbackQueries
} from "./tmdb.js";

const normalizeCache = new Map();

const CONFIG = {
  TONIGHT_COOLDOWN_MS: 20000,
  SEARCH_DEBOUNCE_MS: 350,
  REQUEST_TIMEOUT_MS: 15000,
  MAX_SUGGEST_HISTORY: 80,
  MAX_HOME_SHELF_ITEMS: 8,
  MAX_RANKED_ITEMS: 250,
  DEBUG: false
};

const state = {
  db: { seen: [], watchlist: [] },
  suggestHistory: createSafeSuggestHistory(loadSuggestHistory()),
  currentView: "home",
  items: [],
  filters: {
    currentType: "multi",
    currentLibraryMode: "watch",
    currentLibraryFilter: "all",
    currentLibraryGenre: "all"
  },
  loading: {
    search: false,
    detail: false,
    tonight: false,
    discover: false
  },
  saving: false,
  currentDetail: null,
  lastAutoRecommendAt: 0,
  tonightReqCounter: 0,
  searchReqCounter: 0,
  pending: {
    searchQuery: "",
    requests: new Map()
  },
  cache: {
    ranked: new Map(),
    details: new Map(),
    genreStatsKey: "",
    genreStats: [],
    tasteProfileKey: "",
    tasteProfile: null
  }
};

const debug = {
  enabled: CONFIG.DEBUG,
  log(...args) {
    if (!this.enabled) return;
    console.log("[app]", ...args);
  },
  warn(...args) {
    if (!this.enabled) return;
    console.warn("[app]", ...args);
  },
  error(...args) {
    if (!this.enabled) return;
    console.error("[app]", ...args);
  }
};

const debouncedSearch = debounce(() => {
  doSearch();
}, CONFIG.SEARCH_DEBOUNCE_MS);

init();

function init() {
  try {
    initScreens();
    bindEvents();

    renderHomeShelves();

    requestAnimationFrame(async () => {
      try {
        const raw = await loadDB(true);

        state.db = createSafeDB(raw);
        ensureStateConsistency();
        renderAll();

        loadDB(false).then(remote => {
          if (!remote) return;
          state.db = createSafeDB(remote);
          ensureStateConsistency();
          renderAll();
        });
      } catch (e) {
        console.warn("Init DB error", e);
      }
    });

    state.currentView = getVisibleScreenName() || "home";
  } catch (error) {
    debug.error("Init error", error);
  }
}

function createSafeDB(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    seen: normalizeList(source.seen),
    watchlist: normalizeList(source.watchlist)
  };
}

function createSafeSuggestHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry => ({
      key: typeof entry?.key === "string" ? entry.key : "",
      at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : 0
    }))
    .filter(entry => entry.key && entry.at > 0)
    .slice(0, CONFIG.MAX_SUGGEST_HISTORY);
}

function ensureStateConsistency() {
  state.db = dedupeDB(createSafeDB(state.db));
  state.suggestHistory = createSafeSuggestHistory(state.suggestHistory);
  invalidateCaches();
}

function dedupeDB(db) {
  const seenMap = new Map();
  const watchMap = new Map();

  normalizeList(db?.seen).forEach(item => {
    const key = safeUniqueKey(item);
    if (!key) return;
    if (!seenMap.has(key)) seenMap.set(key, normalizeMediaItem(item));
  });

  normalizeList(db?.watchlist).forEach(item => {
    const key = safeUniqueKey(item);
    if (!key || seenMap.has(key)) return;
    if (!watchMap.has(key)) watchMap.set(key, normalizeMediaItem(item));
  });

  return {
    seen: [...seenMap.values()],
    watchlist: [...watchMap.values()]
  };
}

function invalidateCaches() {
  state.cache.ranked.clear();
  if (state.cache.details) state.cache.details.clear();
  state.cache.genreStatsKey = "";
  state.cache.genreStats = [];
  state.cache.tasteProfileKey = "";
  state.cache.tasteProfile = null;
}

function snapshotDBKey() {
  return JSON.stringify({
    seen: state.db.seen.map(item => [safeUniqueKey(item), item.vote || "", item.year || "", item.media_type || ""]),
    watchlist: state.db.watchlist.map(item => safeUniqueKey(item))
  });
}

function backdropUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : "";
}

function preloadImage(src) {
  if (!src) return;
  const img = new Image();
  img.src = src;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeMediaItem).filter(Boolean);
}

function normalizeMediaItem(item) {
  if (!item || typeof item !== "object") return null;

  const cacheId = safeId(item.id ?? item?.id);
  const cacheType = normalizeMediaType(item.media_type);
  const cacheKey = cacheId && cacheType ? `${cacheId}_${cacheType}` : "";

  if (cacheKey && normalizeCache.has(cacheKey)) {
    return normalizeCache.get(cacheKey);
  }

  let normalized = null;
  try {
    normalized = normalizedItem(item);
  } catch (error) {
    debug.warn("normalizedItem failed", error, item);
    normalized = { ...item };
  }

  if (!normalized || typeof normalized !== "object") return null;

  const title = safeText(normalized.title || normalized.name || item.title || item.name);
  const year = safeYear(normalized.year || item.year);
  const mediaType = normalizeMediaType(normalized.media_type || item.media_type);
  const genreNames = normalizeGenreNames(normalized.genre_names || item.genre_names);
  const vote = normalizeVoteValue(normalized.vote || item.vote);
  const comment = safeText(normalized.comment || item.comment);
  const voteAverage = safeNumber(normalized.vote_average ?? item.vote_average, 0);
  const voteCount = safeNumber(normalized.vote_count ?? item.vote_count, 0);
  const posterPath = safePath(normalized.poster_path || item.poster_path);
  const backdropPath = safePath(normalized.backdrop_path || item.backdrop_path);
  const overview = safeText(normalized.overview || item.overview);
  const id = safeId(normalized.id ?? item.id);

  const safe = {
    ...normalized,
    id,
    title,
    year,
    media_type: mediaType,
    genre_names: genreNames,
    vote,
    comment,
    vote_average: voteAverage,
    vote_count: voteCount,
    poster_path: posterPath,
    backdrop_path: backdropPath,
    overview
  };

  if (!safe.title || !safe.media_type || !safe.id) return null;

  if (cacheKey) {
    normalizeCache.set(cacheKey, safe);
  }

  return safe;
}

function normalizeMediaType(value) {
  if (value === "movie" || value === "tv" || value === "multi") return value;
  if (value === "series") return "tv";
  return "movie";
}

function normalizeGenreNames(genres) {
  if (!Array.isArray(genres)) return [];
  return genres
    .map(g => safeText(g))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safePath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeId(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Number.isFinite(Number(value)) && Number(value) > 0) return String(value);
  return "";
}

function safeYear(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/\b(18|19|20)d{2}\b/);
  return match ? match[0] : text;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeVoteValue(value) {
  const cleaned = sanitizeVoteInput(value || "");
  if (!cleaned) return "";
  return Number.isFinite(parseUserVote(cleaned)) ? cleaned : "";
}

function safeUniqueKey(item) {
  try {
    if (!item) return "";
    const key = uniqueKey(item);
    return typeof key === "string" && key.trim() ? key : "";
  } catch (error) {
    debug.warn("uniqueKey failed", error, item);
    return "";
  }
}

function safeMediaLabel(item) {
  try {
    return mediaLabel(item);
  } catch {
    return item?.media_type === "tv" ? "Serie TV" : "Film";
  }
}

function safeRenderDetailFacts(item) {
  try {
    return renderDetailFacts(item, inSeen, inWatch);
  } catch (error) {
    debug.warn("renderDetailFacts failed", error);
    const bits = [];
    if (safeMediaLabel(item)) bits.push(`<span class="detail-fact">${escapeHtml(safeMediaLabel(item))}</span>`);
    if (item?.year) bits.push(`<span class="detail-fact">${escapeHtml(item.year)}</span>`);
    return bits.join("");
  }
}

function inSeen(item) {
  const key = safeUniqueKey(normalizeMediaItem(item));
  if (!key) return null;
  return state.db.seen.find(x => safeUniqueKey(x) === key) || null;
}

function inWatch(item) {
  const key = safeUniqueKey(normalizeMediaItem(item));
  if (!key) return null;
  return state.db.watchlist.find(x => safeUniqueKey(x) === key) || null;
}

function getStoredItem(item) {
  return inSeen(item) || inWatch(item) || null;
}

function closeAllSearchActionMenus(exceptCard = null) {
  document.querySelectorAll(".poster-card.is-actions-open").forEach(card => {
    if (exceptCard && card === exceptCard) return;
    card.classList.remove("is-actions-open");
  });
}

function toggleSearchActionMenu(card) {
  if (!card) return;
  const willOpen = !card.classList.contains("is-actions-open");
  closeAllSearchActionMenus(card);
  card.classList.toggle("is-actions-open", willOpen);
}

function validateVote(rawVote) {
  const cleaned = sanitizeVoteInput(rawVote);

  if (!rawVote || !String(rawVote).trim()) {
    return { ok: true, value: "" };
  }

  if (!cleaned || !Number.isFinite(parseUserVote(cleaned))) {
    showToast("Voto non valido. Usa: 7, 7+, 7,5 oppure 8-.", "error", "Voto");
    return { ok: false, value: "" };
  }

  return { ok: true, value: cleaned };
}

function decadeScoreLabel(year) {
  try {
    return decadeOf(year);
  } catch {
    return "";
  }
}

function getUserTasteProfile() {
  const cacheKey = snapshotDBKey();
  if (state.cache.tasteProfileKey === cacheKey && state.cache.tasteProfile) {
    return state.cache.tasteProfile;
  }

  const genreCount = {};
  const genreVotes = {};
  const decadeCount = {};
  let movieCount = 0;
  let seriesCount = 0;

  state.db.seen.forEach(item => {
    if (item.media_type === "movie") movieCount++;
    else if (item.media_type === "tv") seriesCount++;

    const decade = decadeScoreLabel(item.year);
    if (decade) decadeCount[decade] = (decadeCount[decade] || 0) + 1;

    const voteNum = parseUserVote(item.vote);
    (item.genre_names || []).forEach(g => {
      genreCount[g] = (genreCount[g] || 0) + 1;
      if (Number.isFinite(voteNum)) {
        if (!genreVotes[g]) genreVotes[g] = [];
        genreVotes[g].push(voteNum);
      }
    });
  });

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g);

  const topDecade = Object.entries(decadeCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const prefType = movieCount >= seriesCount ? "movie" : "tv";

  const genreAverages = {};
  Object.keys(genreCount).forEach(g => {
    const votes = genreVotes[g] || [];
    genreAverages[g] = votes.length
      ? votes.reduce((a, b) => a + b, 0) / votes.length
      : 6.8;
  });

  const overallVotes = state.db.seen
    .map(x => parseUserVote(x.vote))
    .filter(v => Number.isFinite(v));

  const avgVote = overallVotes.length
    ? overallVotes.reduce((a, b) => a + b, 0) / overallVotes.length
    : 7;

  const profile = { topGenres, topDecade, prefType, genreAverages, avgVote };
  state.cache.tasteProfileKey = cacheKey;
  state.cache.tasteProfile = profile;
  return profile;
}

function getHistoryPenalty(key) {
  const now = Date.now();
  let penalty = 0;

  state.suggestHistory.forEach(entry => {
    if (entry.key !== key) return;
    const hoursAgo = (now - entry.at) / (1000 * 60 * 60);

    if (hoursAgo < 6) penalty += 8;
    else if (hoursAgo < 24) penalty += 5;
    else if (hoursAgo < 72) penalty += 3;
    else if (hoursAgo < 168) penalty += 1.5;
  });

  return penalty;
}

function calculateAffinity(item, profile) {
  const genres = item.genre_names || [];
  let genreBase = 0;
  let matched = 0;

  genres.forEach(g => {
    if (profile.genreAverages[g]) {
      genreBase += profile.genreAverages[g];
      matched++;
    } else if (profile.topGenres.includes(g)) {
      genreBase += 7.5;
      matched++;
    }
  });

  if (!matched) {
    genreBase = Math.max(6.4, profile.avgVote);
    matched = 1;
  }

  let score10 = genreBase / matched;

  if (profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade) score10 += 0.35;
  if (item.media_type === profile.prefType) score10 += 0.25;

  const tmdbVote = Number(item.vote_average) || 0;
  if (tmdbVote > 0) score10 += Math.min(0.45, (tmdbVote - 6) * 0.1);

  score10 = Math.max(6.2, Math.min(9.6, score10));
  return Math.round(score10 * 10);
}

function scoreCandidate(item, profile, selectedBoosts = []) {
  let score = 0;
  const genres = item.genre_names || [];

  genres.forEach(g => {
    if (profile.topGenres.includes(g)) score += 4;
    if (profile.genreAverages[g]) score += Math.max(0, profile.genreAverages[g] - 5.5);
    if (selectedBoosts.includes(g)) score += 3;
  });

  if (profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade) score += 2;
  if (item.media_type === profile.prefType) score += 1;

  score += Math.min(2.5, (item.vote_average || 0) / 4);
  score += Math.min(2, (item.vote_count || 0) / 1200);
  score -= getHistoryPenalty(safeUniqueKey(item));

  return score;
}

function buildReason(item, profile, affinity) {
  const reasons = [];
  const matches = (item.genre_names || []).filter(g => profile.topGenres.includes(g));

  if (matches.length) reasons.push(`match con ${matches.slice(0, 2).join(" + ")}`);
  if (profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade) reasons.push("decade che guardi spesso");
  if (affinity >= 88) reasons.push("compatibilità molto alta");
  else if (affinity >= 80) reasons.push("buona sintonia con i tuoi gusti");

  return reasons.slice(0, 3);
}

function pickDiverse(ranked, count = 5) {
  const selected = [];
  const usedKeys = new Set();
  const usedGenres = new Map();

  for (const entry of ranked) {
    if (selected.length >= count) break;

    const key = safeUniqueKey(entry.item);
    if (!key || usedKeys.has(key)) continue;

    const primaryGenre = (entry.item.genre_names && entry.item.genre_names[0]) || "Altro";
    const usage = usedGenres.get(primaryGenre) || 0;

    if (usage >= 1 && selected.length < count - 1) continue;

    selected.push(entry);
    usedKeys.add(key);
    usedGenres.set(primaryGenre, usage + 1);
  }

  if (selected.length < count) {
    for (const entry of ranked) {
      if (selected.length >= count) break;
      const key = safeUniqueKey(entry.item);
      if (!key || usedKeys.has(key)) continue;
      selected.push(entry);
      usedKeys.add(key);
    }
  }

  return selected.slice(0, count);
}

function registerSuggested(items) {
  const now = Date.now();
  const next = [
    ...normalizeList(items).map(item => ({ key: safeUniqueKey(item), at: now })).filter(x => x.key),
    ...state.suggestHistory
  ].slice(0, CONFIG.MAX_SUGGEST_HISTORY);

  state.suggestHistory = next;
  try {
    saveSuggestHistory(state.suggestHistory);
  } catch (error) {
    debug.warn("saveSuggestHistory failed", error);
  }
}

function toggleHidden(id, shouldHide) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", shouldHide);
}

function renderHomeShelves() {
  const watchPrev = state.db.watchlist.slice(0, CONFIG.MAX_HOME_SHELF_ITEMS);
  const seenMovies = state.db.seen.filter(x => x.media_type === "movie").slice(0, CONFIG.MAX_HOME_SHELF_ITEMS);
  const seenSeries = state.db.seen.filter(x => x.media_type === "tv").slice(0, CONFIG.MAX_HOME_SHELF_ITEMS);

  toggleHidden("watchShelfEmpty", watchPrev.length > 0);
  toggleHidden("seenMovieShelfEmpty", seenMovies.length > 0);
  toggleHidden("seenSeriesShelfEmpty", seenSeries.length > 0);

  toggleHidden("openWatchAll", state.db.watchlist.length === 0);
  toggleHidden("openSeenMovies", state.db.seen.filter(x => x.media_type === "movie").length === 0);
  toggleHidden("openSeenSeries", state.db.seen.filter(x => x.media_type === "tv").length === 0);

  renderShelf("watchShelf", watchPrev);
  renderShelf("seenMovieShelf", seenMovies);
  renderShelf("seenSeriesShelf", seenSeries);
}

function getAvailableGenres() {
  const source = state.filters.currentLibraryMode === "watch" ? state.db.watchlist : state.db.seen;

  let filtered = source;
  if (state.filters.currentLibraryFilter === "movie") filtered = source.filter(x => x.media_type === "movie");
  if (state.filters.currentLibraryFilter === "series") filtered = source.filter(x => x.media_type === "tv");

  const set = new Set();
  filtered.forEach(item => {
    (item.genre_names || []).forEach(g => {
      if (g && g.trim()) set.add(g);
    });
  });

  return [...set].sort((a, b) => a.localeCompare(b, "it"));
}

function doRenderLibrary() {
  const source = state.filters.currentLibraryMode === "watch" ? state.db.watchlist : state.db.seen;
  const genres = getAvailableGenres();

  if (state.filters.currentLibraryGenre !== "all" && !genres.includes(state.filters.currentLibraryGenre)) {
    state.filters.currentLibraryGenre = "all";
  }

  renderGenreFilters(genres, state.filters.currentLibraryGenre);

  let items = source;
  if (state.filters.currentLibraryFilter === "movie") items = items.filter(x => x.media_type === "movie");
  if (state.filters.currentLibraryFilter === "series") items = items.filter(x => x.media_type === "tv");
  if (state.filters.currentLibraryGenre !== "all") {
    items = items.filter(x => (x.genre_names || []).includes(state.filters.currentLibraryGenre));
  }

  state.items = items;

  let baseTitle = "Archivio visti";
  if (state.filters.currentLibraryMode === "watch") baseTitle = "Watchlist";
  else if (state.filters.currentLibraryFilter === "movie") baseTitle = "Film visti";
  else if (state.filters.currentLibraryFilter === "series") baseTitle = "Serie TV viste";

  const libraryTitle = document.getElementById("libraryTitle");
  if (libraryTitle) {
    libraryTitle.textContent = state.filters.currentLibraryGenre === "all"
      ? baseTitle
      : `${baseTitle} · ${state.filters.currentLibraryGenre}`;
  }

  document.querySelectorAll(".filter-pill[data-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === state.filters.currentLibraryFilter);
  });

  const listEl = document.getElementById("libraryList");
  const emptyEl = document.getElementById("libraryEmpty");
  if (!listEl || !emptyEl) return;

  if (!items.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = state.filters.currentLibraryMode === "watch"
      ? (state.filters.currentLibraryGenre === "all"
        ? "La tua watchlist è vuota."
        : `Nessun titolo in watchlist per "${state.filters.currentLibraryGenre}".`)
      : (state.filters.currentLibraryGenre === "all"
        ? "Nessun titolo per questo filtro."
        : `Nessun titolo visto per "${state.filters.currentLibraryGenre}".`);
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.innerHTML = renderLibraryList(items, state.filters.currentLibraryMode);
}

function openLibrary(mode, filter = "all") {
  state.filters.currentLibraryMode = mode;
  state.filters.currentLibraryFilter = filter;
  state.filters.currentLibraryGenre = "all";
  doRenderLibrary();
  safeSwitchScreen("library");
}

function getRanked(type) {
  const cacheKey = `${type}:${snapshotDBKey()}`;
  if (state.cache.ranked.has(cacheKey)) return state.cache.ranked.get(cacheKey);

  const ranked = state.db.seen
    .filter(x => x.media_type === type && Number.isFinite(parseUserVote(x.vote)))
    .sort((a, b) => {
      const voteDiff = parseUserVote(b.vote) - parseUserVote(a.vote);
      if (voteDiff !== 0) return voteDiff;

      const yearDiff = Number(b.year || 0) - Number(a.year || 0);
      if (yearDiff !== 0) return yearDiff;

      return (a.title || "").localeCompare(b.title || "", "it");
    })
    .slice(0, CONFIG.MAX_RANKED_ITEMS);

  state.cache.ranked.set(cacheKey, ranked);
  return ranked;
}

function resetRanking() {
  const empty = `<p class="empty-hint">Aggiungi voti per vedere la classifica.</p>`;

  ["top100Podium", "top100List", "top100SeriesPodium", "top100SeriesList"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = empty;
  });

  ["top100CountBadge", "top100SeriesCountBadge"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "0";
  });
}

function renderRanking() {
  const movies = getRanked("movie");
  const series = getRanked("tv");

  const badgeMovies = document.getElementById("top100CountBadge");
  const badgeSeries = document.getElementById("top100SeriesCountBadge");

  if (badgeMovies) badgeMovies.textContent = String(movies.length);
  if (badgeSeries) badgeSeries.textContent = String(series.length);

  renderPodium(document.getElementById("top100Podium"), movies.slice(0, 3), "Film");
  renderRankingList(document.getElementById("top100List"), movies.slice(3), 4, "Film");
  renderPodium(document.getElementById("top100SeriesPodium"), series.slice(0, 3), "Serie TV");
  renderRankingList(document.getElementById("top100SeriesList"), series.slice(3), 4, "Serie TV");
}

function getTopGenresForStats() {
  const cacheKey = snapshotDBKey();
  if (state.cache.genreStatsKey === cacheKey) return state.cache.genreStats;

  const genreCount = {};
  state.db.seen.forEach(item => {
    (item.genre_names || []).forEach(g => {
      genreCount[g] = (genreCount[g] || 0) + 1;
    });
  });

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  state.cache.genreStatsKey = cacheKey;
  state.cache.genreStats = topGenres;
  return topGenres;
}

function renderStats() {
  const seen = state.db.seen.length;
  const watch = state.db.watchlist.length;
  const movies = state.db.seen.filter(x => x.media_type === "movie").length;
  const series = state.db.seen.filter(x => x.media_type === "tv").length;

  animateStats(seen, watch, movies, series);

  if (state.db.seen.length < 3) {
    renderGenreBars([]);
    resetRanking();
    return;
  }

  renderGenreBars(getTopGenresForStats());
  renderRanking();
}

function renderAll() {
  requestAnimationFrame(() => {
    renderHomeShelves();
  });

  requestIdleCallback(() => {
    doRenderLibrary();
  });

  requestIdleCallback(() => {
    renderStats();
  });

  closeAllSearchActionMenus();
}

async function doSearch() {
  const input = document.getElementById("searchInput");
  const sec = document.getElementById("resultsSection");
  const res = document.getElementById("results");
  const empty = document.getElementById("resultsEmpty");
  const count = document.getElementById("resultCount");

  if (!input || !sec || !res || !empty || !count) return;

  const q = input.value.trim();
  state.pending.searchQuery = q;

  if (!q) {
    state.loading.search = false;
    sec.classList.add("hidden");
    res.innerHTML = "";
    count.textContent = "";
    empty.textContent = "Nessun risultato trovato.";
    closeAllSearchActionMenus();
    return;
  }

  const reqId = ++state.searchReqCounter;
  state.loading.search = true;
  sec.classList.remove("hidden");
  res.innerHTML = "";
  count.textContent = "";
  empty.textContent = "Ricerca in corso…";
  empty.classList.remove("hidden");
  closeAllSearchActionMenus();

  try {
    const items = await runSingleFlight(
      `search:${state.filters.currentType}:${q}`,
      () => withTimeout(tmdbSearch(q, state.filters.currentType), CONFIG.REQUEST_TIMEOUT_MS)
    );

    if (reqId !== state.searchReqCounter || state.pending.searchQuery !== q) return;

    const safeItems = normalizeList(items);

    safeItems.forEach(item => {
      preloadImage(posterUrl(item.poster_path));
    });

    state.items = safeItems;

    if (!safeItems.length) {
      empty.textContent = "Nessun risultato trovato.";
      empty.classList.remove("hidden");
      showToast("Nessun risultato trovato.", "info", "Ricerca");
      return;
    }

    empty.classList.add("hidden");
    count.textContent = `${safeItems.length} risultati`;
    res.innerHTML = renderSearchResults(safeItems, state.db);
  } catch (error) {
    if (reqId !== state.searchReqCounter) return;
    debug.error("Search error", error);
    empty.textContent = "Errore di ricerca. Controlla la connessione.";
    empty.classList.remove("hidden");
    showToast("Errore di ricerca.", "error", "Ricerca");
  } finally {
    if (reqId === state.searchReqCounter) {
      state.loading.search = false;
    }
  }
}

function openDetail(item) {
  try {
    if (!item) return;

    closeAllSearchActionMenus();

    const safeItem = normalizeMediaItem(item);
    if (!safeItem) return;

    state.currentDetail = safeItem;

    const stored = getStoredItem(safeItem);
    const src = stored || safeItem;

    const detailBackdrop = document.getElementById("detailBackdrop");
    const detailPoster = document.getElementById("detailPoster");
    const detailTitle = document.getElementById("detailTitle");
    const detailYear = document.getElementById("detailYear");
    const detailType = document.getElementById("detailType");
    const detailOverview = document.getElementById("detailOverview");
    const detailFacts = document.getElementById("detailFacts");
    const detailGenres = document.getElementById("detailGenres");
    const detailVoteInput = document.getElementById("detailVoteInput");
    const detailCommentInput = document.getElementById("detailCommentInput");
    const detailSeenBtn = document.getElementById("detailSeenBtn");
    const detailWatchBtn = document.getElementById("detailWatchBtn");

    const poster = posterUrl(src.poster_path || "");
    const backdrop = src.backdrop_path ? backdropUrl(src.backdrop_path) : poster;

    preloadImage(poster);
    preloadImage(backdrop);

    if (detailBackdrop) {
      detailBackdrop.style.backgroundImage = backdrop ? `url('${backdrop}')` : "";
    }

    if (detailPoster) {
      detailPoster.style.backgroundImage = poster ? `url('${poster}')` : "";
    }

    if (detailTitle) detailTitle.textContent = src.title || "";
    if (detailYear) {
      detailYear.textContent = src.year || "";
      toggleElement(detailYear, !!src.year);
    }
    if (detailType) {
      const typeLabel = safeMediaLabel(src);
      detailType.textContent = typeLabel || "";
      toggleElement(detailType, !!typeLabel);
    }
    if (detailOverview) {
      detailOverview.textContent = src.overview || "";
      toggleElement(detailOverview, !!src.overview);
    }

    if (detailFacts) {
      const factsHtml = safeRenderDetailFacts(src);
      detailFacts.innerHTML = factsHtml || "";
      toggleElement(detailFacts, !!factsHtml);
    }

    if (detailGenres) {
      const genreChips = (src.genre_names || []).slice(0, 4)
        .map(g => `<span class="chip">${escapeHtml(g)}</span>`)
        .join("");
      detailGenres.innerHTML = genreChips;
      toggleElement(detailGenres, !!genreChips);
    }

    if (detailVoteInput) detailVoteInput.value = src.vote || "";
    if (detailCommentInput) detailCommentInput.value = src.comment || "";

    if (detailSeenBtn) {
      detailSeenBtn.textContent = inSeen(src) ? "✓ Già tra i visti" : "Segna come visto";
    }

    if (detailWatchBtn) {
      detailWatchBtn.textContent = inWatch(src) ? "★ Già in watchlist" : "Aggiungi a watchlist";
    }

    safeSwitchScreen("detail");
  } catch (error) {
    debug.error("Errore openDetail", error);
    showToast("Errore apertura scheda.", "error", "Errore");
  }
}

async function doShowDetails(type, id) {
  closeAllSearchActionMenus();
  try {
    state.loading.detail = true;
    const item = await fetchDetailSafe(type, id);
    if (!item) throw new Error("detail-not-found");
    openDetail(item);
  } catch (error) {
    debug.error("doShowDetails error", error);
    showToast("Errore apertura scheda.", "error", "Errore");
  } finally {
    state.loading.detail = false;
  }
}

async function fetchDetailSafe(type, id) {
  const safeType = normalizeMediaType(type);
  const safeItemId = safeId(id);
  if (!safeItemId) return null;

  const cacheKey = `detail:${safeType}:${safeItemId}`;

  if (state.cache.details && state.cache.details.has(cacheKey)) {
    return state.cache.details.get(cacheKey);
  }

  const item = await runSingleFlight(
    cacheKey,
    () => withTimeout(tmdbFetchDetail(safeType, safeItemId), CONFIG.REQUEST_TIMEOUT_MS)
  );

  const normalized = normalizeMediaItem(item);

  if (normalized) {
    if (!state.cache.details) state.cache.details = new Map();
    state.cache.details.set(cacheKey, normalized);
  }

  return normalized;
}

async function doAddSeen(type, id) {
  closeAllSearchActionMenus();

  try {
    const item = await fetchDetailSafe(type, id);
    if (!item) throw new Error("item-not-found");

    if (inSeen(item)) {
      openDetail(item);
      return;
    }

    state.db.seen.unshift(item);
    state.db.watchlist = state.db.watchlist.filter(x => safeUniqueKey(x) !== safeUniqueKey(item));

    ensureStateConsistency();
    renderAll();
    openDetail(item);
    persistDB().catch(() => {
      showToast("Errore salvataggio", "error");
    });

    showToast(`"${item.title}" aggiunto ai visti.`, "success", "Salvato");
    haptic([12, 20, 12]);
  } catch (error) {
    debug.error("doAddSeen error", error);
    showToast("Errore salvataggio.", "error", "Errore");
  }
}

async function doAddWatch(type, id) {
  closeAllSearchActionMenus();

  try {
    const item = await fetchDetailSafe(type, id);
    if (!item) throw new Error("item-not-found");

    if (!inSeen(item) && !inWatch(item)) {
      state.db.watchlist.unshift(item);
      ensureStateConsistency();
      renderAll();
      persistDB().catch(() => {
        showToast("Errore salvataggio", "error");
      });
      showToast(`"${item.title}" aggiunto alla watchlist.`, "success", "Watchlist");
      haptic([10]);
    }

    openDetail(item);
  } catch (error) {
    debug.error("doAddWatch error", error);
    showToast("Errore aggiornamento watchlist.", "error", "Errore");
  }
}

async function doMoveToSeen(key) {
  const item = state.db.watchlist.find(x => safeUniqueKey(x) === key);
  if (!item) return;

  state.db.watchlist = state.db.watchlist.filter(x => safeUniqueKey(x) !== key);

  if (!state.db.seen.find(x => safeUniqueKey(x) === key)) {
    const movedItem = normalizeMediaItem({
      ...item,
      savedAt: new Date().toISOString()
    });
    if (movedItem) state.db.seen.unshift(movedItem);
  }

  ensureStateConsistency();
  renderAll();
  persistDB().catch(() => {
    showToast("Errore salvataggio", "error");
  });

  showToast(`"${item.title}" spostato tra i visti.`, "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveSeen(key) {
  const item = state.db.seen.find(x => safeUniqueKey(x) === key);
  state.db.seen = state.db.seen.filter(x => safeUniqueKey(x) !== key);

  ensureStateConsistency();
  renderAll();
  persistDB().catch(() => {
    showToast("Errore salvataggio", "error");
  });

  if (state.currentDetail && safeUniqueKey(state.currentDetail) === key) {
    safeSwitchScreen("home");
  }

  if (item) {
    showToast(`"${item.title}" rimosso dai visti.`, "info", "Rimosso");
    haptic([14]);
  }
}

async function doRemoveWatch(key) {
  const item = state.db.watchlist.find(x => safeUniqueKey(x) === key);
  state.db.watchlist = state.db.watchlist.filter(x => safeUniqueKey(x) !== key);

  ensureStateConsistency();
  renderAll();
  persistDB().catch(() => {
    showToast("Errore salvataggio", "error");
  });

  if (state.currentDetail && safeUniqueKey(state.currentDetail) === key) {
    safeSwitchScreen("home");
  }

  if (item) {
    showToast(`"${item.title}" rimosso dalla watchlist.`, "info", "Rimosso");
    haptic([14]);
  }
}

async function doSaveDetailNotes() {
  if (!state.currentDetail) return;

  const voteInput = document.getElementById("detailVoteInput");
  const commentInput = document.getElementById("detailCommentInput");
  if (!voteInput || !commentInput) return;

  const check = validateVote(voteInput.value);
  if (!check.ok) return;

  const key = safeUniqueKey(state.currentDetail);
  const vote = check.value;
  const comment = commentInput.value.trim();

  let target = state.db.seen.find(x => safeUniqueKey(x) === key) || state.db.watchlist.find(x => safeUniqueKey(x) === key);

  if (!target) {
    target = normalizeMediaItem({ ...state.currentDetail });
    if (!target) return;
    state.db.watchlist.unshift(target);
  }

  target.vote = vote;
  target.comment = comment;

  ensureStateConsistency();
  renderAll();
  openDetail(target);
  persistDB().catch(() => {
    showToast("Errore salvataggio", "error");
  });

  showToast("Voto e commento salvati.", "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveCurrentDetail() {
  if (!state.currentDetail) return;

  const key = safeUniqueKey(state.currentDetail);
  const title = state.currentDetail.title;

  state.db.seen = state.db.seen.filter(x => safeUniqueKey(x) !== key);
  state.db.watchlist = state.db.watchlist.filter(x => safeUniqueKey(x) !== key);

  ensureStateConsistency();
  renderAll();
  safeSwitchScreen("home");
  persistDB().catch(() => {
    showToast("Errore salvataggio", "error");
  });

  showToast(`"${title}" rimosso dalla libreria.`, "info", "Rimosso");
  haptic([14]);
}

function getSelectedGenre() {
  const el = document.getElementById("genreSelect");
  return el?.value || "all";
}

async function recommendTonightFive(isAuto = false) {
  const el = document.getElementById("tonightSuggestion");
  if (!el || state.loading.tonight) return;

  const reqId = ++state.tonightReqCounter;

  if (state.db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    if (!isAuto) showToast("Aggiungi almeno 3 titoli visti.", "info", "Consigli");
    return;
  }

  state.loading.tonight = true;
  el.innerHTML = `<p class="tonight__hint">🔍 Sto cercando 5 titoli adatti…</p>`;

  const profile = getUserTasteProfile();
  const queryConfig = safeBuildFallbackQueries(profile, null, {
    useSelectedGenre: false,
    selectedGenre: "all"
  });
  const type = queryConfig.type;
  const levels = queryConfig.levels;
  const excludedKeys = new Set([...state.db.seen, ...state.db.watchlist].map(safeUniqueKey).filter(Boolean));

  try {
    let candidates = [];
    let levelLabel = "";

    for (const level of levels) {
      const urls = Array.isArray(level?.urls) ? level.urls : [];
      if (!urls.length) continue;

      const found = normalizeList(
        await withTimeout(
          tmdbFetchDiscoverLevel(urls, type, excludedKeys),
          CONFIG.REQUEST_TIMEOUT_MS
        )
      );

      candidates = [...candidates, ...found];

      const dedup = new Map();
      candidates.forEach(item => {
        const key = safeUniqueKey(item);
        if (key && !excludedKeys.has(key)) dedup.set(key, item);
      });
      candidates = [...dedup.values()];

      if (candidates.length >= 5) {
        levelLabel = level?.label || "";
        break;
      }
    }

    if (reqId !== state.tonightReqCounter) return;

    if (!candidates.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun consiglio trovato. Riprova più tardi.</p>`;
      return;
    }

    const ranked = candidates
      .map(item => {
        const affinity = calculateAffinity(item, profile);
        const rankScore = scoreCandidate(item, profile) + affinity / 20 + Math.random() * 1.1;
        return { item, affinity, rankScore };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 18);

    const finalFive = pickDiverse(ranked, 5).sort((a, b) => b.affinity - a.affinity);

    if (!finalFive.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun consiglio trovato.</p>`;
      return;
    }

    registerSuggested(finalFive.map(x => x.item));

    const enriched = finalFive.map(entry => ({
      item: entry.item,
      affinity: entry.affinity,
      reasons: buildReason(entry.item, profile, entry.affinity)
    }));

    const note = levelLabel && levelLabel !== "ricerca precisa"
      ? "Ho allargato un po' la ricerca per trovare 5 proposte."
      : "";

    el.innerHTML = renderTonightFive(enriched, null, note);

    if (!isAuto) haptic([10]);
    if (isAuto) state.lastAutoRecommendAt = Date.now();
  } catch (error) {
    debug.error("recommendTonightFive error", error);
    if (reqId !== state.tonightReqCounter) return;
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca dei consigli.", "error", "Consigli");
  } finally {
    if (reqId === state.tonightReqCounter) {
      state.loading.tonight = false;
    }
  }
}

async function maybeAutoRecommend() {
  if (Date.now() - state.lastAutoRecommendAt < CONFIG.TONIGHT_COOLDOWN_MS) return;
  await recommendTonightFive(true);
}

async function discoverByTaste() {
  const el = document.getElementById("tonightSuggestion");
  if (!el || state.loading.discover) return;

  if (state.db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    showToast("Aggiungi almeno 3 titoli visti.", "info", "Scopri");
    return;
  }

  state.loading.discover = true;
  el.innerHTML = `<p class="tonight__hint">🔍 Sto cercando qualcosa di nuovo…</p>`;

  const profile = getUserTasteProfile();
  const selectedGenre = getSelectedGenre();
  const queryConfig = safeBuildFallbackQueries(profile, null, {
    useSelectedGenre: selectedGenre !== "all",
    selectedGenre
  });
  const type = queryConfig.type;
  const levels = queryConfig.levels;
  const selectedBoosts = queryConfig.selectedBoosts;
  const excludedKeys = new Set([...state.db.seen, ...state.db.watchlist].map(safeUniqueKey).filter(Boolean));

  try {
    let candidates = [];
    let levelLabel = "";

    for (const level of levels) {
      const urls = Array.isArray(level?.urls) ? level.urls : [];
      if (!urls.length) continue;

      const found = normalizeList(
        await withTimeout(
          tmdbFetchDiscoverLevel(urls, type, excludedKeys),
          CONFIG.REQUEST_TIMEOUT_MS
        )
      );

      if (found.length > 0) {
        candidates = found;
        levelLabel = level?.label || "";
        break;
      }
    }

    if (!candidates.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun risultato. Riprova più tardi.</p>`;
      return;
    }

    const scored = candidates
      .map(item => ({
        item,
        score: scoreCandidate(item, profile, selectedBoosts) + Math.random() * 1.3
      }))
      .sort((a, b) => b.score - a.score);

    const topPool = scored.slice(0, Math.min(12, scored.length));
    const chosen = topPool[Math.floor(Math.random() * topPool.length)]?.item;

    if (!chosen) {
      el.innerHTML = `<p class="tonight__hint">Nessun risultato. Riprova più tardi.</p>`;
      return;
    }

    registerSuggested([chosen]);

    const genres = chosen.genre_names || [];
    const matchGenres = genres.filter(g => profile.topGenres.includes(g));
    const rating = rawNumberToFixed(chosen.vote_average || 0, 1, "n.d.");

    const whyBits = [];
    if (selectedGenre !== "all" && genres.includes(selectedGenre)) whyBits.push(`hai scelto il genere ${selectedGenre}`);
    if (matchGenres.length) whyBits.push(`ami il genere ${matchGenres[0]}`);
    if (profile.topDecade && decadeScoreLabel(chosen.year) === profile.topDecade) whyBits.push(`ti piacciono gli ${profile.topDecade}`);
    if (!whyBits.length) whyBits.push("ha un buon potenziale per i tuoi gusti");

    el.innerHTML = renderDiscoverResult({
      item: chosen,
      why: whyBits.join(" · "),
      levelLabel,
      rating
    });

    haptic([10]);
  } catch (error) {
    debug.error("discoverByTaste error", error);
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca.", "error", "Scopri");
  } finally {
    state.loading.discover = false;
  }
}

async function suggestClassic() {
  const el = document.getElementById("classicSuggestion");
  if (!el) return;

  if (state.db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per ottenere un classico su misura.</p>`;
    showToast("Aggiungi almeno 3 titoli visti.", "info", "Classico");
    return;
  }

  el.innerHTML = `<p class="tonight__hint">🎞️ Sto cercando un classico adatto a te…</p>`;

  const profile = getUserTasteProfile();
  const excludedKeys = new Set([...state.db.seen, ...state.db.watchlist].map(safeUniqueKey).filter(Boolean));

  try {
    const selectedGenre = profile.topGenres[0] || null;
    const range = buildDateRange(1950, 2009);
    const page = randomPage(1, 4);

    const queryConfig = safeBuildFallbackQueries(profile, {
      mode: "classic",
      selectedGenre,
      range,
      page
    }, {
      useSelectedGenre: !!selectedGenre,
      selectedGenre: selectedGenre || "all"
    });

    let candidates = [];
    for (const level of queryConfig.levels || []) {
      const urls = Array.isArray(level?.urls) ? level.urls : [];
      if (!urls.length) continue;

      const found = normalizeList(
        await withTimeout(
          tmdbFetchDiscoverLevel(urls, queryConfig.type, excludedKeys),
          CONFIG.REQUEST_TIMEOUT_MS
        )
      );

      if (found.length) {
        candidates = found;
        break;
      }
    }

    if (!candidates.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun classico trovato. Riprova più tardi.</p>`;
      return;
    }

    const scored = candidates
      .map(item => ({
        item,
        score: scoreCandidate(item, profile, queryConfig.selectedBoosts || []) + 2 + Math.random()
      }))
      .sort((a, b) => b.score - a.score);

    const chosen = scored[0]?.item;
    if (!chosen) {
      el.innerHTML = `<p class="tonight__hint">Nessun classico trovato.</p>`;
      return;
    }

    registerSuggested([chosen]);

    const whyBits = [];
    if ((chosen.genre_names || []).some(g => profile.topGenres.includes(g))) {
      whyBits.push(`incrocia i tuoi generi forti`);
    }
    if (profile.topDecade && decadeScoreLabel(chosen.year) === profile.topDecade) {
      whyBits.push(`è nel tuo decennio preferito`);
    }
    if (!whyBits.length) whyBits.push("è un classico coerente con il tuo profilo");

    el.innerHTML = renderClassicResult({
      item: chosen,
      why: whyBits.join(" · ")
    });

    haptic([10]);
  } catch (error) {
    debug.error("suggestClassic error", error);
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca del classico.", "error", "Classico");
  }
}

function safeBuildFallbackQueries(profile, options = null, flags = {}) {
  try {
    return buildFallbackQueries(profile, options, flags);
  } catch (error) {
    debug.warn("buildFallbackQueries failed", error);
    return {
      type: profile?.prefType || "movie",
      levels: [],
      selectedBoosts: []
    };
  }
}

function toggleElement(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function getVisibleScreenName() {
  const screen = Object.values(SCREENS || {}).find(selector => {
    const el = document.querySelector(selector);
    return el && !el.classList.contains("hidden");
  });

  if (!screen) return "";
  return Object.keys(SCREENS).find(key => SCREENS[key] === screen) || "";
}

function safeSwitchScreen(name) {
  try {
    switchScreen(name);
    state.currentView = name;
  } catch (error) {
    debug.warn("switchScreen failed", error);
  }
}

async function persistDB() {
  if (state.saving) return;

  state.saving = true;

  const safeDB = createSafeDB(state.db);

  saveDB(safeDB);

  setTimeout(async () => {
    try {
      await supabase
        ?.from("cine_db")
        ?.upsert({
          id: "default",
          payload: safeDB,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      debug.warn("Supabase sync failed", error);
    } finally {
      state.saving = false;
    }
  }, 0);
}

function debounce(fn, wait = 250) {
  let timeout = null;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

async function withTimeout(promise, ms = 15000) {
  let timer = null;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function runSingleFlight(key, factory) {
  if (!key || typeof factory !== "function") {
    return typeof factory === "function" ? factory() : null;
  }

  if (state.pending.requests.has(key)) {
    return state.pending.requests.get(key);
  }

  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      state.pending.requests.delete(key);
    });

  state.pending.requests.set(key, promise);
  return promise;
}

function hideComingSoonButton() {
  document.querySelectorAll("[data-coming-soon]").forEach(el => {
    el.classList.add("hidden");
  });
}

function bindEvents() {
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const searchType = document.getElementById("searchType");

  searchInput?.addEventListener("input", () => {
    debouncedSearch();
  });

  searchClear?.addEventListener("click", () => {
    searchInput.value = "";
    state.pending.searchQuery = "";
    state.searchReqCounter++;
    doSearch();
  });

  searchType?.addEventListener("change", e => {
    state.filters.currentType = e.target.value || "multi";
    debouncedSearch();
  });

  document.getElementById("openWatchAll")?.addEventListener("click", () => openLibrary("watch", "all"));
  document.getElementById("openSeenMovies")?.addEventListener("click", () => openLibrary("seen", "movie"));
  document.getElementById("openSeenSeries")?.addEventListener("click", () => openLibrary("seen", "series"));

  document.querySelectorAll(".filter-pill[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filters.currentLibraryFilter = btn.dataset.filter || "all";
      doRenderLibrary();
    });
  });

  document.addEventListener("click", e => {
    const actionBtn = e.target.closest("[data-search-actions]");
    const actionCard = e.target.closest(".poster-card");

    if (actionBtn && actionCard) {
      e.preventDefault();
      e.stopPropagation();
      toggleSearchActionMenu(actionCard);
      return;
    }

    if (!e.target.closest(".poster-card__actions")) {
      closeAllSearchActionMenus();
    }

    const detailTrigger = e.target.closest("[data-open-detail]");
    if (detailTrigger) {
      const { type, id } = detailTrigger.dataset;
      doShowDetails(type, id);
      return;
    }

    const seenTrigger = e.target.closest("[data-add-seen]");
    if (seenTrigger) {
      const { type, id } = seenTrigger.dataset;
      doAddSeen(type, id);
      return;
    }

    const watchTrigger = e.target.closest("[data-add-watch]");
    if (watchTrigger) {
      const { type, id } = watchTrigger.dataset;
      doAddWatch(type, id);
      return;
    }

    const moveSeenTrigger = e.target.closest("[data-move-seen]");
    if (moveSeenTrigger) {
      doMoveToSeen(moveSeenTrigger.dataset.moveSeen);
      return;
    }

    const removeSeenTrigger = e.target.closest("[data-remove-seen]");
    if (removeSeenTrigger) {
      doRemoveSeen(removeSeenTrigger.dataset.removeSeen);
      return;
    }

    const removeWatchTrigger = e.target.closest("[data-remove-watch]");
    if (removeWatchTrigger) {
      doRemoveWatch(removeWatchTrigger.dataset.removeWatch);
      return;
    }

    const genreFilterTrigger = e.target.closest("[data-genre-filter]");
    if (genreFilterTrigger) {
      state.filters.currentLibraryGenre = genreFilterTrigger.dataset.genreFilter || "all";
      doRenderLibrary();
      return;
    }

    const backBtn = e.target.closest("[data-go-back]");
    if (backBtn) {
      const prev = getPreviousScreen?.() || "home";
      safeSwitchScreen(prev);
      return;
    }
  });

  document.getElementById("detailSeenBtn")?.addEventListener("click", () => {
    if (!state.currentDetail) return;
    doAddSeen(state.currentDetail.media_type, state.currentDetail.id);
  });

  document.getElementById("detailWatchBtn")?.addEventListener("click", () => {
    if (!state.currentDetail) return;
    doAddWatch(state.currentDetail.media_type, state.currentDetail.id);
  });

  document.getElementById("detailSaveBtn")?.addEventListener("click", () => {
    doSaveDetailNotes();
  });

  document.getElementById("detailRemoveBtn")?.addEventListener("click", () => {
    doRemoveCurrentDetail();
  });

  document.getElementById("tonightBtn")?.addEventListener("click", () => {
    recommendTonightFive(false);
  });

  document.getElementById("discoverBtn")?.addEventListener("click", () => {
    discoverByTaste();
  });

  document.getElementById("classicBtn")?.addEventListener("click", () => {
    suggestClassic();
  });

  document.getElementById("genreSelect")?.addEventListener("change", () => {
    discoverByTaste();
  });

  maybeAutoRecommend().catch(error => {
    debug.warn("maybeAutoRecommend failed", error);
  });
}