const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsSection = document.getElementById("resultsSection");
const results = document.getElementById("results");
const resultsEmpty = document.getElementById("resultsEmpty");
const resultCount = document.getElementById("resultCount");
const tabs = [...document.querySelectorAll(".tab")];

const watchShelf = document.getElementById("watchShelf");
const seenMovieShelf = document.getElementById("seenMovieShelf");
const seenSeriesShelf = document.getElementById("seenSeriesShelf");

const watchShelfEmpty = document.getElementById("watchShelfEmpty");
const seenMovieShelfEmpty = document.getElementById("seenMovieShelfEmpty");
const seenSeriesShelfEmpty = document.getElementById("seenSeriesShelfEmpty");

const openWatchAll = document.getElementById("openWatchAll");
const openSeenMovies = document.getElementById("openSeenMovies");
const openSeenSeries = document.getElementById("openSeenSeries");

const libraryBackBtn = document.getElementById("libraryBackBtn");
const libraryTitle = document.getElementById("libraryTitle");
const libraryList = document.getElementById("libraryList");
const libraryEmpty = document.getElementById("libraryEmpty");
const libraryFilters = [...document.querySelectorAll(".filterPill")];
const libraryGenreFilters = document.getElementById("libraryGenreFilters");
const genreFiltersTitle = document.getElementById("genreFiltersTitle");

const statSeen = document.getElementById("statSeen");
const statWatch = document.getElementById("statWatch");
const statMovies = document.getElementById("statMovies");
const statSeries = document.getElementById("statSeries");

const genreBars = document.getElementById("genreBars");
const top100Podium = document.getElementById("top100Podium");
const top100List = document.getElementById("top100List");
const top100CountBadge = document.getElementById("top100CountBadge");
const top100SeriesPodium = document.getElementById("top100SeriesPodium");
const top100SeriesList = document.getElementById("top100SeriesList");
const top100SeriesCountBadge = document.getElementById("top100SeriesCountBadge");

const genreSelect = document.getElementById("genreSelect");
const recommendBtn = document.getElementById("recommendBtn");
const discoverBtn = document.getElementById("discoverBtn");
const classicBtn = document.getElementById("classicBtn");
const tonightSuggestion = document.getElementById("tonightSuggestion");

const exportBtn2 = document.getElementById("exportBtn2");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");

const detailBackBtn = document.getElementById("detailBackBtn");
const detailBackdrop = document.getElementById("detailBackdrop");
const detailPoster = document.getElementById("detailPoster");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const detailGenres = document.getElementById("detailGenres");
const detailOverview = document.getElementById("detailOverview");
const detailFacts = document.getElementById("detailFacts");
const detailVoteInput = document.getElementById("detailVoteInput");
const detailCommentInput = document.getElementById("detailCommentInput");
const detailSeenBtn = document.getElementById("detailSeenBtn");
const detailWatchBtn = document.getElementById("detailWatchBtn");
const detailSaveNoteBtn = document.getElementById("detailSaveNoteBtn");
const detailRemoveBtn = document.getElementById("detailRemoveBtn");
const toastWrap = document.getElementById("toastWrap");

const screens = {
  home: document.getElementById("screen-home"),
  library: document.getElementById("screen-library"),
  stats: document.getElementById("screen-stats"),
  tonight: document.getElementById("screen-tonight"),
  backup: document.getElementById("screen-backup"),
  detail: document.getElementById("screen-detail"),
};

let currentType = "multi";
let currentDetail = null;
let previousScreen = "home";
let currentLibraryMode = "watch";
let currentLibraryFilter = "all";
let currentLibraryGenre = "all";
let lastAutoRecommendAt = 0;
let tonightAutoRequestCounter = 0;
let lastHapticAt = 0;
let statAnimationFrame = null;
let barAnimationFrame = null;

let db;
try {
  const rawDB = localStorage.getItem("cineTrackerDB");
  db = rawDB ? JSON.parse(rawDB) : { seen: [], watchlist: [] };

  if (!db || typeof db !== "object") db = { seen: [], watchlist: [] };
  if (!Array.isArray(db.seen)) db.seen = [];
  if (!Array.isArray(db.watchlist)) db.watchlist = [];
} catch (error) {
  console.warn("CineTracker DB corrotto. Reset automatico.", error);
  db = { seen: [], watchlist: [] };
  localStorage.setItem("cineTrackerDB", JSON.stringify(db));
}

let suggestHistory;
try {
  const rawHistory = localStorage.getItem(SUGGEST_HISTORY_KEY);
  suggestHistory = rawHistory ? JSON.parse(rawHistory) : [];
  if (!Array.isArray(suggestHistory)) suggestHistory = [];
} catch (error) {
  console.warn("Storico suggerimenti corrotto. Reset automatico.", error);
  suggestHistory = [];
  localStorage.setItem(SUGGEST_HISTORY_KEY, JSON.stringify([]));
}

function saveDB() {
  localStorage.setItem("cineTrackerDB", JSON.stringify(db));
}

function saveSuggestHistory() {
  localStorage.setItem(
    SUGGEST_HISTORY_KEY,
    JSON.stringify(suggestHistory.slice(0, SUGGEST_HISTORY_MAX))
  );
}

function showToast(message, type = "info", title = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const heading = title || (
    type === "success" ? "Fatto" :
    type === "error" ? "Attenzione" :
    "Info"
  );

  toast.innerHTML = `
    <div class="toastTitle">${escapeHtml(heading)}</div>
    <div class="toastText">${escapeHtml(message)}</div>
  `;

  toastWrap.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 240);
  }, 2400);
}

function haptic(pattern = 10) {
  const now = Date.now();
  if (now - lastHapticAt < 60) return;
  lastHapticAt = now;

  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

function animateValue(el, target, duration = 550) {
  const end = Number(target) || 0;
  const current = Number(el.dataset.currentValue || 0);

  if (current === end) {
    el.textContent = String(end);
    return;
  }

  const start = current;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(start + (end - start) * eased);
    el.textContent = String(value);
    el.dataset.currentValue = String(value);

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(end);
      el.dataset.currentValue = String(end);
    }
  }

  requestAnimationFrame(tick);
}

function animateStats(seen, watch, movies, series) {
  if (statAnimationFrame) cancelAnimationFrame(statAnimationFrame);
  statAnimationFrame = requestAnimationFrame(() => {
    animateValue(statSeen, seen);
    animateValue(statWatch, watch);
    animateValue(statMovies, movies);
    animateValue(statSeries, series);
  });
}

function animateBarGroups() {
  if (barAnimationFrame) cancelAnimationFrame(barAnimationFrame);

  const bars = document.querySelectorAll("#screen-stats .barFill[data-width]");
  if (!bars.length) return;

  bars.forEach(bar => bar.style.width = "0%");

  barAnimationFrame = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bars.forEach((bar, index) => {
        const target = bar.dataset.width || "0";
        setTimeout(() => {
          bar.style.width = `${target}%`;
        }, index * 55);
      });
    });
  });
}

