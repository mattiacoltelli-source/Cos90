window.CineCore = (() => {
  const API_KEY = "f8d5e378edf5128176f0d89f49310151";
  const BASE_URL = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/w500";
  const TONIGHT_AUTO_COOLDOWN_MS = 20000;
  const DB_KEY = "cineTrackerDB";
  const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
  const SUGGEST_HISTORY_MAX = 40;

  const GENRE_MAP = {
    28:"Azione",12:"Avventura",16:"Animazione",35:"Commedia",80:"Crime",99:"Documentario",
    18:"Drama",10751:"Famiglia",14:"Fantasy",36:"Storia",27:"Horror",10402:"Musica",
    9648:"Mistero",10749:"Romance",878:"Fantascienza",10770:"TV Movie",53:"Thriller",
    10752:"Guerra",37:"Western",10759:"Azione & Avventura",10762:"Bambini",10763:"News",
    10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics"
  };

  const GENRE_NAME_TO_ID = {
    "Azione":28,"Avventura":12,"Animazione":16,"Commedia":35,"Crime":80,"Documentario":99,
    "Drama":18,"Dramma":18,"Famiglia":10751,"Fantasy":14,"Storia":36,"Horror":27,
    "Musica":10402,"Mistero":9648,"Romance":10749,"Fantascienza":878,"Thriller":53,
    "Guerra":10752,"Western":37,"Azione & Avventura":10759,"Sci-Fi & Fantasy":10765
  };

  const state = {
    db: { seen: [], watchlist: [] },
    suggestHistory: [],
    currentType: "multi",
    currentDetail: null,
    previousScreen: "home",
    currentLibraryMode: "watch",
    currentLibraryFilter: "all",
    currentLibraryGenre: "all",
    lastAutoRecommendAt: 0,
    tonightAutoRequestCounter: 0,
    lastHapticAt: 0,
    statAnimationFrame: null,
    barAnimationFrame: null
  };

  let els = {};

  function setElements(map) {
    els = map;
  }

  function initState() {
    try {
      const rawDB = localStorage.getItem(DB_KEY);
      const parsed = rawDB ? JSON.parse(rawDB) : { seen: [], watchlist: [] };
      state.db = {
        seen: Array.isArray(parsed?.seen) ? parsed.seen.map(normalizedItem) : [],
        watchlist: Array.isArray(parsed?.watchlist) ? parsed.watchlist.map(normalizedItem) : []
      };
    } catch {
      state.db = { seen: [], watchlist: [] };
      saveDB();
    }

    try {
      const rawHistory = localStorage.getItem(SUGGEST_HISTORY_KEY);
      const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
      state.suggestHistory = Array.isArray(parsedHistory) ? parsedHistory : [];
    } catch {
      state.suggestHistory = [];
      saveSuggestHistory();
    }
  }

  function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify(state.db));
  }

  function saveSuggestHistory() {
    localStorage.setItem(
      SUGGEST_HISTORY_KEY,
      JSON.stringify(state.suggestHistory.slice(0, SUGGEST_HISTORY_MAX))
    );
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message, type = "info", title = "") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const heading = title || (type === "success" ? "Fatto" : type === "error" ? "Attenzione" : "Info");
    toast.innerHTML = `
      <div class="toastTitle">${escapeHtml(heading)}</div>
      <div class="toastText">${escapeHtml(message)}</div>
    `;
    els.toastWrap.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 240);
    }, 2400);
  }

  function haptic(pattern = 10) {
    const now = Date.now();
    if (now - state.lastHapticAt < 60) return;
    state.lastHapticAt = now;
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

      if (progress < 1) requestAnimationFrame(tick);
      else {
        el.textContent = String(end);
        el.dataset.currentValue = String(end);
      }
    }

    requestAnimationFrame(tick);
  }

  function animateStats(seen, watch, movies, series) {
    if (state.statAnimationFrame) cancelAnimationFrame(state.statAnimationFrame);
    state.statAnimationFrame = requestAnimationFrame(() => {
      animateValue(els.statSeen, seen);
      animateValue(els.statWatch, watch);
      animateValue(els.statMovies, movies);
      animateValue(els.statSeries, series);
    });
  }

  function animateBarGroups() {
    if (state.barAnimationFrame) cancelAnimationFrame(state.barAnimationFrame);
    const bars = document.querySelectorAll("#screen-stats .barFill[data-width]");
    if (!bars.length) return;

    bars.forEach(bar => { bar.style.width = "0%"; });

    state.barAnimationFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bars.forEach((bar, index) => {
          const target = bar.dataset.width || "0";
          setTimeout(() => { bar.style.width = `${target}%`; }, index * 55);
        });
      });
    });
  }

  function normalizeGenres(item) {
    if (Array.isArray(item.genre_ids)) return item.genre_ids.map(id => GENRE_MAP[id] || `Genere ${id}`);
    if (Array.isArray(item.genres)) return item.genres.map(g => typeof g === "string" ? g : g.name).filter(Boolean);
    if (Array.isArray(item.genre_names)) return item.genre_names;
    return [];
  }

  function posterUrl(path) {
    return path ? `${IMG}${path}` : "";
  }

  function yearOf(item) {
    const date = item.release_date || item.first_air_date || "";
    return date ? date.slice(0, 4) : (item.year || "—");
  }

  function titleOf(item) {
    return item.title || item.name || "Titolo sconosciuto";
  }

  function extractDirector(item) {
    if (item.director) return item.director;

    if (item.media_type === "movie" || item.release_date) {
      const crew = item.credits?.crew || [];
      const director = crew.find(person => person.job === "Director");
      if (director?.name) return director.name;
    }

    if (item.media_type === "tv" || item.first_air_date) {
      if (Array.isArray(item.created_by) && item.created_by[0]?.name) {
        return item.created_by[0].name;
      }
    }

    return "";
  }

  function sanitizeVoteInput(raw) {
    if (raw === null || raw === undefined) return "";
    let value = String(raw).trim();
    if (!value) return "";

    value = value.replace(/\s+/g, "").replace(/\./g, ",");

    const mapSimple = { "6½":"6,5", "7½":"7,5", "8½":"8,5", "9½":"9,5" };
    if (mapSimple[value]) value = mapSimple[value];

    const directNumeric = Number(value.replace(",", "."));
    if (Number.isFinite(directNumeric)) {
      if (directNumeric < 0) return "";
      if (directNumeric > 10) value = "10";
      return value.replace(".", ",");
    }

    const plusMinusMatch = value.match(/^(\d{1,2})([+-])$/);
    if (plusMinusMatch) {
      const base = Number(plusMinusMatch[1]);
      if (!Number.isFinite(base) || base < 0 || base > 10) return "";
      return `${base}${plusMinusMatch[2]}`;
    }

    const halfMatch = value.match(/^(\d{1,2}),5$/);
    if (halfMatch) {
      const base = Number(halfMatch[1]);
      if (!Number.isFinite(base) || base < 0 || base > 10) return "";
      return `${base},5`;
    }

    const intMatch = value.match(/^(\d{1,2})$/);
    if (intMatch) {
      const base = Number(intMatch[1]);
      if (!Number.isFinite(base) || base < 0 || base > 10) return "";
      return String(base);
    }

    return "";
  }

  function parseUserVote(raw) {
    if (raw === null || raw === undefined) return NaN;
    const value = sanitizeVoteInput(raw);
    if (!value) return NaN;

    if (value.endsWith("+")) {
      const base = Number(value.slice(0, -1));
      return Number.isFinite(base) ? Math.min(10, base + 0.25) : NaN;
    }

    if (value.endsWith("-")) {
      const base = Number(value.slice(0, -1));
      return Number.isFinite(base) ? Math.max(0, base - 0.25) : NaN;
    }

    const num = Number(value.replace(",", "."));
    return Number.isFinite(num) ? num : NaN;
  }

  function normalizedItem(item) {
    return {
      id: item.id,
      media_type: (item.media_type === "tv" || item.first_air_date) ? "tv" : "movie",
      title: titleOf(item),
      year: yearOf(item),
      poster_path: item.poster_path || "",
      backdrop_path: item.backdrop_path || "",
      overview: item.overview ? (item.overview.length > 300 ? item.overview.slice(0, 300) + "..." : item.overview) : "",
      vote: sanitizeVoteInput(item.vote || ""),
      comment: item.comment || "",
      vote_average: item.vote_average || 0,
      vote_count: item.vote_count || 0,
      popularity: item.popularity || 0,
      genre_names: normalizeGenres(item),
      director: extractDirector(item),
      savedAt: item.savedAt || new Date().toISOString(),
      release_date: item.release_date || "",
      first_air_date: item.first_air_date || ""
    };
  }

  function uniqueKey(item) {
    return `${item.media_type}_${item.id}`;
  }

  function inSeen(item) {
    return state.db.seen.find(x => uniqueKey(x) === uniqueKey(item));
  }

  function inWatch(item) {
    return state.db.watchlist.find(x => uniqueKey(x) === uniqueKey(item));
  }

  function getStoredItem(item) {
    return state.db.seen.find(x => uniqueKey(x) === uniqueKey(item))
      || state.db.watchlist.find(x => uniqueKey(x) === uniqueKey(item))
      || null;
  }

  function decadeOf(year) {
    if (!year || year === "—" || isNaN(Number(year))) return "Sconosciuta";
    const y = Number(year);
    return `${Math.floor(y / 10) * 10}s`;
  }

  function mediaLabel(item) {
    return item.media_type === "movie" ? "Film" : "Serie TV";
  }

  function mediaBadgeClass(item) {
    return item.media_type === "movie" ? "badge-film" : "badge-series";
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
    return state.currentLibraryMode === "watch" ? state.db.watchlist : state.db.seen;
  }

  function getAvailableLibraryGenres() {
    const baseItems = filterByLibraryCategory(getLibrarySourceItems(), state.currentLibraryFilter);
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
      els.libraryGenreFilters.innerHTML = "";
      els.libraryGenreFilters.classList.add("hidden");
      els.genreFiltersTitle.classList.add("hidden");
      state.currentLibraryGenre = "all";
      return;
    }

    if (state.currentLibraryGenre !== "all" && !genres.includes(state.currentLibraryGenre)) {
      state.currentLibraryGenre = "all";
    }

    els.genreFiltersTitle.classList.remove("hidden");
    els.libraryGenreFilters.classList.remove("hidden");

    els.libraryGenreFilters.innerHTML = `
      <div class="filterPill ${state.currentLibraryGenre === "all" ? "active" : ""}" data-genre-filter="all">Tutti i generi</div>
      ${genres.map(genre => `
        <div class="filterPill ${state.currentLibraryGenre === genre ? "active" : ""}" data-genre-filter="${escapeHtml(genre)}">
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
            <div class="barTrack"><div class="barFill" data-width="${pct}"></div></div>
          </div>
          <div class="barValue">${entry.value}</div>
        </div>
      `;
    }).join("");
  }

  function getRankedMovies() {
    return state.db.seen
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
    return state.db.seen
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
    els.top100CountBadge.textContent = `${ranked.length} titoli`;

    if (!ranked.length) {
      els.top100Podium.innerHTML = `<div class="insightItem">Valuta alcuni film per vedere il podio.</div>`;
      els.top100List.innerHTML = `<div class="insightItem">Aggiungi voti ai film visti per creare la tua classifica completa.</div>`;
      return;
    }

    const podium = ranked.slice(0, 3);
    const rest = ranked.slice(3);
    const medals = [
      { icon: "🥇", cls: "gold" },
      { icon: "🥈", cls: "silver" },
      { icon: "🥉", cls: "bronze" }
    ];

    els.top100Podium.innerHTML = podium.map((item, index) => `
      <div class="podiumCard ${medals[index].cls}">
        <div class="podiumMedal">${medals[index].icon}</div>
        <div class="podiumPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
        <div class="podiumName">${escapeHtml(item.title)}</div>
        <div class="podiumMeta">${escapeHtml(item.year)} · Film</div>
        <div class="podiumVote">⭐ ${escapeHtml(item.vote)}</div>
      </div>
    `).join("");

    els.top100List.innerHTML = rest.length
      ? rest.map((item, index) => `
        <div class="rankingRow">
          <div class="rankingPos">${index + 4}</div>
          <div class="rankingPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
          <div class="rankingInfo">
            <div class="rankingTitle">${escapeHtml(item.title)}</div>
            <div class="rankingMeta">${escapeHtml(item.year)} · Film</div>
          </div>
          <div class="rankingVote">⭐ ${escapeHtml(item.vote)}</div>
        </div>
      `).join("")
      : `<div class="insightItem">Per ora hai solo il podio. Continua a votare per riempire tutta la classifica.</div>`;
  }

  function renderTop100Series() {
    const ranked = getRankedSeries();
    els.top100SeriesCountBadge.textContent = `${ranked.length} titoli`;

    if (!ranked.length) {
      els.top100SeriesPodium.innerHTML = `<div class="insightItem">Valuta alcune serie per vedere il podio.</div>`;
      els.top100SeriesList.innerHTML = `<div class="insightItem">Aggiungi voti alle serie viste per creare la tua classifica completa.</div>`;
      return;
    }

    const podium = ranked.slice(0, 3);
    const rest = ranked.slice(3);
    const medals = [
      { icon: "🥇", cls: "gold" },
      { icon: "🥈", cls: "silver" },
      { icon: "🥉", cls: "bronze" }
    ];

    els.top100SeriesPodium.innerHTML = podium.map((item, index) => `
      <div class="podiumCard ${medals[index].cls}">
        <div class="podiumMedal">${medals[index].icon}</div>
        <div class="podiumPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
        <div class="podiumName">${escapeHtml(item.title)}</div>
        <div class="podiumMeta">${escapeHtml(item.year)} · Serie TV</div>
        <div class="podiumVote">⭐ ${escapeHtml(item.vote)}</div>
      </div>
    `).join("");

    els.top100SeriesList.innerHTML = rest.length
      ? rest.map((item, index) => `
        <div class="rankingRow">
          <div class="rankingPos">${index + 4}</div>
          <div class="rankingPoster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
          <div class="rankingInfo">
            <div class="rankingTitle">${escapeHtml(item.title)}</div>
            <div class="rankingMeta">${escapeHtml(item.year)} · Serie TV</div>
          </div>
          <div class="rankingVote">⭐ ${escapeHtml(item.vote)}</div>
        </div>
      `).join("")
      : `<div class="insightItem">Per ora hai solo il podio. Continua a votare per riempire tutta la classifica.</div>`;
  }

  function renderTasteMap() {
    if (state.db.seen.length < 3) {
      els.genreBars.innerHTML = `<div class="muted">Salva almeno 3 titoli visti.</div>`;
      els.top100CountBadge.textContent = `0 titoli`;
      els.top100Podium.innerHTML = `<div class="insightItem">Valuta alcuni film per vedere il podio.</div>`;
      els.top100List.innerHTML = `<div class="insightItem">Aggiungi voti ai film visti per creare la tua classifica completa.</div>`;
      els.top100SeriesCountBadge.textContent = `0 titoli`;
      els.top100SeriesPodium.innerHTML = `<div class="insightItem">Valuta alcune serie per vedere il podio.</div>`;
      els.top100SeriesList.innerHTML = `<div class="insightItem">Aggiungi voti alle serie viste per creare la tua classifica completa.</div>`;
      return;
    }

    const genreCount = {};
    state.db.seen.forEach(item => {
      (item.genre_names || []).forEach(name => {
        genreCount[name] = (genreCount[name] || 0) + 1;
      });
    });

    const topGenres = Object.entries(genreCount)
      .sort((a,b) => b[1] - a[1])
      .slice(0,5)
      .map(([label, value]) => ({ label, value }));

    buildBars(els.genreBars, topGenres);
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

    let items = filterByLibraryCategory(rawItems, state.currentLibraryFilter);
    items = filterByLibraryGenre(items, state.currentLibraryGenre);

    if (state.currentLibraryMode === "watch") {
      els.libraryTitle.textContent = state.currentLibraryGenre === "all"
        ? "Watchlist"
        : `Watchlist · ${state.currentLibraryGenre}`;
    } else {
      let baseTitle = "Archivio visti";
      if (state.currentLibraryFilter === "movie") baseTitle = "Film visti";
      else if (state.currentLibraryFilter === "series") baseTitle = "Serie TV viste";

      els.libraryTitle.textContent = state.currentLibraryGenre === "all"
        ? baseTitle
        : `${baseTitle} · ${state.currentLibraryGenre}`;
    }

    els.libraryEmpty.classList.toggle("hidden", items.length > 0);

    if (!items.length) {
      els.libraryList.innerHTML = "";
      els.libraryEmpty.textContent = state.currentLibraryMode === "watch"
        ? (state.currentLibraryGenre === "all"
          ? "La tua watchlist è vuota."
          : `Nessun titolo in watchlist per il genere ${state.currentLibraryGenre}.`)
        : (state.currentLibraryGenre === "all"
          ? "Nessun titolo disponibile per questo filtro."
          : `Nessun titolo visto per il genere ${state.currentLibraryGenre}.`);
      return;
    }

    els.libraryList.innerHTML = items.map(item => `
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
            ${item.comment ? `<div class="chip">${escapeHtml(item.comment).slice(0,40)}${item.comment.length > 40 ? "..." : ""}</div>` : ""}
          </div>
          <div class="actions">
            ${state.currentLibraryMode === "watch" ? `<button class="small ok move-watch-seen" data-key="${uniqueKey(item)}">Segna visto</button>` : ""}
            <button class="small secondary open-stored-detail" data-key="${uniqueKey(item)}">Apri scheda</button>
            <button class="small danger ${state.currentLibraryMode === "watch" ? "remove-watch" : "remove-seen"}" data-key="${uniqueKey(item)}">Elimina</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  function renderHomeShelves() {
    const watchPreview = state.db.watchlist.slice(0, 8);
    const seenMovies = state.db.seen.filter(x => x.media_type === "movie").slice(0, 8);
    const seenSeries = state.db.seen.filter(x => x.media_type === "tv").slice(0, 8);

    els.watchShelfEmpty.classList.toggle("hidden", watchPreview.length > 0);
    els.seenMovieShelfEmpty.classList.toggle("hidden", seenMovies.length > 0);
    els.seenSeriesShelfEmpty.classList.toggle("hidden", seenSeries.length > 0);

    els.openWatchAll.classList.toggle("hidden", state.db.watchlist.length === 0);
    els.openSeenMovies.classList.toggle("hidden", state.db.seen.filter(x => x.media_type === "movie").length === 0);
    els.openSeenSeries.classList.toggle("hidden", state.db.seen.filter(x => x.media_type === "tv").length === 0);

    renderShelf(els.watchShelf, watchPreview);
    renderShelf(els.seenMovieShelf, seenMovies);
    renderShelf(els.seenSeriesShelf, seenSeries);
  }

  function formatReleaseDate(dateStr) {
    if (!dateStr) return "Data non disponibile";
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  }

  async function searchTitles() {
    const q = els.searchInput.value.trim();

    if (!q) {
      els.resultsSection.classList.add("hidden");
      els.results.innerHTML = "";
      els.resultCount.textContent = "";
      els.resultsEmpty.textContent = "Nessun risultato trovato.";
      return;
    }

    els.resultsSection.classList.remove("hidden");
    els.results.innerHTML = "";
    els.resultCount.textContent = "";
    els.resultsEmpty.textContent = "Caricamento...";
    els.resultsEmpty.classList.remove("hidden");

    try {
      const endpoint = state.currentType === "movie"
        ? `${BASE_URL}/search/movie?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`
        : state.currentType === "tv"
          ? `${BASE_URL}/search/tv?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`
          : `${BASE_URL}/search/multi?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(q)}`;

      const res = await fetch(endpoint);
      const data = await res.json();

      let items = (data.results || []).filter(x => x.media_type !== "person").slice(0, 20);

      if (!items.length) {
        els.results.innerHTML = "";
        els.resultCount.textContent = "";
        els.resultsEmpty.textContent = "Nessun risultato trovato.";
        els.resultsEmpty.classList.remove("hidden");
        showToast("Nessun risultato trovato per questa ricerca.", "info", "Ricerca");
        return;
      }

      els.resultsEmpty.classList.add("hidden");
      els.resultCount.textContent = `${items.length} risultati`;

      els.results.innerHTML = items.map(item => {
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
      els.results.innerHTML = "";
      els.resultCount.textContent = "";
      els.resultsEmpty.textContent = "Errore nella ricerca. Controlla connessione o API.";
      els.resultsEmpty.classList.remove("hidden");
      showToast("Errore nella ricerca. Controlla connessione o API.", "error", "Ricerca");
    }
  }

  async function fetchDetail(type, id) {
    const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&language=it-IT&append_to_response=credits`);
    if (!res.ok) throw new Error("Errore nel recupero dettagli");
    const item = await res.json();
    return normalizedItem({ ...item, media_type: type });
  }

  async function addSeen(type, id) {
    const item = await fetchDetail(type, id);

    if (inSeen(item)) {
      openDetail(item);
      return;
    }

    state.db.seen.unshift(item);
    state.db.watchlist = state.db.watchlist.filter(x => uniqueKey(x) !== uniqueKey(item));
    saveDB();
    renderAll();
    openDetail(item);
    showToast(`"${item.title}" aggiunto ai visti.`, "success", "Titolo salvato");
    haptic([12,20,12]);
  }

  async function addWatch(type, id) {
    const item = await fetchDetail(type, id);

    if (!inSeen(item) && !inWatch(item)) {
      state.db.watchlist.unshift(item);
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
    const item = state.db.watchlist.find(x => uniqueKey(x) === key);
    if (!item) return;

    state.db.watchlist = state.db.watchlist.filter(x => uniqueKey(x) !== key);

    if (!state.db.seen.find(x => uniqueKey(x) === key)) {
      item.savedAt = new Date().toISOString();
      state.db.seen.unshift(item);
    }

    saveDB();
    renderAll();
    showToast(`"${item.title}" spostato tra i visti.`, "success", "Aggiornato");
    haptic([12,20,12]);
  }

  function removeSeen(key) {
    const item = state.db.seen.find(x => uniqueKey(x) === key);
    state.db.seen = state.db.seen.filter(x => uniqueKey(x) !== key);
    saveDB();
    renderAll();

    if (state.currentDetail && uniqueKey(state.currentDetail) === key) {
      switchScreen("home");
    }

    if (item) {
      showToast(`"${item.title}" rimosso dai visti.`, "info", "Titolo rimosso");
      haptic([14]);
    }
  }

  function removeWatch(key) {
    const item = state.db.watchlist.find(x => uniqueKey(x) === key);
    state.db.watchlist = state.db.watchlist.filter(x => uniqueKey(x) !== key);
    saveDB();
    renderAll();

    if (state.currentDetail && uniqueKey(state.currentDetail) === key) {
      openDetail(state.currentDetail);
    }

    if (item) {
      showToast(`"${item.title}" rimosso dalla watchlist.`, "info", "Titolo rimosso");
      haptic([14]);
    }
  }

  function renderStats() {
    const seenCount = state.db.seen.length;
    const watchCount = state.db.watchlist.length;
    const movieCount = state.db.seen.filter(x => x.media_type === "movie").length;
    const seriesCount = state.db.seen.filter(x => x.media_type === "tv").length;

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

    state.db.seen.forEach(item => {
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
      .slice(0,4)
      .map(([g]) => g);

    const topDecade = Object.entries(decadeCount)
      .sort((a,b) => b[1] - a[1])[0]?.[0] || null;

    const prefType = movieCount >= seriesCount ? "movie" : "tv";

    const genreAverages = {};
    Object.keys(genreCount).forEach(g => {
      const votes = genreVotes[g] || [];
      genreAverages[g] = votes.length ? votes.reduce((a,b) => a + b, 0) / votes.length : 6.8;
    });

    const overallVotes = state.db.seen.map(x => parseUserVote(x.vote)).filter(v => Number.isFinite(v));
    const avgVote = overallVotes.length ? overallVotes.reduce((a,b) => a + b, 0) / overallVotes.length : 7;

    return { topGenres, topDecade, prefType, genreAverages, avgVote };
  }

  function getSelectedGenre() {
    return els.genreSelect.value;
  }

  function getGenreBoostsFromSelection() {
    const selected = getSelectedGenre();
    return selected === "all" ? [] : [selected];
  }

  function suggestClassic() {
    const pool = state.db.seen.filter(x => {
      const v = parseUserVote(x.vote);
      return Number.isFinite(v) && v >= 7;
    });

    if (!pool.length) {
      els.tonightSuggestion.innerHTML = "<span class='muted'>Nessun titolo con voto 7 o più disponibile. Inizia a votare i tuoi preferiti!</span>";
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

    els.tonightSuggestion.innerHTML = `
      <strong>⭐ ${escapeHtml(pick.title)}</strong><br>
      <span class="muted">${pick.year} · ${tipo} · Il tuo voto: ${escapeHtml(voto)}</span><br><br>
      <span style="font-size:13px;">📌 ${commento}</span>
    `;
    haptic([10]);
  }

  function rawNumberToFixed(value, digits = 1, fallback = "n.d.") {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num.toFixed(digits) : fallback;
  }

  function buildDateRange(startYear, endYear, type) {
    if (!startYear || !endYear) return "";
    if (type === "movie") {
      return `&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31`;
    }
    return `&first_air_date.gte=${startYear}-01-01&first_air_date.lte=${endYear}-12-31`;
  }

  function randomPage(max = 3) {
    return Math.floor(Math.random() * max) + 1;
  }

  function buildFallbackQueries(profile, forcedType, options = {}) {
    const useSelectedGenre = options.useSelectedGenre === true;
    const selectedGenre = getSelectedGenre();
    const selectedGenreId = (useSelectedGenre && selectedGenre !== "all") ? GENRE_NAME_TO_ID[selectedGenre] : null;

    const type = forcedType || profile.prefType;
    const selectedBoosts = useSelectedGenre ? getGenreBoostsFromSelection() : [];
    const mergedGenres = [...new Set(selectedGenreId ? [selectedGenre, ...profile.topGenres] : profile.topGenres)];
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

    return {
      type,
      selectedBoosts,
      levels: [
        {
          label: "ricerca precisa",
          urls: [
            `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${comboGenres ? `&with_genres=${comboGenres}` : ""}${preciseDate}&sort_by=popularity.desc${minVotes}&page=${randomPage(3)}`,
            `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${preciseDate}&sort_by=vote_average.desc${minVotes}&page=${randomPage(3)}`
          ]
        },
        {
          label: "ricerca più ampia",
          urls: [
            `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${widerDate}&sort_by=popularity.desc${minVotes}&page=${randomPage(3)}`,
            `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${secondaryGenre ? `&with_genres=${secondaryGenre}` : ""}${widerDate}&sort_by=vote_count.desc${minVotes}&page=${randomPage(3)}`
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

  async function fetchDiscoverLevel(urls, type, excludedKeys) {
    const candidatesMap = new Map();

    const responses = await Promise.all(
      urls.map(async url => {
        try {
          const res = await fetch(url);
          if (!res.ok) return [];
          const data = await res.json();
          return data.results || [];
        } catch {
          return [];
        }
      })
    );

    responses.flat().forEach(raw => {
      const item = normalizedItem({ ...raw, media_type: type });
      const key = uniqueKey(item);

      if (excludedKeys.has(key)) return;
      if (!item.poster_path) return;
      if (!item.title || item.title === "Titolo sconosciuto") return;
      if ((item.vote_count || 0) < 20) return;

      candidatesMap.set(key, item);
    });

    return [...candidatesMap.values()];
  }

  function getHistoryPenalty(key) {
    const now = Date.now();
    let penalty = 0;

    state.suggestHistory.forEach(entry => {
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
    const additions = items.map(item => ({ key: uniqueKey(item), at: now }));
    state.suggestHistory = [...additions, ...state.suggestHistory].slice(0, SUGGEST_HISTORY_MAX);
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
    const requestId = ++state.tonightAutoRequestCounter;

    if (state.db.seen.length < 3) {
      els.tonightSuggestion.innerHTML = "<span class='muted'>Aggiungi almeno 3 titoli visti per ricevere 5 consigli personalizzati.</span>";
      showToast("Aggiungi almeno 3 titoli visti per usare i consigli personalizzati.", "info", "Consigli");
      return;
    }

    els.tonightSuggestion.innerHTML = "<span class='muted'>🔍 Sto cercando 5 titoli adatti ai tuoi gusti...</span>";

    const profile = getUserTasteProfile();
    const { type, levels } = buildFallbackQueries(profile, null, { useSelectedGenre: false });
    const excludedKeys = new Set([
      ...state.db.seen.map(x => uniqueKey(x)),
      ...state.db.watchlist.map(x => uniqueKey(x))
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

      if (requestId !== state.tonightAutoRequestCounter) return;

      if (!candidates.length) {
        els.tonightSuggestion.innerHTML = "<span class='muted'>Non ho trovato consigli adatti. Riprova più tardi.</span>";
        showToast("Non ho trovato consigli adatti al momento.", "info", "Consigli");
        return;
      }

      const ranked = candidates
        .map(item => {
          const affinity = calculateAffinity(item, profile);
          const rankScore = scoreRecommendationCandidate(item, profile) + affinity / 20 + Math.random() * 1.1;
          return { item, affinity, rankScore };
        })
        .sort((a,b) => b.rankScore - a.rankScore)
        .slice(0, 18);

      const finalFive = pickDiverseRecommendations(ranked, 5).sort((a,b) => b.affinity - a.affinity);

      if (!finalFive.length) {
        els.tonightSuggestion.innerHTML = "<span class='muted'>Non ho trovato consigli adatti. Riprova più tardi.</span>";
        showToast("Non ho trovato consigli adatti al momento.", "info", "Consigli");
        return;
      }

      registerSuggestedItems(finalFive.map(entry => entry.item));

      const note = usedLevelLabel && usedLevelLabel !== "ricerca precisa"
        ? `<div class="muted" style="font-size:12px;margin-bottom:10px;">Ho allargato un po' la ricerca per trovarti comunque 5 proposte.</div>`
        : "";

      els.tonightSuggestion.innerHTML = `
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
      if (isAuto) state.lastAutoRecommendAt = Date.now();
    } catch {
      if (requestId !== state.tonightAutoRequestCounter) return;
      els.tonightSuggestion.innerHTML = "<span class='muted'>Errore nella ricerca. Controlla la connessione.</span>";
      showToast("Errore nella ricerca dei consigli. Controlla la connessione.", "error", "Consigli");
    }
  }

  async function maybeAutoRecommendTonight() {
    const now = Date.now();
    if (now - state.lastAutoRecommendAt < TONIGHT_AUTO_COOLDOWN_MS) return;
    await recommendTonightFive({ auto: true });
  }

  async function discoverByTaste() {
    if (state.db.seen.length < 3) {
      els.tonightSuggestion.innerHTML = "<span class='muted'>Aggiungi almeno 3 titoli visti per ricevere consigli personalizzati.</span>";
      showToast("Aggiungi almeno 3 titoli visti per usare questa funzione.", "info", "Scopri");
      return;
    }

    els.tonightSuggestion.innerHTML = "<span class='muted'>🔍 Sto cercando qualcosa di nuovo per te...</span>";

    const profile = getUserTasteProfile();
    const queryConfig = buildFallbackQueries(profile, null, { useSelectedGenre: true });
    const { type, levels, selectedBoosts } = queryConfig;

    const excludedKeys = new Set([
      ...state.db.seen.map(x => uniqueKey(x)),
      ...state.db.watchlist.map(x => uniqueKey(x))
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
        els.tonightSuggestion.innerHTML = "<span class='muted'>Nessun risultato trovato. Riprova più tardi.</span>";
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
        ? " Ho allargato la ricerca per trovarti comunque qualcosa."
        : "";

      if (!whyBits.length) whyBits.push("ha un buon match con i tuoi gusti");

      els.tonightSuggestion.innerHTML = `
        ${poster}
        <strong>✨ ${escapeHtml(chosen.title)}</strong><br>
        <span class="muted">${year} · ${mediaLabel(chosen)} · ⭐ ${rating}/10</span><br><br>
        <span style="font-size:13px;">🎯 Scelto perché ${whyBits.join(", ")}. Non è nella tua libreria.${fallbackNote}</span>
        <div style="clear:both"></div>
      `;
      haptic([10]);
    } catch {
      els.tonightSuggestion.innerHTML = "<span class='muted'>Errore nella ricerca. Controlla la connessione.</span>";
      showToast("Errore nella ricerca. Controlla la connessione.", "error", "Scopri");
    }
  }

  function switchScreen(name) {
    if (name !== "detail") state.previousScreen = name;

    Object.values(els.screens).forEach(s => {
      s.classList.add("hidden");
      s.classList.remove("screenFade");
    });

    els.screens[name].classList.remove("hidden");
    els.screens[name].classList.add("screenFade");

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

  function handlePopState(e) {
    const name = e.state?.screen || "home";
    if (!els.screens[name]) return;

    if (name !== "detail") state.previousScreen = name;

    Object.values(els.screens).forEach(s => {
      s.classList.add("hidden");
      s.classList.remove("screenFade");
    });

    els.screens[name].classList.remove("hidden");
    els.screens[name].classList.add("screenFade");

    document.querySelectorAll(".navBtn[data-screen]").forEach(b => {
      b.classList.toggle("active", b.dataset.screen === name);
    });

    if (name === "tonight") maybeAutoRecommendTonight();
    if (name === "stats") setTimeout(() => animateBarGroups(), 60);
  }

  function setLibraryFilter(filter) {
    state.currentLibraryFilter = filter;
    state.currentLibraryGenre = "all";
    els.libraryFilters.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderLibraryList();
  }

  function setLibraryGenre(genre) {
    state.currentLibraryGenre = genre;
    renderLibraryList();
  }

  function openLibrary(mode, filter = "all") {
    state.currentLibraryMode = mode;
    state.currentLibraryGenre = "all";
    setLibraryFilter(filter);
    renderLibraryList();
    switchScreen("library");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state.db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cineTracker-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Backup esportato correttamente.", "success", "Backup");
    haptic([12,20,12]);
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

        state.db = {
          seen: imported.seen.map(normalizedItem),
          watchlist: imported.watchlist.map(normalizedItem)
        };

        saveDB();
        renderAll();
        switchScreen("home");
        showToast("Backup importato correttamente.", "success", "Backup");
        haptic([12,20,12]);
      } catch {
        showToast("Impossibile leggere il file backup.", "error", "Backup");
      }
    };

    reader.readAsText(file);
  }

  function openDetail(item) {
    state.currentDetail = item;
    const stored = getStoredItem(item);
    const source = stored || item;

    els.detailBackdrop.style.backgroundImage = source.backdrop_path
      ? `url('${posterUrl(source.backdrop_path)}')`
      : `url('${posterUrl(source.poster_path)}')`;

    els.detailPoster.style.backgroundImage = `url('${posterUrl(source.poster_path)}')`;
    els.detailTitle.textContent = source.title;
    els.detailMeta.textContent = `${source.year} · ${mediaLabel(source)}`;

    const chips = [];
    chips.push(`<div class="chip">${mediaLabel(source)}</div>`);
    chips.push(`<div class="chip">${source.year}</div>`);
    (source.genre_names || []).slice(0, 3).forEach(g => {
      chips.push(`<div class="chip">${escapeHtml(g)}</div>`);
    });
    els.detailGenres.innerHTML = chips.join("");

    els.detailOverview.textContent = source.overview || "Nessuna trama disponibile.";

    const facts = [];
    facts.push(`Tipo: ${mediaLabel(source)}`);
    facts.push(`Anno: ${source.year}`);
    if (source.genre_names?.length) facts.push(`Generi: ${source.genre_names.join(", ")}`);
    if (source.director && source.media_type === "movie") facts.push(`Regista: ${source.director}`);
    if (source.release_date && source.media_type === "movie") facts.push(`Uscita: ${formatReleaseDate(source.release_date)}`);
    if (inSeen(source)) facts.push("Stato: visto");
    else if (inWatch(source)) facts.push("Stato: in watchlist");
    else facts.push("Stato: non salvato");

    els.detailFacts.innerHTML = facts.map(x => `<div>${escapeHtml(x)}</div>`).join("");

    els.detailVoteInput.value = source.vote || "";
    els.detailCommentInput.value = source.comment || "";

    els.detailSeenBtn.textContent = inSeen(source) ? "Già tra i visti" : "Segna come visto";
    els.detailWatchBtn.textContent = inWatch(source) ? "Già in watchlist" : "Aggiungi a watchlist";

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
    if (!state.currentDetail) return;

    const voteCheck = validateVoteOrShowToast(els.detailVoteInput.value);
    if (!voteCheck.ok) return;

    const key = uniqueKey(state.currentDetail);
    const vote = voteCheck.value;
    const comment = els.detailCommentInput.value.trim();

    let target = state.db.seen.find(x => uniqueKey(x) === key) || state.db.watchlist.find(x => uniqueKey(x) === key);

    if (!target) {
      target = { ...state.currentDetail };
      state.db.watchlist.unshift(target);
    }

    target.vote = vote;
    target.comment = comment;

    saveDB();
    renderAll();
    openDetail(target);
    showToast("Voto e commento salvati.", "success", "Scheda aggiornata");
    haptic([12,20,12]);
  }

  function removeCurrentDetail() {
    if (!state.currentDetail) return;

    const key = uniqueKey(state.currentDetail);
    const title = state.currentDetail.title;

    state.db.seen = state.db.seen.filter(x => uniqueKey(x) !== key);
    state.db.watchlist = state.db.watchlist.filter(x => uniqueKey(x) !== key);

    saveDB();
    renderAll();
    switchScreen("home");
    showToast(`"${title}" rimosso dalla libreria.`, "info", "Titolo rimosso");
    haptic([14]);
  }

  function bootUi() {
    history.replaceState({ screen: "home" }, "");
    renderAll();
  }

  return {
    state,
    setElements,
    initState,
    bootUi,
    handlePopState,
    renderAll,
    searchTitles,
    addSeen,
    addWatch,
    showDetails,
    moveWatchToSeen,
    removeSeen,
    removeWatch,
    setLibraryFilter,
    setLibraryGenre,
    openLibrary,
    exportBackup,
    importBackup,
    switchScreen,
    saveDetailNotes,
    removeCurrentDetail,
    suggestClassic,
    discoverByTaste,
    recommendTonightFive,
    openDetail,
    validateVoteOrShowToast,
    haptic
  };
})();