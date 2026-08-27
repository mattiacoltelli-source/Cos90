import { supabase } from "./supabase.js?v=1";
import {
  uniqueKey, normalizedItem, sanitizeVoteInput, parseUserVote,
  decadeOf, posterUrl, buildDateRange, randomPage,
  escapeHtml, mediaLabel, rawNumberToFixed, mergeRemoteIntoLocal,
  GENRE_NAME_TO_ID
} from "./cine-core.js?v=1";
import {
  loadDB, saveDB, queueRealtimeSync, hasReliableBaseline, loadSuggestHistory, saveSuggestHistory,
  loadLatestReport, regenerateReport
} from "./storage.js?v=1";
import {
  showToast, haptic, animateStats,
  initScreens, switchScreen, getPreviousScreen, SCREENS,
  renderShelf, renderSearchResults, renderLibraryList,
  renderGenreFilters, renderGenreBars, renderPodium, renderRankingList,
  renderTonightFive, renderDiscoverResult, renderClassicResult, renderDetailFacts,
  renderReportMeta, renderReportContent
} from "./ui.js?v=1";
import {
  tmdbSearch, tmdbFetchDetail, tmdbFetchDiscoverLevel, buildFallbackQueries
} from "./tmdb.js?v=1";

const API_KEY = "f8d5e378edf5128176f0d89f49310151";
const BASE_URL = "https://api.themoviedb.org/3";

let db = { seen: [], watchlist: [] };
let suggestHistory = loadSuggestHistory();

// ─── AGGIORNAMENTI (service worker leggero, solo notifica) ───────────────────

function initUpdateCheck() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./sw.js").then(reg => {
    reg.update(); // controlla subito se c'è una versione più recente

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner(newWorker);
        }
      });
    });
  }).catch(() => {});

  let alreadyReloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (alreadyReloading) return;
    alreadyReloading = true;
    window.location.reload();
  });
}

function showUpdateBanner(worker) {
  if (document.getElementById("updateBanner")) return;
  const bar = document.createElement("div");
  bar.id = "updateBanner";
  bar.innerHTML = `
    <span>🔄 Nuova versione disponibile</span>
    <button id="updateBtn">Aggiorna</button>
  `;
  document.body.appendChild(bar);
  document.getElementById("updateBtn").addEventListener("click", () => {
    worker.postMessage({ type: "SKIP_WAITING" });
    bar.remove();
  });
}

let currentType = "multi";
let currentDetail = null;
let currentLibraryMode = "watch";
let currentLibraryFilter = "all";
let currentLibraryGenre = "all";

// "Vedi tutto" (doRenderLibrary) carica i risultati a blocchi invece di
// disegnarli tutti in un colpo solo: con un archivio grande, renderizzare
// centinaia di card assieme (e far partire altrettante richieste per le
// locandine) è la prima cosa a rallentare l'app. Vedi renderNextLibraryPage/
// observeLibrarySentinel.
const LIBRARY_PAGE_SIZE = 40;
let libraryFilteredItems = [];
let libraryRenderedCount = 0;
let libraryLoadMoreObserver = null;
let tonightReqCounter = 0;

// ─── CONFERMA AZIONE PERICOLOSA (sostituisce confirm() nativo del browser,
// che appare come un banner bianco fuori dal tema dell'app) ──────────────────

let confirmYesAction = null;

function askConfirm(text, onYes) {
  document.getElementById("confirmText").textContent = text;
  confirmYesAction = onYes;
  document.getElementById("confirmOverlay").classList.remove("hidden");
}

function closeConfirm() {
  document.getElementById("confirmOverlay").classList.add("hidden");
  confirmYesAction = null;
}

// ─── BANNER OFFLINE ───────────────────────────────────────────────────────────

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

// FIX XSS: stessa validazione di posterUrl() in cine-core.js — path non nel
// formato atteso da TMDb viene scartato invece di finire in un attributo HTML.
const TMDB_BACKDROP_PATH_RE = /^\/[A-Za-z0-9]+\.(jpg|jpeg|png|webp)$/i;