function inSeen(item) {
  return db.seen.find(x => uniqueKey(x) === uniqueKey(item));
}

function inWatch(item) {
  return db.watchlist.find(x => uniqueKey(x) === uniqueKey(item));
}

function getStoredItem(item) {
  return db.seen.find(x => uniqueKey(x) === uniqueKey(item)) ||
         db.watchlist.find(x => uniqueKey(x) === uniqueKey(item)) ||
         null;
}

function filterByLibraryCategory(items, filter) {
  if (filter === "all") return items;
  if (filter === "movie") return items.filter(x => x.media_type === "movie");
  if (filter === "series") return items.filter(x => x.media_type === "tv");
  return items;
}

function filterByLibraryGenre(items, genre) {
  if (genre === "all") return items;
  return items.filter(item => (item.genre_names || []).includes(genre));
}

function getLibrarySourceItems() {
  return currentLibraryMode === "watch" ? db.watchlist : db.seen;
}

function getAvailableLibraryGenres() {
  const baseItems = filterByLibraryCategory(getLibrarySourceItems(), currentLibraryFilter);
  const genreSet = new Set();

  baseItems.forEach(item => {
    (item.genre_names || []).forEach(genre => {
      if (genre && genre.trim()) genreSet.add(genre);
    });
  });

  return [...genreSet].sort((a, b) => a.localeCompare(b, "it"));
}

function renderGenreFilters() {
  const genres = getAvailableLibraryGenres();

  if (!genres.length) {
    libraryGenreFilters.innerHTML = "";
    libraryGenreFilters.classList.add("hidden");
    genreFiltersTitle.classList.add("hidden");
    currentLibraryGenre = "all";
    return;
  }

  if (currentLibraryGenre !== "all" && !genres.includes(currentLibraryGenre)) {
    currentLibraryGenre = "all";
  }

  genreFiltersTitle.classList.remove("hidden");
  libraryGenreFilters.classList.remove("hidden");

  libraryGenreFilters.innerHTML = `
    <div class="filterPill ${currentLibraryGenre === "all" ? "active" : ""}" data-genre-filter="all">Tutti i generi</div>
    ${genres.map(genre => `
      <div class="filterPill ${currentLibraryGenre === genre ? "active" : ""}" data-genre-filter="${escapeHtml(genre)}">
        ${escapeHtml(genre)}
      </div>
    `).join("")}
  `;
}

function buildBars(container, entries) {
  if (!entries.length) {
    container.innerHTML = `<div class="muted">Ancora pochi dati.</div>`;
    return;
  }

  const max = entries[0].value || 1;
  container.innerHTML = entries.map(entry => {
    const pct = Math.max(12, (entry.value / max) * 100);
    return `
      <div class="barRow">
        <div>
          <div class="barLabel">${escapeHtml(entry.label)}</div>
          <div class="barTrack">
            <div class="barFill" data-width="${pct}"></div>
          </div>
        </div>
        <div class="barValue">${entry.value}</div>
      </div>
    `;
  }).join("");
}

function getRankedMovies() {
  return db.seen
    .filter(item => item.media_type === "movie" && Number.isFinite(parseUserVote(item.vote)))
    .sort((a, b) => {
      const voteDiff = parseUserVote(b.vote) - parseUserVote(a.vote);
      if (voteDiff !== 0) return voteDiff;

      const yearDiff = Number(b.year || 0) - Number(a.year || 0);
      if (yearDiff !== 0) return yearDiff;

      return titleOf(a).localeCompare(titleOf(b), "it");
    })
    .slice(0, 100);
}

function getRankedSeries() {
  return db.seen
    .filter(item => item.media_type === "tv" && Number.isFinite(parseUserVote(item.vote)))
    .sort((a, b) => {
      const voteDiff = parseUserVote(b.vote) - parseUserVote(a.vote);
      if (voteDiff !== 0) return voteDiff;

      const yearDiff = Number(b.year || 0) - Number(a.year || 0);
      if (yearDiff !== 0) return yearDiff;

      return titleOf(a).localeCompare(titleOf(b), "it");
    })
    .slice(0, 100);
}

