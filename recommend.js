function getCineTrackerDB() {
  try {
    const raw = JSON.parse(localStorage.getItem("cineTrackerDB"));
    if (!raw || typeof raw !== "object") {
      return { seen: [], watchlist: [] };
    }

    return {
      seen: Array.isArray(raw.seen) ? raw.seen : [],
      watchlist: Array.isArray(raw.watchlist) ? raw.watchlist : []
    };
  } catch {
    return { seen: [], watchlist: [] };
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getTitle(item) {
  return item.title || item.name || "Titolo sconosciuto";
}

function getGenres(item) {
  if (Array.isArray(item.genre_names)) {
    return item.genre_names.map(g => String(g).trim().toLowerCase()).filter(Boolean);
  }

  if (Array.isArray(item.genres)) {
    return item.genres
      .map(g => typeof g === "string" ? g : g?.name)
      .map(g => String(g || "").trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function getYear(item) {
  return Number(item.year || 0);
}

function getVoteNumber(item) {
  const n = parseFloat(item.vote);
  return isNaN(n) ? null : n;
}

function uniqueKey(item) {
  return `${item.media_type}_${item.id}`;
}

function getMoodValueForCineTracker() {
  const el = document.getElementById("moodSelect");
  return el ? el.value : "any";
}

function getTimeValueForCineTracker() {
  const el = document.getElementById("timeSelect");
  return el ? el.value : "medium";
}

function getTypeValueForCineTracker() {
  const el = document.getElementById("typeSelect");
  return el ? el.value : "all";
}

function scoreGenrePreferences(seen) {
  const counts = {};

  seen.forEach(item => {
    const vote = getVoteNumber(item);
    const weight = vote ? Math.max(1, vote - 4) : 1.5;

    getGenres(item).forEach(genre => {
      counts[genre] = (counts[genre] || 0) + weight;
    });
  });

  return counts;
}

function scoreTypePreferences(seen) {
  const counts = { movie: 0, tv: 0 };

  seen.forEach(item => {
    const vote = getVoteNumber(item);
    const weight = vote ? Math.max(1, vote - 4) : 1.5;

    if (item.media_type === "movie") counts.movie += weight;
    if (item.media_type === "tv") counts.tv += weight;
  });

  return counts;
}

function scoreDecadePreferences(seen) {
  const counts = {};

  seen.forEach(item => {
    const year = getYear(item);
    if (!year) return;

    const decade = Math.floor(year / 10) * 10;
    const vote = getVoteNumber(item);
    const weight = vote ? Math.max(1, vote - 4) : 1.2;

    counts[decade] = (counts[decade] || 0) + weight;
  });

  return counts;
}

function moodMatches(item, mood) {
  if (mood === "any") return true;

  const genres = getGenres(item);
  const title = normalizeText(getTitle(item));
  const overview = normalizeText(item.overview);
  const text = `${title} ${overview} ${genres.join(" ")}`;

  if (mood === "dark") {
    return (
      text.includes("dark") ||
      text.includes("cupo") ||
      text.includes("teso") ||
      text.includes("thriller") ||
      text.includes("horror") ||
      genres.includes("thriller") ||
      genres.includes("horror") ||
      genres.includes("mistero") ||
      genres.includes("crime")
    );
  }

  if (mood === "epic") {
    return (
      text.includes("epico") ||
      text.includes("visivo") ||
      text.includes("fantasy") ||
      text.includes("avventura") ||
      text.includes("azione") ||
      text.includes("guerra") ||
      genres.includes("azione") ||
      genres.includes("avventura") ||
      genres.includes("fantasy") ||
      genres.includes("storia") ||
      genres.includes("guerra") ||
      genres.includes("sci-fi & fantasy")
    );
  }

  if (mood === "light") {
    return (
      text.includes("commedia") ||
      text.includes("romance") ||
      text.includes("famiglia") ||
      text.includes("animazione") ||
      genres.includes("commedia") ||
      genres.includes("romance") ||
      genres.includes("famiglia") ||
      genres.includes("animazione")
    );
  }

  return true;
}

function timeMatches(item, time) {
  if (time === "short") {
    return item.media_type === "tv";
  }

  if (time === "medium") {
    return item.media_type === "movie";
  }

  if (time === "long") {
    return true;
  }

  return true;
}

function buildTasteProfile(seen) {
  return {
    genreScores: scoreGenrePreferences(seen),
    typeScores: scoreTypePreferences(seen),
    decadeScores: scoreDecadePreferences(seen)
  };
}

function scoreCandidate(item, profile, filters) {
  let score = 0;

  const genres = getGenres(item);
  const year = getYear(item);
  const decade = year ? Math.floor(year / 10) * 10 : null;

  genres.forEach(genre => {
    score += profile.genreScores[genre] || 0;
  });

  if (item.media_type === "movie") {
    score += profile.typeScores.movie || 0;
  } else if (item.media_type === "tv") {
    score += profile.typeScores.tv || 0;
  }

  if (decade && profile.decadeScores[decade]) {
    score += profile.decadeScores[decade] * 0.6;
  }

  if (filters.type !== "all" && item.media_type === filters.type) {
    score += 4;
  }

  if (moodMatches(item, filters.mood)) {
    score += 5;
  }

  if (timeMatches(item, filters.time)) {
    score += 4;
  }

  const personalVote = getVoteNumber(item);
  if (personalVote) {
    score += personalVote * 0.5;
  }

  score += Math.random() * 0.4;

  return score;
}

function getRecommendationReason(item, filters, profile) {
  const genres = getGenres(item);
  const sortedGenres = Object.entries(profile.genreScores)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const matchingFavGenres = genres.filter(g => sortedGenres.includes(g)).slice(0, 2);

  const reasons = [];

  if (matchingFavGenres.length) {
    reasons.push(`ha generi in linea con i tuoi gusti (${matchingFavGenres.join(", ")})`);
  }

  if (filters.type === "movie" && item.media_type === "movie") {
    reasons.push("rispetta la scelta di vedere un film");
  }

  if (filters.type === "tv" && item.media_type === "tv") {
    reasons.push("rispetta la scelta di vedere una serie o anime");
  }

  if (filters.time === "short" && item.media_type === "tv") {
    reasons.push("è più adatto se hai poco tempo");
  }

  if (filters.time === "medium" && item.media_type === "movie") {
    reasons.push("funziona bene per una serata classica");
  }

  if (filters.mood === "dark" && moodMatches(item, "dark")) {
    reasons.push("si adatta a un mood più teso o cupo");
  }

  if (filters.mood === "epic" && moodMatches(item, "epic")) {
    reasons.push("si adatta a una serata più epica o visiva");
  }

  if (filters.mood === "light" && moodMatches(item, "light")) {
    reasons.push("può essere una scelta più leggera");
  }

  if (!reasons.length) {
    reasons.push("è coerente con quello che salvi più spesso");
  }

  return reasons[0];
}

function formatType(item) {
  return item.media_type === "movie" ? "Film" : "Serie / Anime";
}

function buildTop5HTML(items, filters, profile) {
  const lines = items.map((item, index) => {
    const reason = getRecommendationReason(item, filters, profile);
    return `
      <div style="margin-bottom:14px;">
        <strong>${index + 1}. ${getTitle(item)}</strong><br>
        <span style="color:#9aa7b5;">${item.year || "—"} · ${formatType(item)}</span><br>
        <span style="color:#dfe7f0;">Perché: ${reason}.</span>
      </div>
    `;
  });

  return `
    <strong>I 5 consigli più adatti a te:</strong><br><br>
    ${lines.join("")}
  `;
}

function getRecommendedMovies() {
  const db = getCineTrackerDB();
  const suggestionBox = document.getElementById("tonightSuggestion");

  if (!suggestionBox) return;

  const seen = db.seen || [];
  const watchlist = db.watchlist || [];

  if (!watchlist.length) {
    suggestionBox.innerHTML