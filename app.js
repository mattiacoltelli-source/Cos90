import { supabase } from "./supabase.js";
import {
  uniqueKey, normalizedItem, sanitizeVoteInput, parseUserVote,
  decadeOf, posterUrl, buildDateRange, randomPage,
  escapeHtml, mediaLabel, rawNumberToFixed
} from "./cine-core.js";
import { loadDB, saveDB, loadSuggestHistory, saveSuggestHistory } from "./storage.js";
import {
  showToast, haptic, animateStats, animateBarGroups,
  initScreens, switchScreen, getPreviousScreen, SCREENS,
  renderShelf, renderSearchResults, renderLibraryList,
  renderGenreFilters, renderGenreBars, renderPodium, renderRankingList,
  renderTonightFive, renderDiscoverResult, renderClassicResult, renderDetailFacts
} from "./ui.js";
import {
  tmdbSearch, tmdbFetchDetail, tmdbFetchDiscoverLevel, buildFallbackQueries
} from "./tmdb.js";

const TONIGHT_COOLDOWN_MS = 20000;

let db = { seen: [], watchlist: [] };
let suggestHistory = loadSuggestHistory();

let currentType = "multi";
let currentDetail = null;
let currentLibraryMode = "watch";
let currentLibraryFilter = "all";
let currentLibraryGenre = "all";
let lastAutoRecommendAt = 0;
let tonightReqCounter = 0;

// ─── FIX 1: BANNER OFFLINE ───────────────────────────────────────────────────
// Mostra un banner in fondo allo schermo quando l'utente è offline,
// e lo nasconde automaticamente quando la connessione torna.

let _offlineBanner = null;

function showOfflineBanner() {
  if (_offlineBanner) return;
  _offlineBanner = document.createElement("div");
  _offlineBanner.id = "offlineBanner";
  _offlineBanner.textContent = "⚠️ Sei offline — i dati potrebbero non essere aggiornati";
  Object.assign(_offlineBanner.style, {
    position: "fixed",
    bottom: "0",
    left: "0",
    right: "0",
    padding: "10px 16px",
    background: "var(--red, #ff5f5f)",
    color: "#fff",
    fontSize: "13px",
    fontFamily: "var(--font-body, sans-serif)",
    textAlign: "center",
    zIndex: "9999",
    transition: "opacity 0.3s ease",
  });
  document.body.appendChild(_offlineBanner);
}

function hideOfflineBanner() {
  if (!_offlineBanner) return;
  _offlineBanner.remove();
  _offlineBanner = null;
  showToast("Connessione ripristinata", "success");
}

function initNetworkWatcher() {
  if (!navigator.onLine) showOfflineBanner();
  window.addEventListener("offline", () => showOfflineBanner());
  window.addEventListener("online",  () => hideOfflineBanner());
}

// ─────────────────────────────────────────────────────────────────────────────

function backdropUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : "";
}

function inSeen(item) {
  return db.seen.find(x => uniqueKey(x) === uniqueKey(item));
}

function inWatch(item) {
  return db.watchlist.find(x => uniqueKey(x) === uniqueKey(item));
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
  return decadeOf(year);
}