function renderTop100() {
  const ranked = getRankedMovies();
  top100CountBadge.textContent = `${ranked.length} titoli`;

  if (!ranked.length) {
    top100Podium.innerHTML = `<div class="insightItem">Valuta alcuni film per vedere il podio.</div>`;
    top100List.innerHTML = `<div class="insightItem">Aggiungi voti ai film visti per creare la tua classifica completa.</div>`;
    return;
  }

  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  const medals = [
    { icon: "🥇", cls: "gold" },
    { icon: "🥈", cls: "silver" },
    { icon: "🥉", cls: "bronze" }
  ];

  top100Podium.innerHTML = podium.map((item, index) => `
    <div class="podiumCard ${medals[index].cls}">
      <div class="podiumMedal">${medals[index].icon}</div>
      <div class="podiumPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="podiumName">${escapeHtml(item.title)}</div>
      <div class="podiumMeta">${escapeHtml(item.year)} · Film</div>
      <div class="podiumVote">⭐ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");

  if (!rest.length) {
    top100List.innerHTML = `<div class="insightItem">Per ora hai solo il podio. Continua a votare per riempire tutta la classifica.</div>`;
    return;
  }

  top100List.innerHTML = rest.map((item, index) => `
    <div class="rankingRow">
      <div class="rankingPos">${index + 4}</div>
      <div class="rankingPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="rankingInfo">
        <div class="rankingTitle">${escapeHtml(item.title)}</div>
        <div class="rankingMeta">${escapeHtml(item.year)} · Film</div>
      </div>
      <div class="rankingVote">⭐ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");
}

function renderTop100Series() {
  const ranked = getRankedSeries();
  top100SeriesCountBadge.textContent = `${ranked.length} titoli`;

  if (!ranked.length) {
    top100SeriesPodium.innerHTML = `<div class="insightItem">Valuta alcune serie per vedere il podio.</div>`;
    top100SeriesList.innerHTML = `<div class="insightItem">Aggiungi voti alle serie viste per creare la tua classifica completa.</div>`;
    return;
  }

  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  const medals = [
    { icon: "🥇", cls: "gold" },
    { icon: "🥈", cls: "silver" },
    { icon: "🥉", cls: "bronze" }
  ];

  top100SeriesPodium.innerHTML = podium.map((item, index) => `
    <div class="podiumCard ${medals[index].cls}">
      <div class="podiumMedal">${medals[index].icon}</div>
      <div class="podiumPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="podiumName">${escapeHtml(item.title)}</div>
      <div class="podiumMeta">${escapeHtml(item.year)} · Serie TV</div>
      <div class="podiumVote">⭐ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");

  if (!rest.length) {
    top100SeriesList.innerHTML = `<div class="insightItem">Per ora hai solo il podio. Continua a votare per riempire tutta la classifica.</div>`;
    return;
  }

  top100SeriesList.innerHTML = rest.map((item, index) => `
    <div class="rankingRow">
      <div class="rankingPos">${index + 4}</div>
      <div class="rankingPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="rankingInfo">
        <div class="rankingTitle">${escapeHtml(item.title)}</div>
        <div class="rankingMeta">${escapeHtml(item.year)} · Serie TV</div>
      </div>
      <div class="rankingVote">⭐ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");
}

function renderTasteMap() {
  if (db.seen.length < 3) {
    genreBars.innerHTML = `<div class="muted">Salva almeno 3 titoli visti.</div>`;
    top100CountBadge.textContent = `0 titoli`;
    top100Podium.innerHTML = `<div class="insightItem">Valuta alcuni film per vedere il podio.</div>`;
    top100List.innerHTML = `<div class="insightItem">Aggiungi voti ai film visti per creare la tua classifica completa.</div>`;
    top100SeriesCountBadge.textContent = `0 titoli`;
    top100SeriesPodium.innerHTML = `<div class="insightItem">Valuta alcune serie per vedere il podio.</div>`;
    top100SeriesList.innerHTML = `<div class="insightItem">Aggiungi voti alle serie viste per creare la tua classifica completa.</div>`;
    return;
  }

  const genreCount = {};
  db.seen.forEach(item => {
    (item.genre_names || []).forEach(name => {
      genreCount[name] = (genreCount[name] || 0) + 1;
    });
  });

  const topGenres = Object.entries(genreCount)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  buildBars(genreBars, topGenres);
  renderTop100();
  renderTop100Series();
}

function renderShelf(container, items) {
  container.innerHTML = items.map(item => `
    <div class="shelfCard open-stored-detail" data-key="${uniqueKey(item)}">
      <div class="shelfPoster" style="background-image:url('${posterUrl(item.poster_path)}')">
        <div class="badge ${mediaBadgeClass(item)}">${mediaLabel(item)}</div>
      </div>
      <div class="shelfInfo">
        <div class="shelfTitle">${escapeHtml(item.title)}</div>
        <div class="shelfMeta">${item.year} · ${mediaLabel(item)}</div>
      </div>
    </div>
  `).join("");
}

function renderLibraryList() {
  const rawItems = getLibrarySourceItems();
  renderGenreFilters();

  let items = filterByLibraryCategory(rawItems, currentLibraryFilter);
  items = filterByLibraryGenre(items, currentLibraryGenre);

  if (currentLibraryMode === "watch") {
    libraryTitle.textContent = currentLibraryGenre === "all"
      ? "Watchlist"
      : `Watchlist · ${currentLibraryGenre}`;
  } else {
    let baseTitle = "Archivio visti";
    if (currentLibraryFilter === "movie") baseTitle = "Film visti";
    else if (currentLibraryFilter === "series") baseTitle = "Serie TV viste";

    libraryTitle.textContent = currentLibraryGenre === "all"
      ? baseTitle
      : `${baseTitle} · ${currentLibraryGenre}`;
  }

  libraryEmpty.classList.toggle("hidden", items.length > 0);

  if (!items.length) {
    libraryList.innerHTML = "";
    if (currentLibraryMode === "watch") {
      libraryEmpty.textContent = currentLibraryGenre === "all"
        ? "La tua watchlist è vuota."
        : `Nessun titolo in watchlist per il genere ${currentLibraryGenre}.`;
    } else {
      libraryEmpty.textContent = currentLibraryGenre === "all"
        ? "Nessun titolo disponibile per questo filtro."
        : `Nessun titolo visto per il genere ${currentLibraryGenre}.`;
    }
    return;
  }

  libraryList.innerHTML = items.map(item => `
    <div class="listItem">
      <div class="thumb" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div>
        <div class="liTitle">${escapeHtml(item.title)}</div>
        <div class="meta">${item.year} · ${mediaLabel(item)}</div>
        <div class="chips">
          <div class="chip">${mediaLabel(item)}</div>
          ${item.genre_names?.[0] ? `<div class="chip">${escapeHtml(item.genre_names[0])}</div>` : ""}
          ${item.director && item.media_type === "movie" ? `<div class="chip">🎬 ${escapeHtml(item.director)}</div>` : ""}
          ${item.vote ? `<div class="chip">⭐ ${escapeHtml(item.vote)}</div>` : ""}
          ${item.comment ? `<div class="chip">${escapeHtml(item.comment).slice(0, 40)}${item.comment.length > 40 ? "..." : ""}</div>` : ""}
        </div>
        <div class="actions">
          ${currentLibraryMode === "watch" ? `<button class="small ok move-watch-seen" data-key="${uniqueKey(item)}">Segna visto</button>` : ""}
          <button class="small secondary open-stored-detail" data-key="${uniqueKey(item)}">Apri scheda</button>
          <button class="small danger ${currentLibraryMode === "watch" ? "remove-watch" : "remove-seen"}" data-key="${uniqueKey(item)}">Elimina</button>
        </div>
      </div>
    </div>
  `).join("");
}

function renderHomeShelves() {
  const watchPreview = db.watchlist.slice(0, 8);
  const seenMovies = db.seen.filter(x => x.media_type === "movie").slice(0, 8);
  const seenSeries = db.seen.filter(x => x.media_type === "tv").slice(0, 8);

  watchShelfEmpty.classList.toggle("hidden", watchPreview.length > 0);
  seenMovieShelfEmpty.classList.toggle("hidden", seenMovies.length > 0);
  seenSeriesShelfEmpty.classList.toggle("hidden", seenSeries.length > 0);

  openWatchAll.classList.toggle("hidden", db.watchlist.length === 0);
  openSeenMovies.classList.toggle("hidden", db.seen.filter(x => x.media_type === "movie").length === 0);
  openSeenSeries.classList.toggle("hidden", db.seen.filter(x => x.media_type === "tv").length === 0);

  renderShelf(watchShelf, watchPreview);
  renderShelf(seenMovieShelf, seenMovies);
  renderShelf(seenSeriesShelf, seenSeries);
}

async function searchTitles() {
  const q = searchInput.value.trim();

  if (!q) {
    resultsSection.classList.add("hidden");
    results.innerHTML = "";
    resultCount.textContent = "";
    resultsEmpty.textContent = "Nessun risultato trovato.";
    return;
  }

  resultsSection.classList.remove("hidden");
  results.innerHTML = "";
  resultCount.textContent = "";
  resultsEmpty.textContent = "Caricamento...";
  resultsEmpty.classList.remove("hidden");

  try {
    const endpoint = currentType === "movie"
      ? `${BASE_URL}/search/movie?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`
      : currentType === "tv"
      ? `${BASE_URL}/search/tv?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`
      : `${BASE_URL}/search/multi?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`;

    const res = await fetch(endpoint);
    const data = await res.json();

    let items = (data.results || []).filter(x => x.media_type !== "person");
    items = items.slice(0, 20);

    if (!items.length) {
      results.innerHTML = "";
      resultCount.textContent = "";
      resultsEmpty.textContent = "Nessun risultato trovato.";
      resultsEmpty.classList.remove("hidden");
      showToast("Nessun risultato trovato per questa ricerca.", "info", "Ricerca");
      return;
    }

    resultsEmpty.classList.add("hidden");
    resultCount.textContent = `${items.length} risultati`;

    results.innerHTML = items.map(item => {
      const n = normalizedItem(item);
      const seen = !!inSeen(n);
      const watch = !!inWatch(n);

      return `
        <div class="posterCard">
          <div class="poster" style="background-image:url('${posterUrl(n.poster_path)}')">
            <div class="badge ${mediaBadgeClass(n)}">${mediaLabel(n)}</div>
          </div>
          <div class="posterInfo">
            <div class="posterTitle">${escapeHtml(n.title)}</div>
            <div class="meta">${n.year} · ${mediaLabel(n)}</div>
            <div class="actions">
              <button class="small ok action-seen" data-id="${n.id}" data-type="${n.media_type}">
                ${seen ? "Già visto" : "Visto"}
              </button>
              <button class="small secondary action-watch" data-id="${n.id}" data-type="${n.media_type}">
                ${watch ? "In watchlist" : "Watchlist"}
              </button>
              <button class="small secondary action-details" data-id="${n.id}" data-type="${n.media_type}">
                Dettagli
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch {
    results.innerHTML = "";
    resultCount.textContent = "";
    resultsEmpty.textContent = "Errore nella ricerca. Controlla connessione o API.";
    resultsEmpty.classList.remove("hidden");
    showToast("Errore nella ricerca. Controlla connessione o API.", "error", "Ricerca");
  }
}

async function addSeen(type, id) {
  const item = await fetchDetail(type, id);

  if (inSeen(item)) {
    openDetail(item);
    return;
  }

  db.seen.unshift(item);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(item));
  saveDB();
  renderAll();
  openDetail(item);
  showToast(`"${item.title}" aggiunto ai visti.`, "success", "Titolo salvato");
  haptic([12, 20, 12]);
}

async function addWatch(type, id) {
  const item = await fetchDetail(type, id);

  if (!inSeen(item) && !inWatch(item)) {
    db.watchlist.unshift(item);
    saveDB();
    renderAll();
    showToast(`"${item.title}" aggiunto alla watchlist.`, "success", "Watchlist");
    haptic([10]);
  }

  openDetail(item);
}

async function showDetails(type, id) {
  const item = await fetchDetail(type, id);
  openDetail(item);
}

function moveWatchToSeen(key) {
  const item = db.watchlist.find(x => uniqueKey(x) === key);
  if (!item) return;

  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  if (!db.seen.find(x => uniqueKey(x) === key)) {
    item.savedAt = new Date().toISOString();
    db.seen.unshift(item);
  }

  saveDB();
  renderAll();
  showToast(`"${item.title}" spostato tra i visti.`, "success", "Aggiornato");
  haptic([12, 20, 12]);
}

function removeSeen(key) {
  const item = db.seen.find(x => uniqueKey(x) === key);
  db.seen = db.seen.filter(x => uniqueKey(x) !== key);
  saveDB();
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    switchScreen("home");
  }

  if (item) {
    showToast(`"${item.title}" rimosso dai visti.`, "info", "Titolo rimosso");
    haptic([14]);
  }
}

function removeWatch(key) {
  const item = db.watchlist.find(x => uniqueKey(x) === key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);
  saveDB();
  renderAll();

  if (currentDetail && uniqueKey(currentDetail) === key) {
    openDetail(currentDetail);
  }

  if (item) {
    showToast(`"${item.title}" rimosso dalla watchlist.`, "info", "Titolo rimosso");
    haptic([14]);
  }
}

function renderStats() {
  const seenCount = db.seen.length;
  const watchCount = db.watchlist.length;
  const movieCount = db.seen.filter(x => x.media_type === "movie").length;
  const seriesCount = db.seen.filter(x => x.media_type === "tv").length;

  animateStats(seenCount, watchCount, movieCount, seriesCount);
  renderTasteMap();
}

function renderAll() {
  renderHomeShelves();
  renderLibraryList();
  renderStats();
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

    const decade = decadeOf(item.year);
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
    .sort((a,b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g);

  const topDecade = Object.entries(decadeCount)
    .sort((a,b) => b[1] - a[1])[0]?.[0] || null;

  const prefType = movieCount >= seriesCount ? "movie" : "tv";

  const genreAverages = {};
  Object.keys(genreCount).forEach(g => {
    const votes = genreVotes[g] || [];
    genreAverages[g] = votes.length
      ? votes.reduce((a,b) => a + b, 0) / votes.length
      : 6.8;
  });

  const overallVotes = db.seen
    .map(x => parseUserVote(x.vote))
    .filter(v => Number.isFinite(v));

  const avgVote = overallVotes.length
    ? overallVotes.reduce((a,b) => a + b, 0) / overallVotes.length
    : 7;

  return { topGenres, topDecade, prefType, genreAverages, avgVote };
}

function getSelectedGenre() {
  return genreSelect.value;
}

function getGenreBoostsFromSelection() {
  const selected = getSelectedGenre();
  return selected === "all" ? [] : [selected];
}

function suggestClassic() {
  const pool = db.seen.filter(x => {
    const v = parseUserVote(x.vote);
    return Number.isFinite(v) && v >= 7;
  });

  if (!pool.length) {
    tonightSuggestion.innerHTML = "<span class='muted'>Nessun titolo con voto 7 o più disponibile. Inizia a votare i tuoi preferiti!</span>";
    showToast("Serve almeno un titolo con voto 7 o più.", "info", "Classico");
    return;
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  const voto = pick.vote || parseUserVote(pick.vote).toFixed(2).replace(/\.00$/, "").replace(".", ",");
  const tipo = mediaLabel(pick);

  let commento = "";
  if (parseUserVote(pick.vote) >= 9) commento = "Uno dei tuoi assoluti — un ottimo motivo per rivederlo.";
  else if (parseUserVote(pick.vote) >= 8) commento = "L'hai amato. Ogni tanto certi titoli vanno rivisti.";
  else commento = "Un bel titolo che hai apprezzato — vale una seconda visione.";

  tonightSuggestion.innerHTML = `
    <strong>⭐ ${escapeHtml(pick.title)}</strong><br>
    <span class="muted">${pick.year} · ${tipo} · Il tuo voto: ${escapeHtml(voto)}</span><br><br>
    <span style="font-size:13px;">📌 ${commento}</span>
  `;
  haptic([10]);
}

function buildFallbackQueries(profile, forcedType, options = {}) {
  const useSelectedGenre = options.useSelectedGenre === true;
  const selectedGenre = getSelectedGenre();
  const selectedGenreId = (useSelectedGenre && selectedGenre !== "all") ? GENRE_NAME_TO_ID[selectedGenre] : null;

  const type = forcedType || profile.prefType;
  const selectedBoosts = useSelectedGenre ? getGenreBoostsFromSelection() : [];
  const mergedGenres = [...new Set(
    selectedGenreId ? [selectedGenre, ...profile.topGenres] : profile.topGenres
  )];
  const genreIds = mergedGenres.map(g => GENRE_NAME_TO_ID[g]).filter(Boolean);

  const primaryGenre = selectedGenreId || genreIds[0] || "";
  const secondaryGenre = genreIds[1] || "";
  const comboGenres = selectedGenreId
    ? [selectedGenreId, genreIds[0]].filter(Boolean).slice(0, 2).join(",")
    : genreIds.slice(0, 2).join(",");

  let preciseDate = "";
  let widerDate = "";
  if (profile.topDecade) {
    const decadeYear = parseInt(profile.topDecade, 10);
    if (!isNaN(decadeYear)) {
      preciseDate = buildDateRange(decadeYear, decadeYear + 9, type);
      widerDate = buildDateRange(Math.max(1970, decadeYear - 10), decadeYear + 14, type);
    }
  }

  const minVotes = type === "movie" ? "&vote_count.gte=120" : "&vote_count.gte=40";
  const page1 = randomPage(3);
  const page2 = randomPage(3);
  const page3 = randomPage(3);
  const page4 = randomPage(3);

  return {
    type,
    selectedBoosts,
    levels: [
      {
        label: "ricerca precisa",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${comboGenres ? `&with_genres=${comboGenres}` : ""}${preciseDate}&sort_by=popularity.desc${minVotes}&page=${page1}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${preciseDate}&sort_by=vote_average.desc${minVotes}&page=${page2}`
        ]
      },
      {
        label: "ricerca più ampia",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${widerDate}&sort_by=popularity.desc${minVotes}&page=${page3}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${secondaryGenre ? `&with_genres=${secondaryGenre}` : ""}${widerDate}&sort_by=vote_count.desc${minVotes}&page=${page4}`
        ]
      },
      {
        label: "solo genere",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}&sort_by=popularity.desc${minVotes}&page=${randomPage(4)}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${comboGenres ? `&with_genres=${comboGenres}` : ""}&sort_by=vote_average.desc${minVotes}&page=${randomPage(4)}`
        ]
      },
      {
        label: "fallback finale",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT&sort_by=popularity.desc${minVotes}&page=${randomPage(4)}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT&sort_by=vote_count.desc${minVotes}&page=${randomPage(4)}`
        ]
      }
    ]
  };
}

function getHistoryPenalty(key) {
  const now = Date.now();
  let penalty = 0;

  suggestHistory.forEach(entry => {
    if (entry.key !== key) return;
    const hoursAgo = (now - entry.at) / (1000 * 60 * 60);

    if (hoursAgo < 6) penalty += 5;
    else if (hoursAgo < 24) penalty += 3.5;
    else if (hoursAgo < 72) penalty += 2;
    else if (hoursAgo < 168) penalty += 1;
  });

  return penalty;
}

function registerSuggestedItems(items) {
  const now = Date.now();
  const additions = items.map(item => ({
    key: uniqueKey(item),
    at: now
  }));

  suggestHistory = [...additions, ...suggestHistory].slice(0, SUGGEST_HISTORY_MAX);
  saveSuggestHistory();
}

function calculateAffinity(item, profile) {
  const itemGenres = item.genre_names || [];

  let genreBase = 0;
  let matchedGenres = 0;

  itemGenres.forEach(g => {
    if (profile.genreAverages[g]) {
      genreBase += profile.genreAverages[g];
      matchedGenres++;
    } else if (profile.topGenres.includes(g)) {
      genreBase += 7.5;
      matchedGenres++;
    }
  });

  if (!matchedGenres) {
    genreBase = Math.max(6.4, profile.avgVote);
    matchedGenres = 1;
  }

  let score10 = genreBase / matchedGenres;

  if (profile.topDecade && decadeOf(item.year) === profile.topDecade) score10 += 0.35;
  if (item.media_type === profile.prefType) score10 += 0.25;

  const tmdb = Number(item.vote_average) || 0;
  if (tmdb > 0) score10 += Math.min(0.45, (tmdb - 6) * 0.10);

  score10 = Math.max(6.2, Math.min(9.6, score10));
  return Math.round(score10 * 10);
}

function scoreRecommendationCandidate(item, profile, options = {}) {
  let score = 0;
  const itemGenres = item.genre_names || [];
  const selectedBoosts = options.selectedBoosts || [];

  itemGenres.forEach(g => {
    if (profile.topGenres.includes(g)) score += 4;
    if (profile.genreAverages[g]) score += Math.max(0, profile.genreAverages[g] - 5.5);
    if (selectedBoosts.includes(g)) score += 3;
  });

  if (profile.topDecade && decadeOf(item.year) === profile.topDecade) score += 2;
  if (item.media_type === profile.prefType) score += 1;

  const voteAverage = item.vote_average || 0;
  const voteCount = item.vote_count || 0;
  score += Math.min(2.5, voteAverage / 4);
  score += Math.min(2, voteCount / 1200);

  score -= getHistoryPenalty(uniqueKey(item));
  return score;
}

function buildReason(item, profile, affinity) {
  const bits = [];
  const genres = item.genre_names || [];
  const matchGenres = genres.filter(g => profile.topGenres.includes(g));

  if (matchGenres.length) bits.push(`match con ${matchGenres.slice(0, 2).join(" + ")}`);
  if (profile.topDecade && decadeOf(item.year) === profile.topDecade) bits.push(`decade che guardi spesso`);
  if (affinity >= 88) bits.push(`compatibilità molto alta`);
  else if (affinity >= 80) bits.push(`buona sintonia con i tuoi gusti`);

  return bits.slice(0, 3);
}

function getPrimaryGenre(item) {
  return (item.genre_names && item.genre_names[0]) ? item.genre_names[0] : "Altro";
}

function pickDiverseRecommendations(ranked, count = 5) {
  const selected = [];
  const usedKeys = new Set();
  const usedGenres = new Map();

  for (const entry of ranked) {
    if (selected.length >= count) break;

    const key = uniqueKey(entry.item);
    if (usedKeys.has(key)) continue;

    const primaryGenre = getPrimaryGenre(entry.item);
    const genreUsage = usedGenres.get(primaryGenre) || 0;

    if (genreUsage >= 2 && selected.length < count - 1) continue;

    selected.push(entry);
    usedKeys.add(key);
    usedGenres.set(primaryGenre, genreUsage + 1);
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

async function recommendTonightFive(options = {}) {
  const isAuto = options.auto === true;
  const requestId = ++tonightAutoRequestCounter;

  if (db.seen.length < 3) {
    tonightSuggestion.innerHTML = "<span class='muted'>Aggiungi almeno 3 titoli visti per ricevere 5 consigli personalizzati.</span>";
    showToast("Aggiungi almeno 3 titoli visti per usare i consigli personalizzati.", "info", "Consigli");
    return;
  }

  tonightSuggestion.innerHTML = "<span class='muted'>🔍 Sto cercando 5 titoli adatti ai tuoi gusti...</span>";

  const profile = getUserTasteProfile();
  const { type, levels } = buildFallbackQueries(profile, null, { useSelectedGenre: false });

  const excludedKeys = new Set([
    ...db.seen.map(x => uniqueKey(x)),
    ...db.watchlist.map(x => uniqueKey(x))
  ]);

  try {
    let candidates = [];
    let usedLevelLabel = "";

    for (const level of levels) {
      const found = await fetchDiscoverLevel(level.urls, type, excludedKeys);
      candidates = [...candidates, ...found];

      const map = new Map();
      candidates.forEach(item => map.set(uniqueKey(item), item));
      candidates = [...map.values()];

      if (candidates.length >= 5) {
        usedLevelLabel = level.label;
        break;
      }
    }

    if (requestId !== tonightAutoRequestCounter) return;

    if (!candidates.length) {
      tonightSuggestion.innerHTML = "<span class='muted'>Non ho trovato consigli adatti. Riprova più tardi.</span>";
      showToast("Non ho trovato consigli adatti al momento.", "info", "Consigli");
      return;
    }

    const ranked = candidates
      .map(item => {
        const affinity = calculateAffinity(item, profile);
        const rankScore =
          scoreRecommendationCandidate(item, profile) +
          affinity / 20 +
          Math.random() * 1.1;

        return { item, affinity, rankScore };
      })
      .sort((a,b) => b.rankScore - a.rankScore)
      .slice(0, 18);

    const finalFive = pickDiverseRecommendations(ranked, 5)
      .sort((a,b) => b.affinity - a.affinity);

    if (!finalFive.length) {
      tonightSuggestion.innerHTML = "<span class='muted'>Non ho trovato consigli adatti. Riprova più tardi.</span>";
      showToast("Non ho trovato consigli adatti al momento.", "info", "Consigli");
      return;
    }

    registerSuggestedItems(finalFive.map(entry => entry.item));

    const note = usedLevelLabel && usedLevelLabel !== "ricerca precisa"
      ? `<div class="muted" style="font-size:12px;margin-bottom:10px;">Ho allargato un po' la ricerca per trovarti comunque 5 proposte.</div>`
      : "";

    tonightSuggestion.innerHTML = `
      ${note}
      <div class="tonightList">
        ${finalFive.map(entry => {
          const item = entry.item;
          const reasons = buildReason(item, profile, entry.affinity);
          return `
            <div class="tonightCard open-tonight-detail" data-id="${item.id}" data-type="${item.media_type}">
              <div class="tonightPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
              <div>
                <div class="tonightTitleRow">
                  <div class="tonightTitle">${escapeHtml(item.title)}</div>
                  <div class="affinity">${entry.affinity}%</div>
                </div>
                <div class="tonightSub">
                  ${escapeHtml(item.year)} · ${mediaLabel(item)} · ⭐ ${rawNumberToFixed(item.vote_average, 1)}
                </div>
                <div class="tonightReason">
                  ${reasons.length ? `🎯 ${escapeHtml(reasons.join(" · "))}` : "🎯 Consigliato in base ai tuoi gusti"}
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    if (!isAuto) haptic([10]);
    if (isAuto) lastAutoRecommendAt = Date.now();
  } catch {
    if (requestId !== tonightAutoRequestCounter) return;
    tonightSuggestion.innerHTML = "<span class='muted'>Errore nella ricerca. Controlla la connessione.</span>";
    showToast("Errore nella ricerca dei consigli. Controlla la connessione.", "error", "Consigli");
  }
}

async function maybeAutoRecommendTonight() {
  const now = Date.now();
  const elapsed = now - lastAutoRecommendAt;
  if (elapsed < TONIGHT_AUTO_COOLDOWN_MS) return;
  await recommendTonightFive({ auto: true });
}

async function discoverByTaste() {
  if (db.seen.length < 3) {
    tonightSuggestion.innerHTML = "<span class='muted'>Aggiungi almeno 3 titoli visti per ricevere consigli personalizzati.</span>";
    showToast("Aggiungi almeno 3 titoli visti per usare questa funzione.", "info", "Scopri");
    return;
  }

  tonightSuggestion.innerHTML = "<span class='muted'>🔍 Sto cercando qualcosa di nuovo per te...</span>";

  const profile = getUserTasteProfile();
  const queryConfig = buildFallbackQueries(profile, null, { useSelectedGenre: true });
  const { type, levels, selectedBoosts } = queryConfig;

  const excludedKeys = new Set([
    ...db.seen.map(x => uniqueKey(x)),
    ...db.watchlist.map(x => uniqueKey(x))
  ]);

  try {
    let candidates = [];
    let usedLevelLabel = "";

    for (const level of levels) {
      const found = await fetchDiscoverLevel(level.urls, type, excludedKeys);
      if (found.length > 0) {
        candidates = found;
        usedLevelLabel = level.label;
        break;
      }
    }

    if (!candidates.length) {
      tonightSuggestion.innerHTML = "<span class='muted'>Nessun risultato trovato. Riprova più tardi.</span>";
      showToast("Non ho trovato nulla di adatto al momento.", "info", "Scopri");
      return;
    }

    const scored = candidates
      .map(item => ({
        item,
        score: scoreRecommendationCandidate(item, profile, { selectedBoosts }) + Math.random() * 1.3
      }))
      .sort((a,b) => b.score - a.score);

    const pickPool = scored.slice(0, Math.min(12, scored.length));
    const chosen = pickPool[Math.floor(Math.random() * pickPool.length)].item;

    registerSuggestedItems([chosen]);

    const itemGenres = chosen.genre_names || [];
    const matchGenres = itemGenres.filter(g => profile.topGenres.includes(g));
    const selectedGenre = getSelectedGenre();
    const year = chosen.year;
    const rating = rawNumberToFixed(chosen.vote_average || 0, 1, "n.d.");
    const poster = chosen.poster_path
      ? `<img src="${IMG}${chosen.poster_path}" alt="${escapeHtml(chosen.title)}" style="width:70px;border-radius:10px;float:right;margin-left:12px;">`
      : "";

    const whyBits = [];
    if (selectedGenre !== "all" && itemGenres.includes(selectedGenre)) whyBits.push(`hai scelto il genere ${selectedGenre}`);
    if (matchGenres.length) whyBits.push(`ami il genere ${matchGenres[0]}`);
    if (profile.topDecade && decadeOf(chosen.year) === profile.topDecade) whyBits.push(`ti piacciono spesso gli ${profile.topDecade}`);

    const fallbackNote = usedLevelLabel !== "ricerca precisa"
      ? ` Ho allargato la ricerca per trovarti comunque qualcosa.`
      : "";

    if (!whyBits.length) whyBits.push("ha un buon match con i tuoi gusti");

    tonightSuggestion.innerHTML = `
      ${poster}
      <strong>✨ ${escapeHtml(chosen.title)}</strong><br>
      <span class="muted">${year} · ${mediaLabel(chosen)} · ⭐ ${rating}/10</span><br><br>
      <span style="font-size:13px;">🎯 Scelto perché ${whyBits.join(", ")}. Non è nella tua libreria.${fallbackNote}</span>
      <div style="clear:both"></div>
    `;
    haptic([10]);
  } catch {
    tonightSuggestion.innerHTML = "<span class='muted'>Errore nella ricerca. Controlla la connessione.</span>";
    showToast("Errore nella ricerca. Controlla la connessione.", "error", "Scopri");
  }
}

function switchScreen(name) {
  if (name !== "detail") previousScreen = name;

  Object.values(screens).forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("screenFade");
  });

  screens[name].classList.remove("hidden");
  screens[name].classList.add("screenFade");

  document.querySelectorAll(".navBtn[data-screen]").forEach(b => {
    b.classList.toggle("active", b.dataset.screen === name);
  });

  const currentState = history.state;
  if (name === "home") {
    history.replaceState({ screen: "home" }, "");
  } else if (!currentState || currentState.screen !== name) {
    history.pushState({ screen: name }, "");
  }

  if (name === "tonight") maybeAutoRecommendTonight();
  if (name === "stats") setTimeout(() => animateBarGroups(), 60);
}