function backdropUrl(path) {
  return TMDB_BACKDROP_PATH_RE.test(path || "") ? `https://image.tmdb.org/t/p/w1280${path}` : "";
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

function validateVote(rawVote) {
  const cleaned = sanitizeVoteInput(rawVote);

  if (!rawVote || !String(rawVote).trim()) {
    return { ok: true, value: "" };
  }

  if (!cleaned || !Number.isFinite(parseUserVote(cleaned))) {
    showToast("Voto non valido. Usa: 7, 7+, 7,5 oppure 8-.", "error", "Voto");
    return { ok: false, value: "" };
  }

  // sanitizeVoteInput accetta numeri fuori scala clampandoli silenziosamente
  // a 10 (es. "11" o "999" diventano "10"): avvisiamo l'utente, altrimenti
  // sembra che il suo input sia stato salvato esattamente com'era digitato.
  const rawTrimmed = String(rawVote).trim();
  const rawNumeric = Number(rawTrimmed.replace(",", "."));
  if (Number.isFinite(rawNumeric) && rawNumeric > 10 && cleaned === "10") {
    showToast(`Il voto massimo è 10: "${rawTrimmed}" è stato impostato a 10.`, "info", "Voto");
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

  // "Vedi tutto" resta sempre visibile, anche a lista vuota: è l'unico modo
  // per un utente nuovo di raggiungere la schermata Libreria (che gestisce
  // già bene lo stato vuoto da sola, vedi doRenderLibrary).

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

  // Azzerati SEMPRE (anche a lista vuota): la sentinella resta nel DOM tra
  // un'apertura e l'altra, e senza questo reset un observer ancora "armato"
  // potrebbe riattaccare in coda gli elementi del filtro precedente.
  listEl.innerHTML = "";
  libraryFilteredItems = items;
  libraryRenderedCount = 0;

  if (!items.length) {
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = currentLibraryMode === "watch"
      ? (currentLibraryGenre === "all"
        ? "La tua watchlist è vuota."
        : `Nessun titolo in watchlist per "${currentLibraryGenre}".`)
      : (currentLibraryGenre === "all"
        ? "Nessun titolo per questo filtro."
        : `Nessun titolo visto per "${currentLibraryGenre}".`);
    observeLibrarySentinel();
    return;
  }

  emptyEl.classList.add("hidden");
  renderNextLibraryPage();
  observeLibrarySentinel();
}

// Aggiunge il prossimo blocco di risultati alla lista già disegnata, invece
// di ridisegnare tutto da capo: chiamata sia dal render iniziale che dal
// IntersectionObserver quando la sentinella in fondo alla lista diventa
// visibile (utente vicino al fondo dello scroll).
function renderNextLibraryPage() {
  const next = libraryFilteredItems.slice(libraryRenderedCount, libraryRenderedCount + LIBRARY_PAGE_SIZE);
  if (!next.length) return;
  document.getElementById("libraryList").insertAdjacentHTML("beforeend", renderLibraryList(next, currentLibraryMode));
  libraryRenderedCount += next.length;
}

// Un solo observer, riusato a ogni apertura di "Vedi tutto": osserva sempre
// la stessa sentinella (mai ricreata nel DOM), quindi basta assicurarsi che
// sia "in ascolto" — nessun rischio di observer duplicati.
function observeLibrarySentinel() {
  const sentinel = document.getElementById("libraryLoadMoreSentinel");
  if (!sentinel) return;
  if (!libraryLoadMoreObserver) {
    libraryLoadMoreObserver = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) renderNextLibraryPage();
    }, { rootMargin: "600px" }); // carica il blocco successivo un po' prima che l'utente arrivi in fondo
    libraryLoadMoreObserver.observe(sentinel);
  }
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
    .slice(0, 500);
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
  const genreVotes = {};
  db.seen.forEach(item => {
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
    .map(([label, value]) => {
      const votes = genreVotes[label] || [];
      const avgVote = votes.length
        ? votes.reduce((a, b) => a + b, 0) / votes.length
        : null;
      return { label, value, avgVote };
    });

  renderGenreBars(topGenres);
  renderRanking();
}

// ─── REPORT ────────────────────────────────────────────────────────────────
// A differenza delle Statistiche (ricalcolate live dalla libreria ad ogni
// apertura), il Report è un testo generato da Claude e salvato su Supabase:
// qui lo leggiamo così com'è, la rigenerazione è on-demand (bottone) o
// automatica ogni 6 mesi (cron lato Supabase, non in questo file).

let reportCache = null;

async function renderReport() {
  const report = await loadLatestReport(updatedReport => {
    reportCache = updatedReport;
    renderReportMeta(reportCache);
    renderReportContent(reportCache);
  });
  if (report) {
    reportCache = report;
  }
  renderReportMeta(reportCache);
  renderReportContent(reportCache);
  maybeAutoRefreshReport();
}

// Nessun cron lato Supabase: il controllo "sono passati più di 6 mesi
// dall'ultimo report?" avviene qui, ad ogni apertura della tab Report — se
// sì, si rigenera da sola in background, senza bisogno che l'utente tocchi
// il tasto "Aggiorna" (stesso meccanismo di CineFighi, adattato al ciclo
// di 6 mesi già usato da questa app invece che 1 anno).
function maybeAutoRefreshReport() {
  if (!reportCache) return;
  const last = new Date(reportCache.generated_at);
  if (isNaN(last.getTime())) return;
  const nextDue = new Date(last);
  nextDue.setMonth(nextDue.getMonth() + 6);
  if (new Date() >= nextDue) handleReportRefresh();
}

async function handleReportRefresh() {
  const btn = document.getElementById("reportRefreshBtn");
  if (!btn || btn.disabled) return;

  if (!navigator.onLine) {
    showToast("Sei offline. Connettiti per aggiornare il report.", "error", "Report");
    return;
  }

  btn.disabled = true;
  btn.classList.add("spinning");

  try {
    const report = await regenerateReport();
    reportCache = report;
    renderReportMeta(reportCache);
    renderReportContent(reportCache);
    showToast("Report aggiornato.", "success", "Report");
  } catch (e) {
    console.error(e);
    showToast(e.message || "Aggiornamento non riuscito. Riprova.", "error", "Report");
  } finally {
    btn.disabled = false;
    btn.classList.remove("spinning");
  }
}

function renderAll() {
  renderHomeShelves();
  doRenderLibrary();
  renderStats();
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
    return;
  }

  if (!navigator.onLine) {
    showToast("Sei offline. Controlla la connessione.", "error", "Ricerca");
    return;
  }

  sec.classList.remove("hidden");
  res.innerHTML = "";
  count.textContent = "";
  empty.textContent = "Ricerca in corso…";
  empty.classList.remove("hidden");

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
  const item = await tmdbFetchDetail(type, id);
  openDetail(item);
}

