import {
  normalizedItem, uniqueKey, buildDateRange, randomPage,
  sanitizeVoteInput, normalizeGenres, posterUrl, backdropUrl,
  titleOf, yearOf, extractDirector
} from "./cine-core.js";

const API_KEY = "f8d5e378edf5128176f0d89f49310151";
const BASE_URL = "https://api.themoviedb.org/3";

const GENRE_NAME_TO_ID = {
  "Azione":28, "Avventura":12, "Animazione":16, "Commedia":35,
  "Crime":80, "Documentario":99, "Drama":18, "Dramma":18,
  "Famiglia":10751, "Fantasy":14, "Storia":36, "Horror":27,
  "Musica":10402, "Mistero":9648, "Romance":10749, "Fantascienza":878,
  "Thriller":53, "Guerra":10752, "Western":37,
  "Azione & Avventura":10759, "Sci-Fi & Fantasy":10765
};

export async function tmdbSearch(query, type = "multi") {
  const endpoint = type === "movie"
    ? `${BASE_URL}/search/movie?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`
    : type === "tv"
    ? `${BASE_URL}/search/tv?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`
    : `${BASE_URL}/search/multi?api_key=${API_KEY}&language=it-IT&query=${encodeURIComponent(query)}`;

  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Errore TMDb search");
  const data = await res.json();
  return (data.results || []).filter(x => x.media_type !== "person").slice(0, 20);
}

export async function tmdbFetchDetail(type, id) {
  const res = await fetch(
    `${BASE_URL}/${type}/${id}?api_key=${API_KEY}&language=it-IT&append_to_response=credits`
  );
  if (!res.ok) throw new Error("Errore dettaglio TMDb");

  const item = await res.json();
  return normalizedItem({ ...item, media_type: type });
}

export async function tmdbFetchDiscoverLevel(urls, type, excludedKeys) {
  const map = new Map();

  const responses = await Promise.all(
    urls.map(async (url) => {
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

export function buildFallbackQueries(profile, forcedType, options = {}) {
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