window.addEventListener("popstate", (e) => {
  const name = e.state?.screen || "home";
  if (screens[name]) {
    if (name !== "detail") previousScreen = name;

    Object.values(screens).forEach(s => {
      s.classList.add("hidden");
      s.classList.remove("screenFade");
    });

    screens[name].classList.remove("hidden");
    screens[name].classList.add("screenFade");

    document.querySelectorAll(".navBtn[data-screen]").forEach(b => {
      b.classList.toggle("active", b.dataset.screen === name);
    });

    if (name === "tonight") maybeAutoRecommendTonight();
    if (name === "stats") setTimeout(() => animateBarGroups(), 60);
  }
});

function setLibraryFilter(filter) {
  currentLibraryFilter = filter;
  currentLibraryGenre = "all";
  libraryFilters.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  renderLibraryList();
}

function setLibraryGenre(genre) {
  currentLibraryGenre = genre;
  renderLibraryList();
}

function openLibrary(mode, filter = "all") {
  currentLibraryMode = mode;
  currentLibraryGenre = "all";
  setLibraryFilter(filter);
  renderLibraryList();
  switchScreen("library");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cineTracker-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Backup esportato correttamente.", "success", "Backup");
  haptic([12, 20, 12]);
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);

      if (!imported || !Array.isArray(imported.seen) || !Array.isArray(imported.watchlist)) {
        showToast("File backup non valido.", "error", "Backup");
        return;
      }

      const confirmReplace = confirm("Vuoi sostituire i dati attuali con quelli del backup?");
      if (!confirmReplace) return;

      db = {
        seen: imported.seen.map(normalizedItem),
        watchlist: imported.watchlist.map(normalizedItem)
      };

      saveDB();
      renderAll();
      switchScreen("home");
      showToast("Backup importato correttamente.", "success", "Backup");
      haptic([12, 20, 12]);
    } catch {
      showToast("Impossibile leggere il file backup.", "error", "Backup");
    }
  };

  reader.readAsText(file);
}

