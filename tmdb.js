const API_KEY = "f8d5e378edf5128176f0d89f49310151";
const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const IMG_BACK = "https://image.tmdb.org/t/p/w1280";

const GENRE_MAP = {
  28:"Azione", 12:"Avventura", 16:"Animazione", 35:"Commedia",
  80:"Crime", 99:"Documentario", 18:"Drama", 10751:"Famiglia",
  14:"Fantasy", 36:"Storia", 27:"Horror", 10402:"Musica",
  9648:"Mistero", 10749:"Romance", 878:"Fantascienza", 10770:"TV Movie",
  53:"Thriller", 10752:"Guerra", 37:"Western",
  10759:"Azione & Avventura", 10762:"Bambini", 10763:"News",
  10764:"Reality", 10765:"Sci-Fi & Fantasy", 10766:"Soap",
  10767:"Talk", 10768:"War & Politics"
};

const GENRE_NAME_TO_ID = {
  "Azione":28,
  "Avventura":12,
  "Animazione":16,
  "Commedia":35,
  "Crime":80,
  "Documentario":99,
  "Drama":18,
  "Dramma":18,
  "Famiglia":10751,
  "Fantasy":14,
  "Storia":36,
  "Horror":27,
  "Musica":10402,
  "Mistero":9648,
  "Romance":10749,
  "Fantascienza":878,
  "Thriller":53,
  "Guerra":10752,
  "Western":37,
  "Azione & Avventura":10759,
  "Sci-Fi & Fantasy":10765
};

function uniqueKey(item) {
  return `${item.media_type}_${item.id}`;
}

function posterUrl(path) {
  return path ? `${IMG_BASE}${path}` : "";
}

function backdropUrl(path) {
  return path ? `${IMG_BACK}${path}` : "";
}

function titleOf(item) {
  return item.title || item.name || "Titolo sconosciuto";
}

function yearOf(item) {
  const date = item.release_date || item.first_air_date || "";
  return date ? date.slice(0, 4) : (item.year || "—");
}

function normalizeGenres(item) {
  if (Array.isArray(item.genre_ids)) {
    return item.genre_ids.map(id => GENRE_MAP[id] || `Genere ${id}`);
  }
  if (Array.isArray(item.genres)) {
    return item.genres.map(g => typeof g === "string" ? g : g.name).filter(Boolean);
  }
  if (Array.isArray(item.genre_names)) {
    return item.genre_names;
  }
  return [];
}

function extractDirector(item) {
  if (item.director) return item.director;

  if (item.media_type === "movie" || item.release_date) {
    const crew = item.credits?.crew || [];
    const dir = crew.find(p => p.job === "Director");
    if (dir?.name) return dir.name;
  }

  if (item.media_type === "tv" || item.first_air_date) {
    if (Array.isArray(item.created_by) && item.created_by[0]?.name) {
      return item.created_by[0].name;
    }
  }

  return "";
}

function sanitizeVoteInput(raw) {
  if (raw == null) return "";
  let v = String(raw).trim().replace(/\s+/g, "").replace(/\./g, ",");
  if (!v) return "";

  const mapSimple = { "6½":"6,5", "7½":"7,5", "8½":"8,5", "9½":"9,5" };
  if (mapSimple[v]) v = mapSimple[v];

  const dn = Number(v.replace(",", "."));
  if (Number.isFinite(dn)) {
    if (dn < 0) return "";
    if (dn > 10) v = "10";
    return v.replace(".", ",");
  }

  const pm = v.match(/^(\d{1,2})([+-])$/);
  if (pm) {
    const base = Number(pm[1]);
    if (!Number.isFinite(base) || base < 0 || base > 10) return "";
    return `${base}${pm[2]}`;
  }

  const hf = v.match(/^(\d{1,2}),5$/);
  if (hf) {
    const base = Number(hf[1]);
    if (!Number.isFinite(base) || base < 0 || base > 10) return "";
    return `${base},5`;
  }

  const im = v.match(/^(\d{1,2})$/);
  if (im) {
    const base = Number(im[1]);
    if (!Number.isFinite(base) || base < 0 || base > 10) return "";
    return String(base);
  }

  return "";
}

