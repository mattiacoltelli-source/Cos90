// Sistema consigli automatici CineTracker
// Basato sui titoli visti, sui generi più frequenti
// Esclude automaticamente film già visti e in watchlist

async function getRecommendedMovies() {
  const seen = db.seen || [];
  const watchlist = db.watchlist || [];

  if (seen.length < 3) {
    alert("Guarda almeno 3 titoli per avere consigli personalizzati.");
    return;
  }

  // Conta i generi dei titoli visti
  const genreCount = {};

  seen.forEach(item => {
    if (Array.isArray(item.genre_names)) {
      item.genre_names.forEach(g => {
        if (!g) return;
        genreCount[g] = (genreCount[g] || 0) + 1;
      });
    }
  });

  // Se non ci sono generi salvati, fermati
  if (!Object.keys(genreCount).length) {
    alert("Non ci sono ancora abbastanza dati sui generi. Aggiungi nuovi titoli ai visti.");
    return;
  }

  // Trova i 2 generi principali
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);

  // Converte i nomi dei generi negli ID TMDB
  const genreIds = Object.entries(GENRE_MAP)
    .filter(([id, name]) => topGenres.includes(name))
    .map(([id]) => id)
    .join(",");

  if (!genreIds) {
    alert("Non riesco ancora a convertire i tuoi generi preferiti in consigli.");
    return;
  }

  // Costruisce URL TMDB
  const url = `${BASE_URL}/discover/movie?api_key=${API_KEY}&language=it-IT&with_genres=${genreIds}&sort_by=popularity.desc&vote_count.gte=200`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.results || !data.results.length) {
      alert("Non ho trovato consigli adatti in questo momento.");
      return;
    }

    // ID già presenti nella tua libreria
    const seenIds = seen.map(x => x.id);
    const watchIds = watchlist.map(x => x.id);

    // Filtra risultati:
    // - niente già visti
    // - niente già in watchlist
    // - niente film senza poster
    const filtered = data.results.filter(movie => {
      if (seenIds.includes(movie.id)) return false;
      if (watchIds.includes(movie.id)) return false;
      if (!movie.poster_path) return false;
      return true;
    });

    const movies = filtered.slice(0, 5);

    if (!movies.length) {
      alert("Per ora non ho trovato nuovi consigli: prova dopo aver aggiunto altri titoli.");
      return;
    }

    showRecommendations(movies, topGenres);

  } catch (error) {
    console.error("Errore consigli:", error);
    alert("Errore nel recupero dei consigli.");
  }
}

function showRecommendations(movies, topGenres) {
  const container = document.getElementById("results");
  const resultCount = document.getElementById("resultCount");
  const resultsEmpty = document.getElementById("resultsEmpty");

  if (resultsEmpty) {
    resultsEmpty.classList.add("hidden");
  }

  if (resultCount) {
    resultCount.textContent = `5 consigli per te`;
  }

  container.innerHTML = movies.map(movie => {
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "—";

    return `
      <div class="posterCard">
        <div class="poster" style="background-image:url('${IMG}${movie.poster_path}')">
          <div class="badge">Consigliato</div>
        </div>
        <div class="posterInfo">
          <div class="posterTitle">${escapeHtml(movie.title)}</div>
          <div class="meta">${year} · In base a: ${escapeHtml(topGenres.join(" / "))}</div>
          <div class="actions">
            <button class="small ok action-seen" data-id="${movie.id}" data-type="movie">Visto</button>
            <button class="small secondary action-watch" data-id="${movie.id}" data-type="movie">Watchlist</button>
            <button class="small secondary action-details" data-id="${movie.id}" data-type="movie">Dettagli</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Torna automaticamente alla Home per vedere i consigli
  if (typeof switchScreen === "function") {
    switchScreen("home");
  }

  // Scroll in alto ai risultati
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}