function openDetail(item) {
  currentDetail = item;

  const stored = getStoredItem(item);
  const source = stored || item;

  detailBackdrop.style.backgroundImage = source.backdrop_path
    ? `url('${posterUrl(source.backdrop_path)}')`
    : `url('${posterUrl(source.poster_path)}')`;

  detailPoster.style.backgroundImage = `url('${posterUrl(source.poster_path)}')`;
  detailTitle.textContent = source.title;
  detailMeta.textContent = `${source.year} · ${mediaLabel(source)}`;

  const chips = [];
  chips.push(`<div class="chip">${mediaLabel(source)}</div>`);
  chips.push(`<div class="chip">${source.year}</div>`);
  (source.genre_names || []).slice(0, 3).forEach(g => {
    chips.push(`<div class="chip">${escapeHtml(g)}</div>`);
  });
  detailGenres.innerHTML = chips.join("");

  detailOverview.textContent = source.overview || "Nessuna trama disponibile.";

  const facts = [];
  facts.push(`Tipo: ${mediaLabel(source)}`);
  facts.push(`Anno: ${source.year}`);
  if (source.genre_names?.length) facts.push(`Generi: ${source.genre_names.join(", ")}`);
  if (source.director && source.media_type === "movie") facts.push(`Regista: ${source.director}`);
  if (source.release_date && source.media_type === "movie") facts.push(`Uscita: ${formatReleaseDate(source.release_date)}`);
  if (inSeen(source)) facts.push("Stato: visto");
  else if (inWatch(source)) facts.push("Stato: in watchlist");
  else facts.push("Stato: non salvato");

  detailFacts.innerHTML = facts.map(x => `<div>${escapeHtml(x)}</div>`).join("");

  detailVoteInput.value = source.vote || "";
  detailCommentInput.value = source.comment || "";

  detailSeenBtn.textContent = inSeen(source) ? "Già tra i visti" : "Segna come visto";
  detailWatchBtn.textContent = inWatch(source) ? "Già in watchlist" : "Aggiungi a watchlist";

  switchScreen("detail");
}

