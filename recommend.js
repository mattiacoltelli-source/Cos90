document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("personal-recs-btn");
  const output = document.getElementById("personal-recs-output");

  if (!btn) return;

  btn.addEventListener("click", () => {

    const raw = localStorage.getItem("cinetracker_library");
    const library = raw ? JSON.parse(raw) : [];

    if (!library.length) {
      output.innerHTML = "Non ho abbastanza dati per consigliarti qualcosa.";
      return;
    }

    const seen = library.filter(x => x.watched === true);
    const unseen = library.filter(x => !x.watched);

    if (!seen.length) {
      output.innerHTML = "Segna prima qualche film come visto.";
      return;
    }

    const genreScore = {};

    seen.forEach(item => {
      if (!item.genre) return;

      const genres = item.genre.split(",");

      genres.forEach(g => {
        const clean = g.trim();
        genreScore[clean] = (genreScore[clean] || 0) + 1;
      });
    });

    const topGenres = Object.entries(genreScore)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(x=>x[0]);

    const suggestions = unseen
      .map(item => {

        if (!item.genre) return null;

        const genres = item.genre.split(",");
        let score = 0;

        genres.forEach(g=>{
          if(topGenres.includes(g.trim())) score++;
        });

        return { ...item, score };

      })
      .filter(x => x && x.score > 0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,5);

    if (!suggestions.length) {
      output.innerHTML = "Non ho trovato consigli compatibili.";
      return;
    }

    output.innerHTML =
      "<strong>Consigliati per te:</strong><br><br>" +
      suggestions.map(x=>"• "+x.title).join("<br>");

  });

});