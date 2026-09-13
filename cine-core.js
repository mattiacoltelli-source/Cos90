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

export const GENRE_NAME_TO_ID = {
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

// FIX XSS: poster_path/backdrop_path arrivano da TMDb in condizioni normali,
// ma possono anche arrivare da un backup importato dall'utente o da una
// scrittura diretta su Supabase (nessuna autenticazione, chiave pubblica).
// Validiamo il formato atteso da TMDb (es. "/qJ2tW6WMUDux911r6m7haRef0WH.jpg")
// PRIMA di usarlo per costruire un URL: qualunque valore che non rispetti
// questo formato viene scartato, invece di finire in un attributo HTML.
const TMDB_IMAGE_PATH_RE = /^\/[A-Za-z0-9]+\.(jpg|jpeg|png|webp)$/i;

export function posterUrl(path, size = "w500") {
  return TMDB_IMAGE_PATH_RE.test(path || "") ? `https://image.tmdb.org/t/p/${size}${path}` : "";
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

// Primi N attori per ordine di credito (credits.cast è già ordinato da TMDb
// dal ruolo principale in giù) — usati per il bonus "attori preferiti" in
// predictQualityScore. Se item.cast è già presente (titolo già normalizzato
// in precedenza) lo riusa invece di ricalcolarlo dai credits grezzi.
export function extractCast(item, limit = 10) {
  if (Array.isArray(item.cast)) return item.cast;
  const cast = item.credits?.cast || [];
  return cast.slice(0, limit).map(person => person.name).filter(Boolean);
}

// "Sottogeneri"/vibe (es. "psychological thriller", "survival horror") per il
// componente keyword di predictQualityScore. TMDb ha due forme diverse per
// la stessa cosa: i film mettono l'elenco in keywords.keywords, le serie in
// keywords.results — nessun errore, è così che risponde davvero l'API.
export function extractKeywords(item) {
  if (Array.isArray(item.keywords) && item.keywords.every(k => typeof k === "string")) return item.keywords;
  const block = item.keywords || {};
  const list = block.keywords || block.results || [];
  return list.map(k => k.name).filter(Boolean);
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

// ─── QUALITÀ PREVISTA (badge nel Dettaglio, solo per titoli non ancora visti) ──
// Stima quanto un titolo potrebbe piacerti usando SOLO il tuo storico reale
// di voti (vedi taste-profile.js): parte dalla tendenza generale voto/anno
// (yearTrend — nei tuoi dati i film più vecchi hanno mediamente un voto più
// alto), poi somma cinque componenti:
// - genreAvg: quanto premi in media, rispetto a quella tendenza, i generi
//   del titolo (qualità pura).
// - genreVolumeBonus: quanto guardi spesso quei generi, anche se non li voti
//   altissimo — un genere "comfort" (es. Horror: lo guardi molto, media
//   modesta) conta comunque qualcosa, non solo la qualità pura.
// - directorAvg: quanto premi in media quel regista specifico.
// - keywordAvg / keywordVolumeBonus: stessa logica di generi+volume ma sui
//   "sottogeneri"/vibe di TMDb (es. "psychological thriller", "survival
//   horror", "nonlinear timeline") — più specifici del genere, catturano
//   gusti come "mi piacciono i mind-bender" che un genere da solo non vede.
// - ACTOR_BONUS: bonus fisso se nel cast c'è un tuo attore preferito
//   (FAVORITE_ACTORS, una lista dichiarata da te, non derivata dai voti).
// Generi/registi/keyword senza abbastanza storico (soglie già applicate in
// taste-profile.js) non contano né in positivo né in negativo — restano
// neutri, non vengono inventati. ACTOR_BONUS non si somma più volte per più
// attori preferiti nello stesso titolo, per non far scappare il punteggio.
// Pura funzione, nessuna chiamata di rete: profile è TASTE_PROFILE importato
// da taste-profile.js, o null se non disponibile (in quel caso niente badge).
const ACTOR_BONUS = 0.6;

export function matchedFavoriteActors(item, favoriteActors = []) {
  const cast = extractCast(item);
  if (!cast.length || !favoriteActors.length) return [];
  return favoriteActors.filter(actor =>
    cast.some(name => name.toLowerCase().includes(actor.toLowerCase()))
  );
}

// Media di due dizionari {chiave: valore} sulle chiavi di `keys` che
// compaiono in entrambi — stessa forma per generi e keyword, evita di
// duplicare la stessa somma/media due volte nella funzione principale.
function averageKnown(keys, avgDict, volumeDict) {
  const known = keys.filter(k => avgDict[k] !== undefined);
  if (!known.length) return 0;
  const total = known.reduce((a, k) => a + avgDict[k] + (volumeDict[k] ?? 0), 0);
  return total / known.length;
}

export function predictQualityScore(item, profile, favoriteActors = []) {
  if (!profile) return null;
  const year = Number(item.year);
  if (!Number.isFinite(year)) return null;

  const { slope, intercept } = profile.yearTrend;
  const baseline = slope * year + intercept;

  const genreComponent = averageKnown(item.genre_names || [], profile.genreAvg, profile.genreVolumeBonus || {});
  const keywordComponent = averageKnown(extractKeywords(item), profile.keywordAvg || {}, profile.keywordVolumeBonus || {});
  const directorComponent = profile.directorAvg[item.director] ?? 0;
  const actorComponent = matchedFavoriteActors(item, favoriteActors).length ? ACTOR_BONUS : 0;

  return Math.max(1, Math.min(10, baseline + genreComponent + keywordComponent + directorComponent + actorComponent));
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
    cast: extractCast(item),
    keywords: extractKeywords(item),
    savedAt: item.savedAt || new Date().toISOString(),
    release_date: item.release_date || "",
    first_air_date: item.first_air_date || ""
  };
}

export function uniqueKey(item) {
  return `${item.media_type}_${item.id}`;
}

// FIX RACE CONDITION REALTIME: unisce lo stato appena letto da Supabase
// con quello locale SENZA cancellare mai un item presente solo in locale.
// Motivo: tra il momento in cui un refresh realtime viene accodato e il
// momento in cui esegue davvero (serve una fetch di rete), l'utente puo'
// aver aggiunto un nuovo titolo. Una sovrascrittura totale (db.seen =
// newDB.seen) cancellerebbe quel titolo appena aggiunto, sia dalla UI sia
// dal prossimo salvataggio (che legge `db` per riferimento). Con questo
// merge, gli item remoti aggiornano/aggiungono quelli locali per chiave,
// ma un item presente solo in locale non viene mai rimosso da qui: nel
// caso raro in cui sia stato invece cancellato da un altro dispositivo,
// resta visibile localmente fino al prossimo caricamento completo — una
// staleness temporanea, molto meno grave di una cancellazione spuria.
export function mergeRemoteIntoLocal(localItems, remoteItems) {
  const merged = new Map((localItems || []).map(item => [uniqueKey(item), item]));
  for (const remoteItem of (remoteItems || [])) {
    merged.set(uniqueKey(remoteItem), remoteItem);
  }
  return Array.from(merged.values());
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