function validateVoteOrShowToast(rawVote) {
  const cleaned = sanitizeVoteInput(rawVote);
  if (!rawVote || !String(rawVote).trim()) {
    return { ok: true, value: "" };
  }

  if (!cleaned || !Number.isFinite(parseUserVote(cleaned))) {
    showToast("Voto non valido. Usa per esempio 7, 7+, 7,5 oppure 8-.", "error", "Voto");
    return { ok: false, value: "" };
  }

  return { ok: true, value: cleaned };
}

function saveDetailNotes() {
  if (!currentDetail) return;

  const voteCheck = validateVoteOrShowToast(detailVoteInput.value);
  if (!voteCheck.ok) return;

  const key = uniqueKey(currentDetail);
  const vote = voteCheck.value;
  const comment = detailCommentInput.value.trim();

  let target = db.seen.find(x => uniqueKey(x) === key) || db.watchlist.find(x => uniqueKey(x) === key);

  if (!target) {
    target = { ...currentDetail };
    db.watchlist.unshift(target);
  }

  target.vote = vote;
  target.comment = comment;

  saveDB();
  renderAll();
  openDetail(target);

  showToast("Voto e commento salvati.", "success", "Scheda aggiornata");
  haptic([12, 20, 12]);
}

function removeCurrentDetail() {
  if (!currentDetail) return;

  const key = uniqueKey(currentDetail);
  const title = currentDetail.title;
  db.seen = db.seen.filter(x => uniqueKey(x) !== key);
  db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== key);

  saveDB();
  renderAll();
  switchScreen("home");
  showToast(`"${title}" rimosso dalla libreria.`, "info", "Titolo rimosso");
  haptic([14]);
}