function getUserTasteProfile() {
  const genreCount = {};
  const genreVotes = {};
  const decadeCount = {};
  let movieCount = 0;
  let seriesCount = 0;

  db.seen.forEach(item => {
    if (item.media_type === "movie") movieCount++;
    else seriesCount++;

    const decade = decadeScoreLabel(item.year);
    decadeCount[decade] = (decadeCount[decade] || 0) + 1;

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
    .slice(0, 5)
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

  const overallVotes = db.seen
    .map(x => parseUserVote(x.vote))
    .filter(v => Number.isFinite(v));

  const avgVote = overallVotes.length
    ? overallVotes.reduce((a, b) => a + b, 0) / overallVotes.length
    : 7;

  return { topGenres, topDecade, prefType, genreAverages, avgVote };
}

function getHistoryPenalty(key) {
  const now = Date.now();
  let penalty = 0;

  suggestHistory.forEach(entry => {
    if (entry.key !== key) return;
    const hoursAgo = (now - entry.at) / (1000 * 60 * 60);

    if (hoursAgo < 6) penalty += 15;
    else if (hoursAgo < 24) penalty += 10;
    else if (hoursAgo < 72) penalty += 5;
    else if (hoursAgo < 168) penalty += 2.5;
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
  score -= getHistoryPenalty(uniqueKey(item));

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

    const key = uniqueKey(entry.item);
    if (usedKeys.has(key)) continue;

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
      const key = uniqueKey(entry.item);
      if (usedKeys.has(key)) continue;
      selected.push(entry);
      usedKeys.add(key);
    }
  }

  return selected.slice(0, count);
}

function registerSuggested(items) {
  const now = Date.now();
  suggestHistory = [
    ...items.map(item => ({ key: uniqueKey(item), at: now })),
    ...suggestHistory
  ].slice(0, 80);

  saveSuggestHistory(suggestHistory);
}

function toggleHidden(id, shouldHide) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", shouldHide);
}

function renderHomeShelves() {
  const watchPrev = db.watchlist.slice(0, 8);
  const seenMovies = db.seen.filter(x => x.media_type === "movie").slice(0, 8);
  const seenSeries = db.seen.filter(x => x.media_type === "tv").slice(0, 8);

  toggleHidden("watchShelfEmpty", watchPrev.length > 0);
  toggleHidden("seenMovieShelfEmpty", seenMovies.length > 0);
  toggleHidden("seenSeriesShelfEmpty", seenSeries.length > 0);

  toggleHidden("openWatchAll", db.watchlist.length === 0);
  toggleHidden("openSeenMovies", db.seen.filter(x => x.media_type === "movie").length === 0);
  toggleHidden("openSeenSeries", db.seen.filter(x => x.media_type === "tv").length === 0);

  renderShelf("watchShelf", watchPrev);
  renderShelf("seenMovieShelf", seenMovies);
  renderShelf("seenSeriesShelf", seenSeries);
}

function getAvailableGenres() {
  const source = currentLibraryMode === "watch" ? db.watchlist : db.seen;

  let filtered = source;
  if (currentLibraryFilter === "movie") filtered = source.filter(x => x.media_type === "movie");
  if (currentLibraryFilter === "series") filtered = source.filter(x => x.media_type === "tv");

  const set = new Set();
  filtered.forEach(item => {
    (item.genre_names || []).forEach(g => {
      if (g && g.trim()) set.add(g);
    });
  });

  return [...set].sort((a, b) => a.localeCompare(b, "it"));
}

function doRenderLibrary() {
  const source = currentLibraryMode === "watch" ? db.watchlist : db.seen;
  const genres = getAvailableGenres();

  if (currentLibraryGenre !== "all" && !genres.includes(currentLibraryGenre)) {
    currentLibraryGenre = "all";
  }

  renderGenreFilters(genres, currentLibraryGenre);

  let items = source;
  if (currentLibraryFilter === "movie") items = items.filter(x => x.media_type === "movie");
  if (currentLibraryFilter === "series") items = items.filter(x => x.media_type === "tv");
  if (currentLibraryGenre !== "all") items = items.filter(x => (x.genre_names || []).includes(currentLibraryGenre));

  let baseTitle = "Archivio visti";
  if (currentLibraryMode === "watch") baseTitle = "Watchlist";
  else if (currentLibraryFilter === "movie") baseTitle = "Film visti";
  else if (currentLibraryFilter === "series") baseTitle = "Serie TV viste";

  const libraryTitle = document.getElementById("libraryTitle");
  if (libraryTitle) {
    libraryTitle.textContent = currentLibraryGenre === "all"
      ? baseTitle
      : `${baseTitle} · ${currentLibraryGenre}`;
  }

  document.querySelectorAll(".filter-pill[data-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === currentLibraryFilter);
  });

  const listEl = document.getElementById("libraryList");
  const emptyEl = document.getElementById("libraryEmpty");
  if (!listEl || !emptyEl) return;

  if (!items.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = currentLibraryMode === "watch"
      ? (currentLibraryGenre === "all"
        ? "La tua watchlist è vuota."
        : `Nessun titolo in watchlist per "${currentLibraryGenre}".`)
      : (currentLibraryGenre === "all"
        ? "Nessun titolo per questo filtro."
        : `Nessun titolo visto per "${currentLibraryGenre}".`);
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.innerHTML = renderLibraryList(items, currentLibraryMode);
}

function openLibrary(mode, filter = "all") {
  currentLibraryMode = mode;
  currentLibraryFilter = filter;
  currentLibraryGenre = "all";
  doRenderLibrary();
  switchScreen("library");
}

function getRanked(type) {
  return db.seen
    .filter(x => x.media_type === type && Number.isFinite(parseUserVote(x.vote)))
    .sort((a, b) => {
      const voteDiff = parseUserVote(b.vote) - parseUserVote(a.vote);
      if (voteDiff !== 0) return voteDiff;

      const yearDiff = Number(b.year || 0) - Number(a.year || 0);
      if (yearDiff !== 0) return yearDiff;

      return (a.title || "").localeCompare(b.title || "", "it");
    })
    .slice(0, 250);
}

function resetRanking() {
  const empty = `<p class="empty-hint">Aggiungi voti per vedere la classifica.</p>`;

  const ids = ["top100Podium", "top100List", "top100SeriesPodium", "top100SeriesList"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = empty;
  });

  const badges = ["top100CountBadge", "top100SeriesCountBadge"];
  badges.forEach(id => {
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

function renderStats() {
  const seen = db.seen.length;
  const watch = db.watchlist.length;
  const movies = db.seen.filter(x => x.media_type === "movie").length;
  const series = db.seen.filter(x => x.media_type === "tv").length;

  animateStats(seen, watch, movies, series);

  if (db.seen.length < 3) {
    renderGenreBars([]);
    resetRanking();
    return;
  }

  const genreCount = {};
  db.seen.forEach(item => {
    (item.genre_names || []).forEach(g => {
      genreCount[g] = (genreCount[g] || 0) + 1;
    });
  });

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  renderGenreBars(topGenres);
  renderRanking();
}

function renderAll() {
  renderHomeShelves();
  doRenderLibrary();
  renderStats();
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

  if (!q) {
    sec.classList.add("hidden");
    res.innerHTML = "";
    count.textContent = "";
    empty.textContent = "Nessun risultato trovato.";
    closeAllSearchActionMenus();
    return;
  }

  // FIX 1: controlla connessione prima di cercare
  if (!navigator.onLine) {
    showToast("Sei offline. Controlla la connessione.", "error", "Ricerca");
    return;
  }

  sec.classList.remove("hidden");
  res.innerHTML = "";
  count.textContent = "";
  empty.textContent = "Ricerca in corso…";
  empty.classList.remove("hidden");
  closeAllSearchActionMenus();

  try {
    const items = await tmdbSearch(q, currentType);

    if (!items.length) {
      empty.textContent = "Nessun risultato trovato.";
      empty.classList.remove("hidden");
      showToast("Nessun risultato trovato.", "info", "Ricerca");
      return;
    }

    empty.classList.add("hidden");
    count.textContent = `${items.length} risultati`;
    res.innerHTML = renderSearchResults(items, db);
  } catch (e) {
    console.error(e);
    empty.textContent = "Errore di ricerca. Controlla la connessione.";
    empty.classList.remove("hidden");
    showToast("Errore di ricerca.", "error", "Ricerca");
  }
}

function openDetail(item) {
  try {
    if (!item) return;

    closeAllSearchActionMenus();

    const safeItem = normalizedItem(item);
    currentDetail = safeItem;

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

    if (detailBackdrop) detailBackdrop.style.backgroundImage = backdrop ? `url('${backdrop}')` : "";
    if (detailPoster) detailPoster.style.backgroundImage = poster ? `url('${poster}')` : "";

    if (detailTitle) detailTitle.textContent = src.title || "Titolo";
    if (detailYear) detailYear.textContent = src.year || "—";
    if (detailType) detailType.textContent = mediaLabel(src);
    if (detailOverview) detailOverview.textContent = src.overview || "Nessuna trama disponibile.";

    if (detailFacts) {
      try {
        detailFacts.innerHTML = renderDetailFacts(src, inSeen, inWatch);
      } catch (err) {
        console.error("Errore facts detail:", err);
        detailFacts.innerHTML = `
          <span class="detail-fact">${escapeHtml(mediaLabel(src))}</span>
          <span class="detail-fact">${escapeHtml(src.year || "—")}</span>
        `;
      }
    }

    if (detailGenres) {
      detailGenres.innerHTML = (src.genre_names || []).slice(0, 4)
        .map(g => `<span class="chip">${escapeHtml(g)}</span>`)
        .join("");
    }

    if (detailVoteInput) detailVoteInput.value = src.vote || "";
    if (detailCommentInput) detailCommentInput.value = src.comment || "";

    if (detailSeenBtn) detailSeenBtn.textContent = inSeen(src) ? "✓ Già tra i visti" : "Segna come visto";
    if (detailWatchBtn) detailWatchBtn.textContent = inWatch(src) ? "★ Già in watchlist" : "Aggiungi a watchlist";

    switchScreen("detail");
  } catch (e) {
    console.error("Errore openDetail:", e);
    showToast("Errore apertura scheda.", "error", "Errore");
  }
}

async function doShowDetails(type, id) {
  closeAllSearchActionMenus();
  const item = await tmdbFetchDetail(type, id);
  openDetail(item);
}

async function doAddSeen(type, id) {
  closeAllSearchActionMenus();

  const item = await tmdbFetchDetail(type, id);

  if (inSeen(item)) {
    openDetail(item);
    return;
  }

  db.seen.unshift(item);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(item));

  await saveDB(db);
  renderAll();
  openDetail(item);

  showToast(`"${item.title}" aggiunto ai visti.`, "success", "Salvato");
  haptic([12, 20, 12]);
}

async function doAddWatch(type, id) {
  closeAllSearchActionMenus();

  const item = await tmdbFetchDetail(type, id);

  if (!inSeen(item) && !inWatch(item)) {
    db.watchlist.unshift(item);
    await saveDB(db);
    renderAll();
    showToast(`"${item.title}" aggiunto alla watchlist.`, "success", "Watchlist");
    haptic([10]);
  }

  openDetail(item);
}

async function doMoveToSeen(key) {
  const item = db.watchlist.find(x => uniqueKey(x) === key);
  if (!item) return;

  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  if (!db.seen.find(x => uniqueKey(x) === key)) {
    item.savedAt = new Date().toISOString();
    db.seen.unshift(item);
  }

  await saveDB(db);
  renderAll();

  showToast(`"${item.title}" spostato tra i visti.`, "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveSeen(key) {
  const item = db.seen.find(x => uniqueKey(x) === key);
  db.seen = db.seen.filter(x => uniqueKey(x) !== key);

  await saveDB(db);
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    switchScreen("home");
  }

  if (item) {
    showToast(`"${item.title}" rimosso dai visti.`, "info", "Rimosso");
    haptic([14]);
  }
}

async function doRemoveWatch(key) {
  const item = db.watchlist.find(x => uniqueKey(x) === key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  await saveDB(db);
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    switchScreen("home");
  }

  if (item) {
    showToast(`"${item.title}" rimosso dalla watchlist.`, "info", "Rimosso");
    haptic([14]);
  }
}

async function doSaveDetailNotes() {
  if (!currentDetail) return;

  const voteInput = document.getElementById("detailVoteInput");
  const commentInput = document.getElementById("detailCommentInput");
  if (!voteInput || !commentInput) return;

  const check = validateVote(voteInput.value);
  if (!check.ok) return;

  const key = uniqueKey(currentDetail);
  const vote = check.value;
  const comment = commentInput.value.trim();

  let target = db.seen.find(x => uniqueKey(x) === key) || db.watchlist.find(x => uniqueKey(x) === key);

  if (!target) {
    target = { ...currentDetail };
    db.watchlist.unshift(target);
  }

  target.vote = vote;
  target.comment = comment;

  await saveDB(db);
  renderAll();
  openDetail(target);

  showToast("Voto e commento salvati.", "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveCurrentDetail() {
  if (!currentDetail) return;

  const key = uniqueKey(currentDetail);
  const title = currentDetail.title;

  db.seen = db.seen.filter(x => uniqueKey(x) !== key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  await saveDB(db);
  renderAll();
  switchScreen("home");

  showToast(`"${title}" rimosso dalla libreria.`, "info", "Rimosso");
  haptic([14]);
}

function getSelectedGenre() {
  const el = document.getElementById("genreSelect");
  return el ? el.value : "all";
}

async function recommendTonightFive(isAuto = false) {
  const el = document.getElementById("tonightSuggestion");
  if (!el) return;

  const reqId = ++tonightReqCounter;

  if (db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    if (!isAuto) showToast("Aggiungi almeno 3 titoli visti.", "info", "Consigli");
    return;
  }

  // FIX 1: controlla connessione prima di fare fetch
  if (!navigator.onLine) {
    el.innerHTML = `<p class="tonight__hint">Sei offline. Connettiti per ricevere consigli.</p>`;
    if (!isAuto) showToast("Sei offline. Controlla la connessione.", "error", "Consigli");
    return;
  }

  el.innerHTML = `<p class="tonight__hint">🔍 Sto cercando 5 titoli adatti…</p>`;

  const profile = getUserTasteProfile();
  const { type, levels } = buildFallbackQueries(profile, null, { useSelectedGenre: false, selectedGenre: "all" });
  const excludedKeys = new Set([...db.seen, ...db.watchlist].map(uniqueKey));

  try {
    let candidates = [];
    let levelLabel = "";

    for (const level of levels) {
      const found = await tmdbFetchDiscoverLevel(level.urls, type, excludedKeys);
      candidates = [...candidates, ...found];

      const dedup = new Map();
      candidates.forEach(item => dedup.set(uniqueKey(item), item));
      candidates = [...dedup.values()];

      if (candidates.length >= 5) {
        levelLabel = level.label;
        break;
      }
    }

    if (reqId !== tonightReqCounter) return;

    if (!candidates.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun consiglio trovato. Riprova più tardi.</p>`;
      return;
    }

    const ranked = candidates.map(item => {
      const affinity = calculateAffinity(item, profile);
      const rankScore = scoreCandidate(item, profile) + affinity / 20 + Math.random() * 2.5;
      return { item, affinity, rankScore };
    }).sort((a, b) => b.rankScore - a.rankScore).slice(0, 18);

    const finalFive = pickDiverse(ranked, 5).sort((a, b) => b.affinity - a.affinity);

    if (!finalFive.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun consiglio trovato.</p>`;
      return;
    }

    registerSuggested(finalFive.map(x => x.item));

    // ── DEBUG: stato interno visibile nella mini console ──────────────────
    try {
      const topG = profile.topGenres.join(" · ") || "—";
      const decade = profile.topDecade || "—";
      const prefType = profile.prefType === "movie" ? "Film" : profile.prefType === "tv" ? "Serie TV" : "Misto";

      console.log("── ⭐ 5 CONSIGLI PER TE ─────────────────");
      console.log(`📚 Visti: ${db.seen.length} · Watchlist: ${db.watchlist.length}`);
      console.log(`🎭 Top 5: ${topG}`);
      console.log(`📅 Decade: ${decade} · Preferenza: ${prefType}`);
      console.log(`🔍 Candidati: ${candidates.length} · selezionati: ${finalFive.length}`);
      console.log("─────────────────────────────────────────");

      finalFive.forEach((entry, i) => {
        const item = entry.item;
        const aff = Math.round(entry.affinity);
        const tmdbVote = Number(item.vote_average) || 0;
        const year = item.year || "?";
        const title = item.title || item.name || "?";

        // Ricalcola breakdown esatto uguale a calculateAffinity
        const genres = item.genre_names || [];
        let genreBase = 0;
        let matched = 0;
        const matchedDetails = [];

        genres.forEach(g => {
          if (profile.genreAverages[g]) {
            genreBase += profile.genreAverages[g];
            matched++;
            matchedDetails.push(`${g}(${profile.genreAverages[g].toFixed(1)})`);
          } else if (profile.topGenres.includes(g)) {
            genreBase += 7.5;
            matched++;
            matchedDetails.push(`${g}(7.5)`);
          }
        });

        if (!matched) {
          genreBase = Math.max(6.4, profile.avgVote);
          matched = 1;
          matchedDetails.push(`nessun match → base ${genreBase.toFixed(1)}`);
        }

        const base = genreBase / matched;
        const decadeMatch = profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade;
        const tipoMatch = item.media_type === profile.prefType;
        const tmdbBonus = tmdbVote > 0 ? Math.min(0.45, (tmdbVote - 6) * 0.1) : 0;
        const score10 = Math.max(6.2, Math.min(9.6, base + (decadeMatch ? 0.35 : 0) + (tipoMatch ? 0.25 : 0) + tmdbBonus));

        const genreStr = matchedDetails.length ? matchedDetails.join(" ") : "nessun genere matched";
        const decadeStr = decadeMatch ? "+0.35" : "✗";
        const tipoStr = tipoMatch ? "+0.25" : "✗";
        const tmdbStr = `tmdb(${tmdbVote.toFixed(1)}) +${tmdbBonus.toFixed(2)}`;

        console.log(`🎯 ${i + 1}. ${title} (${year}) · ${aff}%`);
        console.log(`   generi: ${genreStr} → base ${base.toFixed(2)}`);
        console.log(`   decade ${decadeStr} · tipo ${tipoStr} · ${tmdbStr}`);
        console.log(`   totale: ${score10.toFixed(2)}/10 → ${aff}%`);
      });

      console.log("─────────────────────────────────────────");
    } catch (e) { /* debug non blocca mai l'app */ }
    // ── FINE DEBUG ────────────────────────────────────────────────────────

    const enriched = finalFive.map(entry => ({
      item: entry.item,
      affinity: entry.affinity,
      reasons: buildReason(entry.item, profile, entry.affinity)
    }));

    const note = (levelLabel && levelLabel !== "ricerca precisa")
      ? "Ho allargato un po' la ricerca per trovare 5 proposte."
      : "";

    el.innerHTML = renderTonightFive(enriched, null, note);

    if (!isAuto) haptic([10]);
    if (isAuto) lastAutoRecommendAt = Date.now();
  } catch (e) {
    console.error(e);
    if (reqId !== tonightReqCounter) return;
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca dei consigli.", "error", "Consigli");
  }
}

async function maybeAutoRecommend() {
  if (Date.now() - lastAutoRecommendAt < TONIGHT_COOLDOWN_MS) return;
  await recommendTonightFive(true);
}

async function discoverByTaste() {
  const el = document.getElementById("tonightSuggestion");
  if (!el) return;

  if (db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    showToast("Aggiungi almeno 3 titoli visti.", "info", "Scopri");
    return;
  }

  // FIX 1: controlla connessione prima di fare fetch
  if (!navigator.onLine) {
    el.innerHTML = `<p class="tonight__hint">Sei offline. Connettiti per scoprire nuovi titoli.</p>`;
    showToast("Sei offline. Controlla la connessione.", "error", "Scopri");
    return;
  }

  el.innerHTML = `<p class="tonight__hint">🔍 Sto cercando qualcosa di nuovo…</p>`;

  const profile = getUserTasteProfile();
  const selectedGenre = getSelectedGenre();
  const { type, levels, selectedBoosts } = buildFallbackQueries(profile, null, {
    useSelectedGenre: selectedGenre !== "all",
    selectedGenre
  });

  const excludedKeys = new Set([...db.seen, ...db.watchlist].map(uniqueKey));

  try {
    let candidates = [];
    let levelLabel = "";

    for (const level of levels) {
      const found = await tmdbFetchDiscoverLevel(level.urls, type, excludedKeys);
      if (found.length > 0) {
        candidates = found;
        levelLabel = level.label;
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
        score: scoreCandidate(item, profile, selectedBoosts) + Math.random() * 2.5
      }))
      .sort((a, b) => b.score - a.score);

    const topPool = scored.slice(0, Math.min(12, scored.length));
    const chosen = topPool[Math.floor(Math.random() * topPool.length)].item;

    registerSuggested([chosen]);

    // ── DEBUG: stato interno visibile nella mini console ──────────────────
    try {
      const chosenEntry = topPool.find(e => e.item === chosen);
      const baseScore = chosenEntry ? chosenEntry.score : 0;
      const randomComponent = Math.min(2.5, baseScore - scoreCandidate(chosen, profile, selectedBoosts));
      const pureScore = baseScore - randomComponent;
      const tmdbVote = Number(chosen.vote_average) || 0;
      const tmdbBonus = tmdbVote > 0 ? Math.min(0.45, (tmdbVote - 6) * 0.1) : 0;
      const decadeMatch = profile.topDecade && decadeScoreLabel(chosen.year) === profile.topDecade;
      const tipoMatch = chosen.media_type === profile.prefType;
      const matchG = (chosen.genre_names || []).filter(g => profile.topGenres.includes(g));
      const genreLabel = selectedGenre !== "all" ? selectedGenre : "Qualsiasi";

      console.log("── ✨ SCOPRI QUALCOSA DI NUOVO ──────────");
      console.log(`🎭 Genere selezionato: ${genreLabel}`);
      console.log(`🔍 Candidati trovati: ${candidates.length} · top pool: ${topPool.length}`);
      console.log(`🎯 Scelto: ${chosen.title || chosen.name} (${chosen.year || "?"})`);
      console.log(`   score puro: ${pureScore.toFixed(1)} · random: +${randomComponent.toFixed(1)}`);
      console.log(`   generi film: ${(chosen.genre_names || []).join(" · ") || "—"}`);
      console.log(`   match tuoi generi: ${matchG.length ? matchG.join(" ✓ ") + " ✓" : "nessuno"}`);
      console.log(`   decade ${decadeMatch ? "✓ +0.35" : "✗"} · tipo ${tipoMatch ? "✓ +0.25" : "✗"} · tmdb(${tmdbVote.toFixed(1)}) ${tmdbBonus >= 0 ? "+" : ""}${tmdbBonus.toFixed(2)}`);
      console.log("────────────────────────────────────────");
    } catch (e) { /* debug non blocca mai l'app */ }
    // ── FINE DEBUG ────────────────────────────────────────────────────────

    const genres = chosen.genre_names || [];
    const matchGenres = genres.filter(g => profile.topGenres.includes(g));
    const rating = rawNumberToFixed(chosen.vote_average || 0, 1, "n.d.");

    const whyBits = [];
    if (selectedGenre !== "all" && genres.includes(selectedGenre)) whyBits.push(`hai scelto il genere ${selectedGenre}`);
    if (matchGenres.length) whyBits.push(`ami il genere ${matchGenres[0]}`);
    if (profile.topDecade && decadeScoreLabel(chosen.year) === profile.topDecade) whyBits.push(`ti piacciono gli ${profile.topDecade}`);
    if (!whyBits.length) whyBits.push("ha un buon match con i tuoi gusti");

    const fallbackNote = levelLabel !== "ricerca precisa" ? "Ho allargato la ricerca." : "";

    el.innerHTML = renderDiscoverResult(chosen, whyBits, rating, fallbackNote);
    haptic([10]);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca.", "error", "Scopri");
  }
}

function suggestClassic() {
  const el = document.getElementById("tonightSuggestion");
  if (!el) return;

  const pool = db.seen.filter(x => Number.isFinite(parseUserVote(x.vote)) && parseUserVote(x.vote) >= 7);

  if (!pool.length) {
    el.innerHTML = `<p class="tonight__hint">Nessun titolo con voto ≥ 7. Inizia a votare i tuoi preferiti.</p>`;
    showToast("Serve almeno un titolo con voto ≥ 7.", "info", "Classico");
    return;
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  const vote = pick.vote || "";

  const numericVote = parseUserVote(pick.vote);
  const comment = numericVote >= 9
    ? "Uno dei tuoi assoluti — sempre un buon motivo per rivederlo."
    : numericVote >= 8
    ? "L'hai amato. Certi titoli vanno rivisti."
    : "Un bel titolo che hai apprezzato — vale una seconda visione.";

  el.innerHTML = renderClassicResult(pick, vote, comment);
  haptic([10]);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cineTracker-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);

  showToast("Backup esportato.", "success", "Backup");
  haptic([12, 20, 12]);
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);

      if (!imported || !Array.isArray(imported.seen) || !Array.isArray(imported.watchlist)) {
        showToast("File backup non valido.", "error", "Backup");
        return;
      }

      if (!confirm("Sostituire i dati attuali con quelli del backup?")) return;

      db = {
        seen: imported.seen.map(normalizedItem),
        watchlist: imported.watchlist.map(normalizedItem)
      };

      await saveDB(db);
      renderAll();
      switchScreen("home");

      showToast("Backup importato.", "success", "Backup");
      haptic([12, 20, 12]);
    } catch (e) {
      console.error(e);
      showToast("File backup non leggibile.", "error", "Backup");
    }
  };

  reader.readAsText(file);
}