function parseUserVote(raw) {
  if (raw == null) return NaN;
  const v = sanitizeVoteInput(raw);
  if (!v) return NaN;

  if (v.endsWith("+")) {
    const b = Number(v.slice(0, -1));
    return Number.isFinite(b) ? Math.min(10, b + 0.25) : NaN;
  }

  if (v.endsWith("-")) {
    const b = Number(v.slice(0, -1));
    return Number.isFinite(b) ? Math.max(0, b - 0.25) : NaN;
  }

  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function decadeOf(year) {
  if (!year || year === "—" || isNaN(Number(year))) return "Sconosciuta";
  return `${Math.floor(Number(year) / 10) * 10}s`;
}

function mediaLabel(item) {
  return item.media_type === "movie" ? "Film" : "Serie TV";
}

function mediaBadgeClass(item) {
  return item.media_type === "movie" ? "badge-film" : "badge-series";
}

function rawNumberToFixed(value, digits = 1, fallback = "n.d.") {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num.toFixed(digits) : fallback;
}

function normalizedItem(item) {
  return {
    id: item.id,
    media_type: (item.media_type === "tv" || item.first_air_date) ? "tv" : "movie",
    title: titleOf(item),
    year: yearOf(item),
    poster_path: item.poster_path || "",
    backdrop_path: item.backdrop_path || "",
    overview: item.overview
      ? (item.overview.length > 320 ? item.overview.slice(0, 320) + "…" : item.overview)
      : "",
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

async function tmdbSearch(query, type = "multi") {
  const endpoint = type === "movie"
    ? `${BASE_URL}/search/movie?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`
    : type === "tv"
    ? `${BASE_URL}/search/tv?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`
    : `${BASE_URL}/search/multi?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`;

  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("TMDb search failed");

  const data = await res.json();
  return (data.results || [])
    .filter(x => x.media_type !== "person")
    .slice(0, 20)
    .map(normalizedItem);
}

async function tmdbFetchDetail(type, id) {
  const res = await fetch(
    `${BASE_URL}/${type}/${id}?api_key=${API_KEY}&language=it-IT&append_to_response=credits`
  );
  if (!res.ok) throw new Error("Errore nel recupero dettagli");
  const item = await res.json();
  return normalizedItem({ ...item, media_type: type });
}

async function tmdbFetchDiscoverLevel(urls, type, excludedKeys) {
  const map = new Map();

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

    map.set(key, item);
  });

  return [...map.values()];
}

function buildDateRange(startYear, endYear, type) {
  if (!startYear || !endYear) return "";
  return type === "movie"
    ? `&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31`
    : `&first_air_date.gte=${startYear}-01-01&first_air_date.lte=${endYear}-12-31`;
}

function randomPage(max = 3) {
  return Math.floor(Math.random() * max) + 1;
}

function buildFallbackQueries(profile, forcedType, options = {}) {
  const useSelectedGenre = options.useSelectedGenre === true;
  const selectedGenre = options.selectedGenre || "all";
  const selectedGenreId = (useSelectedGenre && selectedGenre !== "all")
    ? GENRE_NAME_TO_ID[selectedGenre]
    : null;

  const type = forcedType || profile.prefType;
  const selectedBoosts = useSelectedGenre && selectedGenre !== "all" ? [selectedGenre] : [];

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
    const dy = parseInt(profile.topDecade, 10);
    if (!isNaN(dy)) {
      preciseDate = buildDateRange(dy, dy + 9, type);
      widerDate = buildDateRange(Math.max(1970, dy - 10), dy + 14, type);
    }
  }

  const minVotes = type === "movie" ? "&vote_count.gte=120" : "&vote_count.gte=40";
  const [p1, p2, p3, p4] = [randomPage(3), randomPage(3), randomPage(3), randomPage(3)];

  return {
    type,
    selectedBoosts,
    levels: [
      {
        label: "ricerca precisa",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${comboGenres ? `&with_genres=${comboGenres}` : ""}${preciseDate}&sort_by=popularity.desc${minVotes}&page=${p1}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${preciseDate}&sort_by=vote_average.desc${minVotes}&page=${p2}`
        ]
      },
      {
        label: "ricerca più ampia",
        urls: [
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${primaryGenre ? `&with_genres=${primaryGenre}` : ""}${widerDate}&sort_by=popularity.desc${minVotes}&page=${p3}`,
          `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=it-IT${secondaryGenre ? `&with_genres=${secondaryGenre}` : ""}${widerDate}&sort_by=vote_count.desc${minVotes}&page=${p4}`
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