document.addEventListener("click", async function(e) {
  const seenBtn = e.target.closest(".action-seen");
  const watchBtn = e.target.closest(".action-watch");
  const detailsBtn = e.target.closest(".action-details");
  const removeSeenBtn = e.target.closest(".remove-seen");
  const removeWatchBtn = e.target.closest(".remove-watch");
  const moveWatchBtn = e.target.closest(".move-watch-seen");
  const openStoredBtn = e.target.closest(".open-stored-detail");
  const openTonightBtn = e.target.closest(".open-tonight-detail");
  const genreFilterBtn = e.target.closest("[data-genre-filter]");
  const genericTap = e.target.closest("button, .navBtn, .tab, .filterPill, .seeAllBtn, .shelfCard, .tonightCard");

  if (genericTap) haptic([8]);

  try {
    if (genreFilterBtn) {
      setLibraryGenre(genreFilterBtn.dataset.genreFilter);
      return;
    }

    if (seenBtn) await addSeen(seenBtn.dataset.type, seenBtn.dataset.id);
    if (watchBtn) await addWatch(watchBtn.dataset.type, watchBtn.dataset.id);
    if (detailsBtn) await showDetails(detailsBtn.dataset.type, detailsBtn.dataset.id);
    if (removeSeenBtn) removeSeen(removeSeenBtn.dataset.key);
    if (removeWatchBtn) removeWatch(removeWatchBtn.dataset.key);
    if (moveWatchBtn) moveWatchToSeen(moveWatchBtn.dataset.key);

    if (openStoredBtn) {
      const key = openStoredBtn.dataset.key;
      const item = db.seen.find(x => uniqueKey(x) === key) || db.watchlist.find(x => uniqueKey(x) === key);
      if (item) openDetail(item);
    }

    if (openTonightBtn) {
      await showDetails(openTonightBtn.dataset.type, openTonightBtn.dataset.id);
    }
  } catch {
    showToast("C'è stato un problema. Riprova.", "error", "Errore");
  }
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
  });
});