// Un salvataggio locale può fallire (es. localStorage pieno). In quel caso
// non va mostrato lo stesso toast di successo: l'utente crederebbe che i
// dati siano al sicuro mentre potrebbero non esserlo.
function saveResultToast(savedLocally, successMsg, successType, successTitle) {
  if (savedLocally) {
    showToast(successMsg, successType, successTitle);
  } else {
    showToast("Spazio di archiviazione pieno: la modifica potrebbe non essere stata salvata. Libera spazio o esporta un backup.", "error", "Salvataggio non riuscito");
  }
}

async function doAddSeen(type, id) {
  const item = await tmdbFetchDetail(type, id);

  if (inSeen(item)) {
    openDetail(item);
    return;
  }

  db.seen.unshift(item);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(item));

  const savedLocally = await saveDB(db);
  renderAll();
  openDetail(item);

  saveResultToast(savedLocally, `"${item.title}" aggiunto ai visti.`, "success", "Salvato");
  haptic([12, 20, 12]);
}

async function doAddWatch(type, id) {
  const item = await tmdbFetchDetail(type, id);

  if (!inSeen(item) && !inWatch(item)) {
    db.watchlist.unshift(item);
    const savedLocally = await saveDB(db);
    renderAll();
    saveResultToast(savedLocally, `"${item.title}" aggiunto alla watchlist.`, "success", "Watchlist");
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

  const savedLocally = await saveDB(db);
  renderAll();

  saveResultToast(savedLocally, `"${item.title}" spostato tra i visti.`, "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveSeen(key) {
  const item = db.seen.find(x => uniqueKey(x) === key);
  db.seen = db.seen.filter(x => uniqueKey(x) !== key);

  const savedLocally = await saveDB(db);
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    switchScreen("home");
  }

  if (item) {
    saveResultToast(savedLocally, `"${item.title}" rimosso dai visti.`, "info", "Rimosso");
    haptic([14]);
  }
}

async function doRemoveWatch(key) {
  const item = db.watchlist.find(x => uniqueKey(x) === key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  const savedLocally = await saveDB(db);
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    switchScreen("home");
  }

  if (item) {
    saveResultToast(savedLocally, `"${item.title}" rimosso dalla watchlist.`, "info", "Rimosso");
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

  const savedLocally = await saveDB(db);
  renderAll();
  openDetail(target);

  saveResultToast(savedLocally, "Voto e commento salvati.", "success", "Aggiornato");
  haptic([12, 20, 12]);
}

async function doRemoveCurrentDetail() {
  if (!currentDetail) return;

  const key = uniqueKey(currentDetail);
  const title = currentDetail.title;

  db.seen = db.seen.filter(x => uniqueKey(x) !== key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  const savedLocally = await saveDB(db);
  renderAll();
  switchScreen("home");

  saveResultToast(savedLocally, `"${title}" rimosso dalla libreria.`, "info", "Rimosso");
  haptic([14]);
}

function getSelectedGenre() {
  const el = document.getElementById("genreSelect");
  return el ? el.value : "all";
}

// ─── FETCH PER DECADE ─────────────────────────────────────────────────────────
// Fa query TMDB mirate su un range di anni specifico + generi utente.
// Questo è il fix al problema root: invece di sperare che il pool generico
// contenga film di tutte le decadi, li chiediamo esplicitamente a TMDB.

async function fetchCandidatesForDecade(type, yearStart, yearEnd, genreIds, excludedKeys) {
  const minVotes = type === "movie" ? "&vote_count.gte=80" : "&vote_count.gte=30";
  const dateParam = type === "movie"
    ? `&primary_release_date.gte=${yearStart}-01-01&primary_release_date.lte=${yearEnd}-12-31`
    : `&first_air_date.gte=${yearStart}-01-01&first_air_date.lte=${yearEnd}-12-31`;

  const primaryGenre = genreIds[0] ? `&with_genres=${genreIds[0]}` : "";
  const comboGenres = genreIds.slice(0, 2).filter(Boolean).join(",");
  const comboParam = comboGenres ? `&with_genres=${comboGenres}` : "";

  const urls = [
    `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${comboParam}${dateParam}&sort_by=popularity.desc${minVotes}&page=${randomPage(5)}`,
    `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre}${dateParam}&sort_by=vote_average.desc${minVotes}&page=${randomPage(5)}`,
    // URL senza filtro genere come safety net
    `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${dateParam}&sort_by=popularity.desc${minVotes}&page=${randomPage(5)}`
  ];

  const results = await tmdbFetchDiscoverLevel(urls, type, excludedKeys);
  return results;
}

// Pesca candidati ESCLUDENDO i generi preferiti dell'utente (TMDB
// with_genres esclude quando la wanti in without_genres): non uno a caso,
// ma con soglia di voto più alta del solito, così "fuori zona" non significa
// "qualità bassa".
async function fetchOutOfComfortZoneCandidates(type, excludeGenreIds, excludedKeys) {
  const minVotes = type === "movie" ? "&vote_count.gte=150" : "&vote_count.gte=60";
  const withoutGenres = excludeGenreIds.length ? `&without_genres=${excludeGenreIds.join(",")}` : "";

  const urls = [
    `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${withoutGenres}&sort_by=vote_average.desc${minVotes}&page=${randomPage(5)}`,
    `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${withoutGenres}&sort_by=popularity.desc${minVotes}&page=${randomPage(5)}`
  ];

  return tmdbFetchDiscoverLevel(urls, type, excludedKeys);
}

function buildOutOfZoneReason(item, profile) {
  const reasons = ["fuori dai generi che guardi di solito"];
  const tmdbVote = Number(item.vote_average) || 0;
  if (tmdbVote >= 7.2) reasons.push("voto molto alto su TMDB");
  if (profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade) reasons.push("nella tua decade preferita");
  return reasons;
}

// Sceglie i 2 slot "fuori zona" evitando che finiscano sullo stesso genere
// principale (es. entrambi animazione, che su TMDB ha spesso voto medio
// molto alto e rischia di dominare il pool ordinato per voto).
function pickOutOfZoneTwo(ranked) {
  if (!ranked.length) return [];
  const first = ranked[0];
  const firstGenre = (first.item.genre_names && first.item.genre_names[0]) || "Altro";
  const second = ranked.slice(1).find(entry => {
    const g = (entry.item.genre_names && entry.item.genre_names[0]) || "Altro";
    return g !== firstGenre;
  }) || ranked[1];
  return second ? [first, second] : [first];
}

// ─────────────────────────────────────────────────────────────────────────────

async function recommendTonightFive() {
  const el = document.getElementById("tonightSuggestion");
  if (!el) return;

  const reqId = ++tonightReqCounter;

  if (db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    showToast("Aggiungi almeno 3 titoli visti.", "info", "Consigli");
    return;
  }

  if (!navigator.onLine) {
    el.innerHTML = `<p class="tonight__hint">Sei offline. Connettiti per ricevere consigli.</p>`;
    showToast("Sei offline. Controlla la connessione.", "error", "Consigli");
    return;
  }

  el.innerHTML = `<p class="tonight__hint">🔍 Sto cercando 6 titoli adatti…</p>`;

  const profile = getUserTasteProfile();
  const type = profile.prefType;
  const excludedKeys = new Set([...db.seen, ...db.watchlist].map(uniqueKey));

  // Ricava gli ID dei generi preferiti dall'utente
  const genreIds = profile.topGenres
    .map(g => GENRE_NAME_TO_ID[g])
    .filter(Boolean);

  try {
    // ── FETCH SEPARATI PER DECADE + FUORI ZONA ────────────────────────────────
    // Ogni slot fa una query TMDB mirata sul proprio range di anni.
    // Così ogni pool contiene davvero film di quella decade, indipendentemente
    // dalla decade preferita dell'utente (che prima distorceva tutto). In
    // parallelo peschiamo anche un pool esplicitamente FUORI dai generi top.

    const [raw2000s, raw2010s, raw2020s, rawOutOfZone] = await Promise.all([
      fetchCandidatesForDecade(type, 2000, 2009, genreIds, excludedKeys),
      fetchCandidatesForDecade(type, 2010, 2019, genreIds, excludedKeys),
      fetchCandidatesForDecade(type, 2020, 2026, genreIds, excludedKeys),
      fetchOutOfComfortZoneCandidates(type, genreIds, excludedKeys)
    ]);

    if (reqId !== tonightReqCounter) return;

    // Funzione locale per rankare e scegliere i migliori N da un pool
    function rankAndPick(pool, count) {
      const ranked = pool.map(item => ({
        item,
        affinity: calculateAffinity(item, profile),
        rankScore: scoreCandidate(item, profile) + Math.random() * 2.5
      })).sort((a, b) => b.rankScore - a.rankScore);
      return ranked.slice(0, count);
    }

    // 4 slot "ad alta affinità": i migliori da ogni pool per decade
    const slot2000s = rankAndPick(raw2000s, 1);
    const slot2010s = rankAndPick(raw2010s, 1);
    const slot2020s = rankAndPick(raw2020s, 2);

    // Traccia le chiavi già usate per evitare duplicati nel fallback e nel pool fuori zona
    const usedKeys = new Set([
      ...slot2000s.map(e => uniqueKey(e.item)),
      ...slot2010s.map(e => uniqueKey(e.item)),
      ...slot2020s.map(e => uniqueKey(e.item))
    ]);

    let topFour = [...slot2000s, ...slot2010s, ...slot2020s];

    // ── FALLBACK ──────────────────────────────────────────────────────────────
    // Se un pool era vuoto (raro ma possibile), riempiamo con un fetch generico
    // sui generi preferiti senza vincoli di anno — slot mai vuoti garantiti.
    if (topFour.length < 4) {
      const { type: fbType, levels } = buildFallbackQueries(profile, null, {
        useSelectedGenre: false,
        selectedGenre: "all"
      });

      let fbCandidates = [];
      for (const level of levels) {
        const found = await tmdbFetchDiscoverLevel(level.urls, fbType, excludedKeys);
        fbCandidates = [...fbCandidates, ...found];
        const dedup = new Map();
        fbCandidates.forEach(i => dedup.set(uniqueKey(i), i));
        fbCandidates = [...dedup.values()];
        if (fbCandidates.length >= 10) break;
      }

      const fbRanked = fbCandidates
        .filter(i => !usedKeys.has(uniqueKey(i)))
        .map(item => ({
          item,
          affinity: calculateAffinity(item, profile),
          rankScore: scoreCandidate(item, profile) + Math.random() * 2.5
        }))
        .sort((a, b) => b.rankScore - a.rankScore);

      for (const entry of fbRanked) {
        if (topFour.length >= 4) break;
        topFour.push(entry);
        usedKeys.add(uniqueKey(entry.item));
      }
    }

    if (reqId !== tonightReqCounter) return;

    if (!topFour.length) {
      el.innerHTML = `<p class="tonight__hint">Nessun consiglio trovato. Riprova più tardi.</p>`;
      return;
    }

    // Ordine cronologico: dal più vecchio al più recente
    topFour = topFour.slice(0, 4).sort((a, b) => Number(a.item.year || 0) - Number(b.item.year || 0));

    // 2 slot fuori dai generi che guardi di solito, ma con voto TMDB alto
    // (soglia già più severa in fetchOutOfComfortZoneCandidates): "diverso"
    // qui non vuol dire "a caso". pickOutOfZoneTwo evita che i 2 finiscano
    // sullo stesso genere principale.
    const outOfZoneRanked = rawOutOfZone
      .filter(item => !usedKeys.has(uniqueKey(item)))
      .map(item => ({
        item,
        affinity: calculateAffinity(item, profile),
        rankScore: scoreCandidate(item, profile) + Math.random() * 2.5
      }))
      .sort((a, b) => b.rankScore - a.rankScore);

    const outOfZonePicked = pickOutOfZoneTwo(outOfZoneRanked);

    const finalSix = [...topFour, ...outOfZonePicked];

    registerSuggested(finalSix.map(x => x.item));

    // ── DEBUG CONSOLE ─────────────────────────────────────────────────────────
    try {
      console.log("── ⭐ 6 CONSIGLI PER TE ─────────────────");
      console.log(`📚 Visti: ${db.seen.length} · Watchlist: ${db.watchlist.length}`);
      console.log(`🎭 Top generi: ${profile.topGenres.join(" · ") || "—"}`);
      console.log(`📅 Decade pref: ${profile.topDecade || "—"} · Tipo: ${profile.prefType}`);
      console.log(`📆 Pool 2000s: ${raw2000s.length} · Pool 2010s: ${raw2010s.length} · Pool 2020s: ${raw2020s.length} · Pool fuori zona: ${rawOutOfZone.length}`);
      console.log(`🎯 Slot 2000s: ${slot2000s.length}/1 · Slot 2010s: ${slot2010s.length}/1 · Slot 2020+: ${slot2020s.length}/2 · Fuori zona: ${outOfZonePicked.length}/2 · Totale: ${finalSix.length}/6`);
      console.log("─────────────────────────────────────────");
      finalSix.forEach((entry, i) => {
        const item = entry.item;
        const aff = Math.round(entry.affinity);
        const tmdbVote = Number(item.vote_average) || 0;
        const genres = item.genre_names || [];
        let genreBase = 0, matched = 0;
        const matchedDetails = [];
        genres.forEach(g => {
          if (profile.genreAverages[g]) {
            genreBase += profile.genreAverages[g]; matched++;
            matchedDetails.push(`${g}(${profile.genreAverages[g].toFixed(1)})`);
          } else if (profile.topGenres.includes(g)) {
            genreBase += 7.5; matched++;
            matchedDetails.push(`${g}(7.5)`);
          }
        });
        if (!matched) { genreBase = Math.max(6.4, profile.avgVote); matched = 1; matchedDetails.push(`base ${genreBase.toFixed(1)}`); }
        const base = genreBase / matched;
        const decadeMatch = profile.topDecade && decadeScoreLabel(item.year) === profile.topDecade;
        const tipoMatch = item.media_type === profile.prefType;
        const tmdbBonus = tmdbVote > 0 ? Math.min(0.45, (tmdbVote - 6) * 0.1) : 0;
        const score10 = Math.max(6.2, Math.min(9.6, base + (decadeMatch ? 0.35 : 0) + (tipoMatch ? 0.25 : 0) + tmdbBonus));
        console.log(`🎯 ${i + 1}. ${item.title || item.name} (${item.year || "?"}) · ${aff}%`);
        console.log(`   generi: ${matchedDetails.join(" ")} → base ${base.toFixed(2)}`);
        console.log(`   decade ${decadeMatch ? "+0.35" : "✗"} · tipo ${tipoMatch ? "+0.25" : "✗"} · tmdb(${tmdbVote.toFixed(1)}) +${tmdbBonus.toFixed(2)}`);
        console.log(`   totale: ${score10.toFixed(2)}/10 → ${aff}%`);
      });
      console.log("─────────────────────────────────────────");
    } catch (e) { /* debug non blocca mai l'app */ }
    // ── FINE DEBUG ────────────────────────────────────────────────────────────

    const enriched = finalSix.map(entry => ({
      item: entry.item,
      affinity: entry.affinity,
      reasons: outOfZonePicked.includes(entry)
        ? buildOutOfZoneReason(entry.item, profile)
        : buildReason(entry.item, profile, entry.affinity)
    }));

    el.innerHTML = renderTonightFive(enriched, null, "");

    haptic([10]);

  } catch (e) {
    console.error(e);
    if (reqId !== tonightReqCounter) return;
    el.innerHTML = `<p class="tonight__hint">Errore di ricerca. Controlla la connessione.</p>`;
    showToast("Errore nella ricerca dei consigli.", "error", "Consigli");
  }
}

async function discoverByTaste() {
  const el = document.getElementById("tonightSuggestion");
  if (!el) return;

  if (db.seen.length < 3) {
    el.innerHTML = `<p class="tonight__hint">Aggiungi almeno 3 titoli visti per i consigli personalizzati.</p>`;
    showToast("Aggiungi almeno 3 titoli visti.", "info", "Scopri");
    return;
  }

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

    // ── DEBUG ─────────────────────────────────────────────────────────────────
    try {
      const tmdbVote = Number(chosen.vote_average) || 0;
      const tmdbBonus = tmdbVote > 0 ? Math.min(0.45, (tmdbVote - 6) * 0.1) : 0;
      const decadeMatch = profile.topDecade && decadeScoreLabel(chosen.year) === profile.topDecade;
      const tipoMatch = chosen.media_type === profile.prefType;
      const genreLabel = selectedGenre !== "all" ? selectedGenre : "Qualsiasi";
      const genres = chosen.genre_names || [];
      let genreBase = 0, matched = 0;
      const matchedDetails = [];
      genres.forEach(g => {
        if (profile.genreAverages[g]) {
          genreBase += profile.genreAverages[g]; matched++;
          matchedDetails.push(`${g}(${profile.genreAverages[g].toFixed(1)})`);
        } else if (profile.topGenres.includes(g)) {
          genreBase += 7.5; matched++;
          matchedDetails.push(`${g}(7.5)`);
        }
      });
      if (!matched) { genreBase = Math.max(6.4, profile.avgVote); matched = 1; matchedDetails.push(`base ${genreBase.toFixed(1)}`); }
      const base = genreBase / matched;
      const score10 = Math.max(6.2, Math.min(9.6, base + (decadeMatch ? 0.35 : 0) + (tipoMatch ? 0.25 : 0) + tmdbBonus));
      const aff = Math.round(score10 * 10);
      console.log("── ✨ SCOPRI QUALCOSA DI NUOVO ──────────");
      console.log(`📚 Visti: ${db.seen.length} · Watchlist: ${db.watchlist.length}`);
      console.log(`🎭 Top generi: ${profile.topGenres.join(" · ") || "—"}`);
      console.log(`📅 Decade pref: ${profile.topDecade || "—"} · Tipo: ${profile.prefType}`);
      console.log(`🔍 Genere selezionato: ${genreLabel} · Candidati: ${candidates.length} · top pool: ${topPool.length}`);
      console.log("─────────────────────────────────────────");
      console.log(`🎯 1. ${chosen.title || chosen.name} (${chosen.year || "?"}) · ${aff}%`);
      console.log(`   generi: ${matchedDetails.join(" ")} → base ${base.toFixed(2)}`);
      console.log(`   decade ${decadeMatch ? "+0.35" : "✗"} · tipo ${tipoMatch ? "+0.25" : "✗"} · tmdb(${tmdbVote.toFixed(1)}) +${tmdbBonus.toFixed(2)}`);
      console.log(`   totale: ${score10.toFixed(2)}/10 → ${aff}%`);
      console.log("────────────────────────────────────────");
    } catch (e) { /* debug non blocca mai l'app */ }
    // ── FINE DEBUG ────────────────────────────────────────────────────────────

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

  // ── DEBUG ─────────────────────────────────────────────────────────────────
  try {
    const profile = getUserTasteProfile();
    const tmdbVote = Number(pick.vote_average) || 0;
    const tmdbBonus = tmdbVote > 0 ? Math.min(0.45, (tmdbVote - 6) * 0.1) : 0;
    const decadeMatch = profile.topDecade && decadeScoreLabel(pick.year) === profile.topDecade;
    const tipoMatch = pick.media_type === profile.prefType;
    const genres = pick.genre_names || [];
    let genreBase = 0, matched = 0;
    const matchedDetails = [];
    genres.forEach(g => {
      if (profile.genreAverages[g]) {
        genreBase += profile.genreAverages[g]; matched++;
        matchedDetails.push(`${g}(${profile.genreAverages[g].toFixed(1)})`);
      } else if (profile.topGenres.includes(g)) {
        genreBase += 7.5; matched++;
        matchedDetails.push(`${g}(7.5)`);
      }
    });
    if (!matched) { genreBase = Math.max(6.4, profile.avgVote); matched = 1; matchedDetails.push(`base ${genreBase.toFixed(1)}`); }
    const base = genreBase / matched;
    const score10 = Math.max(6.2, Math.min(9.6, base + (decadeMatch ? 0.35 : 0) + (tipoMatch ? 0.25 : 0) + tmdbBonus));
    const aff = Math.round(score10 * 10);
    console.log("── 🏛️ RIVEDI UN CLASSICO ────────────────");
    console.log(`📚 Visti: ${db.seen.length} · Pool classici (voto ≥ 7): ${pool.length}`);
    console.log(`🎭 Top generi: ${profile.topGenres.join(" · ") || "—"}`);
    console.log(`📅 Decade pref: ${profile.topDecade || "—"} · Tipo: ${profile.prefType}`);
    console.log("─────────────────────────────────────────");
    console.log(`🎯 1. ${pick.title || pick.name} (${pick.year || "?"}) · ${aff}% · tuo voto: ${vote}`);
    console.log(`   generi: ${matchedDetails.join(" ")} → base ${base.toFixed(2)}`);
    console.log(`   decade ${decadeMatch ? "+0.35" : "✗"} · tipo ${tipoMatch ? "+0.25" : "✗"} · tmdb(${tmdbVote.toFixed(1)}) +${tmdbBonus.toFixed(2)}`);
    console.log(`   totale: ${score10.toFixed(2)}/10 → ${aff}%`);
    console.log("─────────────────────────────────────────");
  } catch (e) { /* debug non blocca mai l'app */ }
  // ── FINE DEBUG ────────────────────────────────────────────────────────────

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

  reader.onload = (e) => {
    let imported;
    try {
      imported = JSON.parse(e.target.result);
    } catch (err) {
      console.error(err);
      showToast("File backup non leggibile.", "error", "Backup");
      return;
    }

    if (!imported || !Array.isArray(imported.seen) || !Array.isArray(imported.watchlist)) {
      showToast("File backup non valido.", "error", "Backup");
      return;
    }

    askConfirm("Sostituire i dati attuali con quelli del backup?", async () => {
      try {
        // Mutiamo l'oggetto `db` esistente invece di sostituirlo (stessa
        // ragione del fix sul listener realtime): se un salvataggio precedente
        // fosse ancora in coda con un riferimento al vecchio oggetto, vedrà
        // comunque questi dati aggiornati nel momento in cui esegue davvero.
        db.seen = imported.seen.map(normalizedItem);
        db.watchlist = imported.watchlist.map(normalizedItem);

        const savedLocally = await saveDB(db);
        renderAll();
        switchScreen("home");

        saveResultToast(savedLocally, "Backup importato.", "success", "Backup");
        haptic([12, 20, 12]);
      } catch (err) {
        console.error(err);
        showToast("File backup non leggibile.", "error", "Backup");
      }
    });
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
  const reportRefreshBtn = document.getElementById("reportRefreshBtn");
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

      if (screen === "stats") renderStats();
      if (screen === "report") renderReport();
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

  if (recommendBtn) recommendBtn.addEventListener("click", () => { haptic([8]); recommendTonightFive(); });
  if (discoverBtn) discoverBtn.addEventListener("click", () => { haptic([8]); discoverByTaste(); });
  if (classicBtn) classicBtn.addEventListener("click", () => { haptic([8]); suggestClassic(); });
  if (reportRefreshBtn) reportRefreshBtn.addEventListener("click", () => { haptic([8]); handleReportRefresh(); });

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
        const savedLocally = await saveDB(db);
        renderAll();
        saveResultToast(savedLocally, `"${currentDetail.title}" aggiunto ai visti.`, "success", "Salvato");
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
        const savedLocally = await saveDB(db);
        renderAll();
        saveResultToast(savedLocally, `"${currentDetail.title}" in watchlist.`, "success", "Watchlist");
        haptic([10]);
      } else {
        // FIX BUG UI: mancava il caso "già tra i visti, non in watchlist".
        // Prima si cadeva su openDetail(currentDetail) che ripristinava i
        // valori salvati, scartando in silenzio voto/commento appena digitati.
        // doSaveDetailNotes() trova comunque l'item giusto (in seen o in
        // watchlist) e salva le note, qualunque sia la lista in cui si trova.
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
      askConfirm("Rimuovere questo titolo dalla libreria?", () => {
        doRemoveCurrentDetail();
      });
    });
  }

  const confirmYesBtn = document.getElementById("confirmYesBtn");
  const confirmNoBtn = document.getElementById("confirmNoBtn");
  if (confirmYesBtn) {
    confirmYesBtn.addEventListener("click", async () => {
      const action = confirmYesAction;
      closeConfirm();
      if (action) await action();
    });
  }
  if (confirmNoBtn) confirmNoBtn.addEventListener("click", closeConfirm);

  document.addEventListener("click", async (e) => {
    const seenBtn = e.target.closest(".action-seen");
    const watchBtn = e.target.closest(".action-watch");
    const detailsBtn = e.target.closest(".action-details");
    const removeSeenBtn = e.target.closest(".remove-seen");
    const removeWatchBtn = e.target.closest(".remove-watch");
    const moveWatchBtn = e.target.closest(".move-watch-seen");
    const storedBtn = e.target.closest(".open-stored-detail");
    const genreBtn = e.target.closest("[data-genre-filter]");

    if (e.target.closest("button,.nav__btn,.tab,.filter-pill,.shelf-card,.poster-card,.podium-card,.rank-row")) {
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
        await doShowDetails(detailsBtn.dataset.type, detailsBtn.dataset.id);
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

    if (name === "stats") renderStats();
    if (name === "report") renderReport();
  });

  window.addEventListener("secret-backup-access", () => switchScreen("backup"));
}

async function bootApp() {
  try {
    try {
      db = await loadDB();
    } catch (e) {
      console.warn("loadDB error", e);
      db = null;
    }

    if (!db || !db.seen || !db.watchlist) {
      db = { seen: [], watchlist: [] };
      // Se non abbiamo mai avuto una baseline affidabile (né cache né
      // Supabase hanno risposto), avvisiamo l'utente: la libreria potrebbe
      // NON essere vuota davvero, solo non ancora caricata. saveDB() è
      // comunque protetto e non cancellerà nulla su Supabase in questo stato.
      if (!hasReliableBaseline()) {
        try {
          showToast("Sincronizzazione non riuscita: controlla la connessione. Le modifiche fatte ora resteranno solo su questo dispositivo finché non torni online.", "error", "Offline");
        } catch (e) { console.warn(e); }
      }
    }

    try { initNetworkWatcher(); } catch(e) { console.warn(e); }
    try { initUpdateCheck(); } catch(e) { console.warn(e); }
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

document.addEventListener("DOMContentLoaded", bootApp);

supabase
  .channel("realtime-cinetracker")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "Coltel" },
    () => {
      // FIX SYNC MULTI-DISPOSITIVO: loadDB() ritorna la cache locale se
      // presente, quindi qui arriveremmo sempre allo stato "vecchio" e
      // l'evento realtime non si vedrebbe mai in UI. queueRealtimeSync()
      // bypassa la cache e legge davvero lo stato appena cambiato.
      //
      // FIX RACE CONDITION — parte 1: queueRealtimeSync mette il refresh
      // nella STESSA coda dei push (pushChain in storage.js), quindi legge
      // Supabase solo DOPO che ogni nostro salvataggio già in coda è stato
      // scritto — non può più leggere uno stato remoto "vecchio" rispetto a
      // una nostra modifica appena fatta.
      //
      // FIX RACE CONDITION — parte 2 (residua, chiusa qui): tra il momento
      // in cui questo refresh viene accodato e il momento in cui esegue
      // davvero (serve una fetch di rete), l'utente può aver aggiunto un
      // nuovo titolo in locale. Una sovrascrittura totale (`db.seen =
      // newDB.seen`) cancellerebbe quel titolo appena aggiunto — sia dalla
      // UI sia dal prossimo salvataggio, che legge `db` per riferimento.
      // mergeRemoteIntoLocal() risolve questo: aggiorna/aggiunge gli item
      // remoti per chiave, ma non rimuove MAI un item presente solo in
      // locale (l'oggetto `db` resta comunque mutato sul posto, non
      // riassegnato, per lo stesso motivo del fix precedente).
      queueRealtimeSync(newDB => {
        db.seen = mergeRemoteIntoLocal(db.seen, newDB.seen);
        db.watchlist = mergeRemoteIntoLocal(db.watchlist, newDB.watchlist);
        renderAll();
      });
    }
  )
  .subscribe();
