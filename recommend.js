function getRecommendedMovies() {
  const box = document.getElementById("tonightSuggestion");

  if (!window.db || !Array.isArray(window.db.seen) || !Array.isArray(window.db.watchlist)) {
    box.innerHTML = "Database non disponibile.";
    return;
  }

  if (window.db.seen.length < 2) {
    box.innerHTML = "Segna almeno 2 titoli come visti per ottenere consigli.";
    return;
  }

  if (!window.db.watchlist.length) {
    box.innerHTML = "Aggiungi prima qualche titolo alla watchlist.";
    return;
  }

  const genreCount = {};

  window.db.seen.forEach(item => {
    (item.genre_names || []).forEach(genre => {
      genreCount[genre] = (genreCount[genre] || 0) + 1;
    });
  });

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(entry => entry[0]);

  const recommended = window.db.watchlist
    .map(item => {
      let score = 0;
      (item.genre_names || []).forEach(genre => {
        if (topGenres.includes(genre)) score++;
      });
      return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!recommended.length) {
    box.innerHTML = "Non ho trovato consigli compatibili nella tua watchlist.";
    return;
  }

  box.innerHTML =
    "<strong>Consigli per te:</strong><br><br>" +
    recommended.map(item => "• " + item.title).join("<br>");
}