libraryFilters.forEach(btn => {
  btn.addEventListener("click", () => setLibraryFilter(btn.dataset.filter));
});

searchBtn.addEventListener("click", searchTitles);

searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") searchTitles();
});

const rankingToggleMovies = document.getElementById("rankingToggleMovies");
const rankingToggleSeries = document.getElementById("rankingToggleSeries");
const rankingPanelMovies = document.getElementById("rankingPanelMovies");
const rankingPanelSeries = document.getElementById("rankingPanelSeries");

rankingToggleMovies.addEventListener("click", () => {
  rankingToggleMovies.classList.add("active");
  rankingToggleSeries.classList.remove("active");
  rankingPanelMovies.classList.remove("hidden");
  rankingPanelSeries.classList.add("hidden");
  haptic([8]);
});

rankingToggleSeries.addEventListener("click", () => {
  rankingToggleSeries.classList.add("active");
  rankingToggleMovies.classList.remove("active");
  rankingPanelSeries.classList.remove("hidden");
  rankingPanelMovies.classList.add("hidden");
  haptic([8]);
});

openWatchAll.addEventListener("click", () => openLibrary("watch", "all"));
openSeenMovies.addEventListener("click", () => openLibrary("seen", "movie"));
openSeenSeries.addEventListener("click", () => openLibrary("seen", "series"));

recommendBtn.addEventListener("click", () => recommendTonightFive({ auto: false }));
discoverBtn.addEventListener("click", discoverByTaste);
classicBtn.addEventListener("click", suggestClassic);

document.querySelectorAll(".navBtn[data-screen]").forEach(btn => {
  btn.addEventListener("click", () => switchScreen(btn.dataset.screen));
});

exportBtn2.addEventListener("click", exportBackup);

importBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) importBackup(file);
  importFileInput.value = "";
});

libraryBackBtn.addEventListener("click", () => switchScreen("home"));

detailBackBtn.addEventListener("click", () => {
  switchScreen(previousScreen || "home");
});

detailSeenBtn.addEventListener("click", () => {
  if (!currentDetail) return;

  const voteCheck = validateVoteOrShowToast(detailVoteInput.value);
  if (!voteCheck.ok) return;

  if (!inSeen(currentDetail)) {
    db.seen.unshift({
      ...currentDetail,
      vote: voteCheck.value,
      comment: detailCommentInput.value.trim()
    });
    db.watchlist = db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(currentDetail));
    saveDB();
    renderAll();
    showToast(`"${currentDetail.title}" aggiunto ai visti.`, "success", "Titolo salvato");
    haptic([12, 20, 12]);
  } else {
    saveDetailNotes();
  }

  openDetail(currentDetail);
});

detailWatchBtn.addEventListener("click", () => {
  if (!currentDetail) return;

  const voteCheck = validateVoteOrShowToast(detailVoteInput.value);
  if (!voteCheck.ok) return;

  if (!inSeen(currentDetail) && !inWatch(currentDetail)) {
    db.watchlist.unshift({
      ...currentDetail,
      vote: voteCheck.value,
      comment: detailCommentInput.value.trim()
    });
    saveDB();
    renderAll();
    showToast(`"${currentDetail.title}" aggiunto alla watchlist.`, "success", "Watchlist");
    haptic([10]);
  } else if (inWatch(currentDetail)) {
    saveDetailNotes();
    return;
  }

  openDetail(currentDetail);
});

detailSaveNoteBtn.addEventListener("click", saveDetailNotes);

detailRemoveBtn.addEventListener("click", () => {
  if (!currentDetail) return;
  const ok = confirm("Vuoi rimuovere questo titolo dalla tua libreria?");
  if (!ok) return;
  removeCurrentDetail();
});

history.replaceState({ screen: "home" }, "");
renderAll();

window.addEventListener("load", () => {
  setTimeout(() => {
    const splash = document.getElementById("splashScreen");
    const app = document.querySelector(".app");

    if (app) app.classList.add("appReady");
    if (!splash) return;

    splash.style.opacity = "0";
    setTimeout(() => splash.remove(), 600);
  }, 900);
});