function hideComingSoonButton() {
  const buttons = [...document.querySelectorAll("#screen-tonight button")];
  const target = buttons.find(btn => btn.textContent.trim().toLowerCase().includes("prossimamente"));
  if (target) target.remove();
}

function bindEvents() {
  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  const libraryBackBtn = document.getElementById("libraryBackBtn");
  const openWatchAll = document.getElementById("openWatchAll");
  const openSeenMovies = document.getElementById("openSeenMovies");
  const openSeenSeries = document.getElementById("openSeenSeries");
  const recommendBtn = document.getElementById("recommendBtn");
  const discoverBtn = document.getElementById("discoverBtn");
  const classicBtn = document.getElementById("classicBtn");
  const rankingToggleMovies = document.getElementById("rankingToggleMovies");
  const rankingToggleSeries = document.getElementById("rankingToggleSeries");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFileInput");
  const detailBackBtn = document.getElementById("detailBackBtn");
  const detailSeenBtn = document.getElementById("detailSeenBtn");
  const detailWatchBtn = document.getElementById("detailWatchBtn");
  const detailSaveNoteBtn = document.getElementById("detailSaveNoteBtn");
  const detailRemoveBtn = document.getElementById("detailRemoveBtn");
  const libraryFilters = document.getElementById("libraryFilters");

  document.querySelectorAll(".nav__btn[data-screen]").forEach(btn => {
    btn.addEventListener("click", () => {
      haptic([8]);
      const screen = btn.dataset.screen;
      switchScreen(screen);

      if (screen === "tonight") maybeAutoRecommend();
      if (screen === "stats") setTimeout(animateBarGroups, 80);
    });
  });

  if (searchBtn) searchBtn.addEventListener("click", () => { haptic([8]); doSearch(); });
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
  }

  document.querySelectorAll(".tab[data-type]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab[data-type]").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentType = tab.dataset.type;
      closeAllSearchActionMenus();
      haptic([8]);
    });
  });

  if (libraryFilters) {
    libraryFilters.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-pill[data-filter]");
      if (!btn) return;
      haptic([8]);
      currentLibraryFilter = btn.dataset.filter;
      currentLibraryGenre = "all";
      doRenderLibrary();
    });
  }

  if (libraryBackBtn) libraryBackBtn.addEventListener("click", () => switchScreen("home"));
  if (openWatchAll) openWatchAll.addEventListener("click", () => { haptic([8]); openLibrary("watch", "all"); });
  if (openSeenMovies) openSeenMovies.addEventListener("click", () => { haptic([8]); openLibrary("seen", "movie"); });
  if (openSeenSeries) openSeenSeries.addEventListener("click", () => { haptic([8]); openLibrary("seen", "series"); });

  if (recommendBtn) recommendBtn.addEventListener("click", () => { haptic([8]); recommendTonightFive(false); });
  if (discoverBtn) discoverBtn.addEventListener("click", () => { haptic([8]); discoverByTaste(); });
  if (classicBtn) classicBtn.addEventListener("click", () => { haptic([8]); suggestClassic(); });

  if (rankingToggleMovies && rankingToggleSeries) {
    rankingToggleMovies.addEventListener("click", () => {
      haptic([8]);
      rankingToggleMovies.classList.add("active");
      rankingToggleSeries.classList.remove("active");
      toggleHidden("rankingPanelMovies", false);
      toggleHidden("rankingPanelSeries", true);
    });

    rankingToggleSeries.addEventListener("click", () => {
      haptic([8]);
      rankingToggleSeries.classList.add("active");
      rankingToggleMovies.classList.remove("active");
      toggleHidden("rankingPanelSeries", false);
      toggleHidden("rankingPanelMovies", true);
    });
  }

  if (exportBtn) exportBtn.addEventListener("click", () => { haptic([8]); exportBackup(); });
  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importBackup(file);
      e.target.value = "";
    });
  }

  if (detailBackBtn) {
    detailBackBtn.addEventListener("click", () => {
      switchScreen(getPreviousScreen() || "home");
    });
  }

  if (detailSeenBtn) {
    detailSeenBtn.addEventListener("click", async () => {
      if (!currentDetail) return;

      const voteInput = document.getElementById("detailVoteInput");
      const commentInput = document.getElementById("detailCommentInput");
      if (!voteInput || !commentInput) return;

      const check = validateVote(voteInput.value);
      if (!check.ok) return;

      if (!inSeen(currentDetail)) {
        db.seen.unshift({
          ...currentDetail,
          vote: check.value,
          comment: commentInput.value.trim()
        });
        db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(currentDetail));
        await saveDB(db);
        renderAll();
        showToast(`"${currentDetail.title}" aggiunto ai visti.`, "success", "Salvato");
        haptic([12, 20, 12]);
      } else {
        await doSaveDetailNotes();
      }

      openDetail(currentDetail);
    });
  }

  if (detailWatchBtn) {
    detailWatchBtn.addEventListener("click", async () => {
      if (!currentDetail) return;

      const voteInput = document.getElementById("detailVoteInput");
      const commentInput = document.getElementById("detailCommentInput");
      if (!voteInput || !commentInput) return;

      const check = validateVote(voteInput.value);
      if (!check.ok) return;

      if (!inSeen(currentDetail) && !inWatch(currentDetail)) {
        db.watchlist.unshift({
          ...currentDetail,
          vote: check.value,
          comment: commentInput.value.trim()
        });
        await saveDB(db);
        renderAll();
        showToast(`"${currentDetail.title}" in watchlist.`, "success", "Watchlist");
        haptic([10]);
      } else if (inWatch(currentDetail)) {
        await doSaveDetailNotes();
        return;
      }

      openDetail(currentDetail);
    });
  }

  if (detailSaveNoteBtn) detailSaveNoteBtn.addEventListener("click", doSaveDetailNotes);

  if (detailRemoveBtn) {
    detailRemoveBtn.addEventListener("click", () => {
      if (!currentDetail) return;
      if (confirm("Rimuovere questo titolo dalla libreria?")) {
        doRemoveCurrentDetail();
      }
    });
  }

  document.addEventListener("click", async (e) => {
    const seenBtn = e.target.closest(".action-seen");
    const watchBtn = e.target.closest(".action-watch");
    const detailsBtn = e.target.closest(".action-details");
    const removeSeenBtn = e.target.closest(".remove-seen");
    const removeWatchBtn = e.target.closest(".remove-watch");
    const moveWatchBtn = e.target.closest(".move-watch-seen");
    const storedBtn = e.target.closest(".open-stored-detail");
    const tonightBtn = e.target.closest(".open-tonight-detail");
    const genreBtn = e.target.closest("[data-genre-filter]");
    const posterImage = e.target.closest(".poster-card__img");
    const posterCard = e.target.closest(".poster-card");

    if (!posterCard && !e.target.closest(".results-grid")) {
      closeAllSearchActionMenus();
    }

    if (e.target.closest("button,.nav__btn,.tab,.filter-pill,.shelf-card,.tonight-card,.poster-card,.podium-card,.rank-row")) {
      haptic([8]);
    }

    try {
      if (genreBtn) {
        currentLibraryGenre = genreBtn.dataset.genreFilter;
        doRenderLibrary();
        return;
      }

      if (seenBtn) {
        await doAddSeen(seenBtn.dataset.type, seenBtn.dataset.id);
        return;
      }

      if (watchBtn) {
        await doAddWatch(watchBtn.dataset.type, watchBtn.dataset.id);
        return;
      }

      if (detailsBtn) {
        closeAllSearchActionMenus();
        await doShowDetails(detailsBtn.dataset.type, detailsBtn.dataset.id);
        return;
      }

      if (posterImage && posterCard && !seenBtn && !watchBtn) {
        toggleSearchActionMenu(posterCard);
        return;
      }

      if (removeSeenBtn) {
        await doRemoveSeen(removeSeenBtn.dataset.key);
        return;
      }

      if (removeWatchBtn) {
        await doRemoveWatch(removeWatchBtn.dataset.key);
        return;
      }

      if (moveWatchBtn) {
        await doMoveToSeen(moveWatchBtn.dataset.key);
        return;
      }

      if (storedBtn) {
        const key = storedBtn.dataset.key;
        const item = db.seen.find(x => uniqueKey(x) === key) || db.watchlist.find(x => uniqueKey(x) === key);
        if (item) openDetail(item);
        return;
      }

      if (tonightBtn) {
        await doShowDetails(tonightBtn.dataset.type, tonightBtn.dataset.id);
        return;
      }
    } catch (e) {
      console.error(e);
      showToast("Si è verificato un problema. Riprova.", "error", "Errore");
    }
  });

  window.addEventListener("popstate", (e) => {
    const name = e.state?.screen || "home";
    if (!SCREENS[name]) return;

    Object.values(SCREENS).forEach(screen => {
      screen.classList.add("hidden");
      screen.classList.remove("screen-enter");
    });

    SCREENS[name].classList.remove("hidden");
    requestAnimationFrame(() => SCREENS[name].classList.add("screen-enter"));

    document.querySelectorAll(".nav__btn[data-screen]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.screen === name);
    });

    if (name === "tonight") maybeAutoRecommend();
    if (name === "stats") setTimeout(animateBarGroups, 80);
  });
}

async function bootApp() {
  try {
    try {
      db = await loadDB();
    } catch (e) {
      console.warn("loadDB error", e);
      db = { seen: [], watchlist: [] };
    }

    if (!db || !db.seen || !db.watchlist) {
      db = { seen: [], watchlist: [] };
    }

    try { initNetworkWatcher(); } catch(e) { console.warn(e); }  // FIX 1
    try { initScreens(); } catch(e) { console.warn(e); }
    try { hideComingSoonButton(); } catch(e) { console.warn(e); }
    try { bindEvents(); } catch(e) { console.warn(e); }
    try { history.replaceState({ screen: "home" }, ""); } catch(e) {}
    try { renderAll(); } catch(e) { console.warn(e); }

  } catch (e) {
    console.error("BOOT ERROR:", e);
  } finally {
    const app = document.querySelector(".app");
    if (app) app.classList.add("app--ready");

    const splash = document.getElementById("splashScreen");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 300);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(bootApp, 80);
});

supabase
  .channel("realtime-cinetracker")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "Coltel" },
    async () => {
      try {
        const newDB = await loadDB();
        db = newDB;
        renderAll();
      } catch (e) {
        console.error("Errore realtime sync:", e);
      }
    }
  )
  .subscribe();