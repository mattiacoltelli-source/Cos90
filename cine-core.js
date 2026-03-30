const API_KEY = "f8d5e378edf5128176f0d89f49310151";
const BASE_URL = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const TONIGHT_AUTO_COOLDOWN_MS = 20000;
const SUGGEST_HISTORY_KEY = "cineTrackerSuggestHistory";
const SUGGEST_HISTORY_MAX = 40;

const GENRE_MAP = {
  28:"Azione",
  12:"Avventura",
  16:"Animazione",
  35:"Commedia",
  80:"Crime",
  99:"Documentario",
  18:"Drama",
  10751:"Famiglia",
  14:"Fantasy",
  36:"Storia",
  27:"Horror",
  10402:"Musica",
  9648:"Mistero",
  10749:"Romance",
  878:"Fantascienza",
  10770:"TV Movie",
  53:"Thriller",
  10752:"Guerra",
  37:"Western",
  10759:"Azione & Avventura",
  10762:"Bambini",
  10763:"News",
  10764:"Reality",
  10765:"Sci-Fi & Fantasy",
  10766:"Soap",
  10767:"Talk",
  10768:"War & Politics"
};

const GENRE_NAME_TO_ID = {
  "Azione": 28,
  "Avventura": 12,
  "Animazione": 16,
  "Commedia": 35,
  "Crime": 80,
  "Documentario": 99,
  "Drama": 18,
  "Dramma": 18,
  "Famiglia": 10751,
  "Fantasy": 14,
  "Storia": 36,
  "Horror": 27,
  "Musica": 10402,
  "Mistero": 9648,
  "Romance": 10749,
  "Fantascienza": 878,
  "Thriller": 53,
  "Guerra": 10752,
  "Western": 37,
  "Azione & Avventura": 10759,
  "Sci-Fi & Fantasy": 10765
};

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeGenres(item) {
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

export function posterUrl(path) {
  return path ? `${IMG}${path}` : "";
}

export function yearOf(item) {
  const date = item.release_date || item.first_air_date || "";
  return date ? date.slice(0, 4) : (item.year || "—");
}

export function titleOf(item) {
  return item.title || item.name || "Titolo sconosciuto";
}

export function extractDirector(item) {
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

export function sanitizeVoteInput(raw) {
  if (raw === null || raw === undefined) return "";
  let value = String(raw).trim();
  if (!value) return "";

  value = value.replace(/\s+/g, "");
  value = value.replace(/\./g, ",");

  const mapSimple = {
    "6½": "6,5",
    "7½": "7,5",
    "8½": "8,5",
    "9½": "9,5"
  };
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

export function parseUserVote(raw) {
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

export function normalizedItem(item) {
  return {
    id: item.id,
    media_type: (item.media_type === "tv" || item.first_air_date) ? "tv" : "movie",
    title: titleOf(item),
    year: yearOf(item),
    poster_path: item.poster_path || "",
    backdrop_path: item.backdrop_path || "",
    overview: item.overview ? (item.overview.length > 300 ? item.overview.slice(0,300) + "..." : item.overview) : "",
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

export function uniqueKey(item) {
  return `${item.media_type}_${item.id}`;
}

export function decadeOf(year) {
  if (!year || year === "—" || isNaN(Number(year))) return "Sconosciuta";
  const y = Number(year);
  return `${Math.floor(y / 10) * 10}s`;
}

export function mediaLabel(item) {
  return item.media_type === "movie" ? "Film" : "Serie TV";
}

export function mediaBadgeClass(item) {
  return item.media_type === "movie" ? "badge-film" : "badge-series";
}

export function rawNumberToFixed(value, digits = 1, fallback = "n.d.") {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num.toFixed(digits) : fallback;
}

export function formatReleaseDate(dateStr) {
  if (!dateStr) return "Data non disponibile";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function buildDateRange(startYear, endYear, type) {
  if (!startYear || !endYear) return "";
  if (type === "movie") {
    return `&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31`;
  }
  return `&first_air_date.gte=${startYear}-01-01&first_air_date.lte=${endYear}-12-31`;
}

export function randomPage(max = 3) {
  return Math.floor(Math.random() * max) + 1;
}

export async function fetchDetail(type, id) {
  const res = await fetch(`${BASE_URL}/${type}/${id}?api_key=${API_KEY}&language=it-IT&append_to_response=credits`);
  if (!res.ok) throw new Error("Errore nel recupero dettagli");
  const item = await res.json();
  return normalizedItem({ ...item, media_type: type });
}

export async function fetchDiscoverLevel(urls, type, excludedKeys) {
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