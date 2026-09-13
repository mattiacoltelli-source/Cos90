// ─── taste-profile.js ───────────────────────────────────────────────────────
// Dati precomputati per il badge "Qualità prevista" nel Dettaglio (vedi
// predictQualityScore in cine-core.js). Generato UNA TANTUM da uno script
// Python offline che legge i voti reali da Supabase (sola lettura) e calcola:
// - yearTrend: la tendenza lineare voto/anno nei tuoi voti (i film più
//   vecchi tendono ad avere un voto più alto nei tuoi dati) — serve per non
//   confondere "film vecchio" con "genere/regista che ami di più".
// - genreAvg / directorAvg: quanto premi in media un genere o un regista
//   RISPETTO a quella tendenza (il "residuo"), solo per generi con almeno 5
//   titoli votati e registi con almeno 2 — sotto quella soglia non c'è
//   abbastanza storico per dire qualcosa di affidabile.
//
// Non si aggiorna da solo: quando vuoi numeri freschi (hai votato molto da
// generatedAt in poi), va rilanciato lo script Python e questo file va
// sostituito a mano — è un dato statico, non una chiamata a un servizio.
export const TASTE_PROFILE = {
  "generatedAt": "2026-09-13",
  "sampleSize": 325,
  "yearTrend": { "slope": -0.0315, "intercept": 70.166 },
  "genreAvg": {
    "Dramma": 0.311,
    "Sci-Fi & Fantasy": 0.303,
    "Horror": -0.282,
    "Fantascienza": -0.038,
    "Thriller": -0.048,
    "Avventura": -0.096,
    "Azione": -0.121,
    "Mistero": 0.053,
    "Commedia": -0.155,
    "Crime": 0.043,
    "Fantasy": -0.533,
    "Animazione": 0.219,
    "Storia": 0.636,
    "Guerra": 0.379,
    "Action & Adventure": 0.247,
    "Romance": 0.272
  },
  "directorAvg": {
    "Greg McLean": -0.065,
    "Adam McKay": 0.147,
    "Ridley Scott": -0.273,
    "M. Night Shyamalan": -0.206,
    "David Fincher": 0.612,
    "Neill Blomkamp": 0.135,
    "Steven Spielberg": -0.629,
    "Pascal Laugier": 0.365,
    "Mike Flanagan": -0.072,
    "Rian Johnson": 0.569,
    "Christopher Nolan": 0.696,
    "Ari Aster": 1.038,
    "Rhys Frake-Waterfield": -1.898,
    "Andy Muschietti": 0.459,
    "Damien Leone": -0.4,
    "Quentin Tarantino": 0.7,
    "Martin Scorsese": 1.218,
    "Steven R. Monroe": -0.683,
    "Robert Eggers": 0.731,
    "Drew Goddard": -0.119,
    "Paul W. S. Anderson": 0.034,
    "Lana Wachowski": 0.676,
    "Denis Villeneuve": 0.631,
    "John Erick Dowdle": -0.417,
    "Zach Cregger": -0.304,
    "Yórgos Lánthimos": 1.596,
    "Vincenzo Natali": -0.044,
    "Alex Garland": 0.751,
    "Coralie Fargeat": 0.101,
    "Sam Raimi": -0.618,
    "봉준호": 1.084,
    "Scott Derrickson": -0.087,
    "Leigh Whannell": 0.429,
    "Fede Álvarez": -0.463,
    "Severin Fiala": 0.007,
    "Jordan Peele": 0.023,
    "Baltasar Kormákur": -0.274
  }
};

// FAVORITE_ACTORS: a differenza di genreAvg/directorAvg, NON è calcolata dai
// voti — è una preferenza che dichiari tu. Aggiungine/togline quando vuoi:
// basta il cognome o un nome distintivo, il confronto in
// matchedFavoriteActors (cine-core.js) è case-insensitive e cerca per
// sottostringa nel nome completo — "Bale" trova "Christian Bale", "de Armas"
// trova "Ana de Armas". Se nel cast di un titolo compare almeno uno di
// questi nomi, predictQualityScore aggiunge un bonus fisso (ACTOR_BONUS).
export const FAVORITE_ACTORS = [
  "DiCaprio", "Gyllenhaal", "Bale", "McConaughey", "Hardy", "Pitt", "Farrell",
  "Damon", "Murphy", "Fassbender", "Pattinson", "Hartnett", "Skarsgård",
  "Ferguson", "Sweeney", "Taylor-Joy", "de Armas"
];
