const fallbackCatalog = [
  {
    title: "Cube",
    type: "film",
    mood: ["teso", "claustrofobico", "psicologico"],
    genres: ["horror", "thriller", "sci-fi"],
    runtime: 90
  },
  {
    title: "The Thing",
    type: "film",
    mood: ["teso", "paranoico", "horror"],
    genres: ["horror", "sci-fi"],
    runtime: 109
  },
  {
    title: "Alien",
    type: "film",
    mood: ["teso", "claustrofobico", "dark"],
    genres: ["horror", "sci-fi", "thriller"],
    runtime: 117
  },
  {
    title: "Event Horizon",
    type: "film",
    mood: ["dark", "teso", "disturbante"],
    genres: ["horror", "sci-fi"],
    runtime: 96
  },
  {
    title: "Pandorum",
    type: "film",
    mood: ["teso", "dark", "adrenalinico"],
    genres: ["horror", "sci-fi", "thriller"],
    runtime: 108
  },
  {
    title: "The Descent",
    type: "film",
    mood: ["teso", "claustrofobico", "survival"],
    genres: ["horror", "thriller"],
    runtime: 99
  },
  {
    title: "Annihilation",
    type: "film",
    mood: ["strano", "riflessivo", "dark"],
    genres: ["sci-fi", "thriller", "horror"],
    runtime: 115
  },
  {
    title: "Sunshine",
    type: "film",
    mood: ["teso", "epico", "riflessivo"],
    genres: ["sci-fi", "thriller"],
    runtime: 107
  },
  {
    title: "Upgrade",
    type: "film",
    mood: ["adrenalinico", "teso", "dark"],
    genres: ["sci-fi", "thriller"],
    runtime: 100
  },
  {
    title: "Coherence",
    type: "film",
    mood: ["psicologico", "strano", "teso"],
    genres: ["sci-fi", "thriller"],
    runtime: 89
  },
  {
    title: "The Void",
    type: "film",
    mood: ["dark", "disturbante", "horror"],
    genres: ["horror", "sci-fi"],
    runtime: 90
  },
  {
    title: "Possessor",
    type: "film",
    mood: ["disturbante", "dark", "psicologico"],
    genres: ["horror", "sci-fi", "thriller"],
    runtime: 103
  },
  {
    title: "Black Mirror",
    type: "serie",
    mood: ["dark", "psicologico", "riflessivo"],
    genres: ["sci-fi", "thriller"],
    runtime: 60
  },
  {
    title: "Love, Death & Robots",
    type: "serie",
    mood: ["strano", "adrenalinico", "dark"],
    genres: ["sci-fi", "horror"],
    runtime: 20
  },
  {
    title: "The Haunting of Hill House",
    type: "serie",
    mood: ["dark", "psicologico", "emotivo"],
    genres: ["horror", "thriller"],
    runtime: 55
  }
];

const durationSelect =
  document.getElementById("duration") ||
  document.getElementById("time") ||
  document.querySelector('select[name="duration"]');

const moodSelect =
  document.getElementById("mood") ||
  document.querySelector('select[name="mood"]');

const typeSelect =
  document.getElementById("type") ||
  document.querySelector('select[name="type"]');

const recommendationBox =
  document.getElementById("recommendation") ||
  document.getElementById("recommendationText") ||
  document.getElementById("result");

function readStorageArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeTitle(title) {
  return String(title || "").trim().toLowerCase();
}

function normalizeArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => String(x).trim().toLowerCase()).filter(Boolean);
}

function normalizeItem(item) {
  if (typeof item === "string") {
    return {
      title: item,
      type: "film",
      mood: [],
      genres: [],
      runtime: 100,
      watched: false
    };
  }

  return {
    title: item.title || item.name || "Titolo sconosciuto",
    type: String(item.type || item.category || "film").toLowerCase(),
    mood: normalizeArray(item.mood),
    genres: normalizeArray(item.genres),
    runtime: Number(item.runtime || item.duration || 100),
    watched: Boolean(item.watched)
  };
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getDurationValue() {
  return (durationSelect?.value || "").toLowerCase();
}

function getMoodValue() {
  return (moodSelect?.value || "").toLowerCase();
}

function getTypeValue() {
  return (typeSelect?.value || "").toLowerCase();
}

function matchesDuration(item, selectedDuration) {
  if (!selectedDuration || selectedDuration.includes("qualsiasi")) return true;

  const runtime = Number(item.runtime || 0);

  if (
    selectedDuration.includes("2 ore") ||
    selectedDuration.includes("circa 2 ore")
  ) {
    return runtime >= 90 && runtime <= 135;
  }

  if (
    selectedDuration.includes("90") ||
    selectedDuration.includes("1h30") ||
    selectedDuration.includes("1 ora e mezza")
  ) {
    return runtime <= 100;
  }

  if (
    selectedDuration.includes("breve") ||
    selectedDuration.includes("corto")
  ) {
    return runtime <= 95;
  }

  if (
    selectedDuration.includes("lungo") ||
    selectedDuration.includes("oltre 2 ore")
  ) {
    return runtime > 120;
  }

  return true;
}

function matchesMood(item, selectedMood) {
  if (!selectedMood || selectedMood.includes("qualsiasi")) return true;

  const allTags = [...(item.mood || []), ...(item.genres || [])];
  return allTags.some(tag => tag.includes(selectedMood));
}

function matchesType(item, selectedType) {
  if (!selectedType || selectedType.includes("film o serie")) return true;
  if (selectedType.includes("film")) return item.type === "film";
  if (selectedType.includes("serie")) return item.type === "serie";
  return true;
}

function countPreferences(items) {
  const genreCount = {};
  const moodCount = {};
  const typeCount = {};

  items.forEach(item => {
    (item.genres || []).forEach(g => {
      genreCount[g] = (genreCount[g] || 0) + 1;
    });

    (item.mood || []).forEach(m => {
      moodCount[m] = (moodCount[m] || 0) + 1;
    });

    if (item.type) {
      typeCount[item.type] = (typeCount[item.type] || 0) + 1;
    }
  });

  return { genreCount, moodCount, typeCount };
}

function getUserTasteProfile() {
  const watchlist = readStorageArray("watchlist").map(normalizeItem);
  const watched = readStorageArray("watched").map(normalizeItem);

  const tasteSource = [...watchlist, ...watched];
  return countPreferences(tasteSource);
}

function scoreItem(item, profile, selectedMood, selectedType, sourceLabel) {
  let score = 0;

  (item.genres || []).forEach(g => {
    score += (profile.genreCount[g] || 0) * 3;
  });

  (item.mood || []).forEach(m => {
    score += (profile.moodCount[m] || 0) * 2;
  });

  if (item.type) {
    score += (profile.typeCount[item.type] || 0) * 1.5;
  }

  if (selectedMood) {
    const tags = [...(item.mood || []), ...(item.genres || [])];
    if (tags.some(tag => tag.includes(selectedMood))) {
      score += 6;
    }
  }

  if (selectedType) {
    if (
      (selectedType.includes("film") && item.type === "film") ||
      (selectedType.includes("serie") && item.type === "serie")
    ) {
      score += 4;
    }
  }

  if (sourceLabel === "watchlist") {
    score += 5;
  }

  score += Math.random() * 0.8;

  return score;
}

function getCandidatePool() {
  const watchlist = readStorageArray("watchlist").map(normalizeItem);
  const watched = readStorageArray("watched").map(normalizeItem);

  const watchedTitles = new Set(
    watched.map(item => normalizeTitle(item.title))
  );

  const watchlistCandidates = watchlist
    .filter(item => !watchedTitles.has(normalizeTitle(item.title)) && !item.watched)
    .map(item => ({ ...item, sourceLabel: "watchlist" }));

  const fallbackCandidates = fallbackCatalog
    .map(normalizeItem)
    .filter(item => !watchedTitles.has(normalizeTitle(item.title)))
    .filter(item => !watchlistCandidates.some(w => normalizeTitle(w.title) === normalizeTitle(item.title)))
    .map(item => ({ ...item, sourceLabel: "catalogo" }));

  return uniqueByTitle([...watchlistCandidates, ...fallbackCandidates]);
}

function formatDuration(item) {
  return item.type === "film"
    ? `${item.runtime} min`
    : `${item.runtime} min a episodio`;
}

function sourceText(sourceLabel) {
  return sourceLabel === "watchlist"
    ? "dalla tua watchlist"
    : "dal catalogo in base ai tuoi gusti";
}

function buildRecommendationsHTML(recommendations) {
  const intro = `<strong>I 5 consigli più adatti a te:</strong><br><br>`;

  const lines = recommendations.map((item, index) => {
    return `${index + 1}. <strong>${item.title}</strong> (${item.type}, ${formatDuration(item)}) — ${sourceText(item.sourceLabel)}`;
  });

  return intro + lines.join("<br>");
}

function recommendTitle() {
  if (!recommendationBox) {
    alert("Non trovo il box del risultato. Controlla l'id dell'elemento nel file HTML.");
    return;
  }

  const selectedDuration = getDurationValue();
  const selectedMood = getMoodValue();
  const selectedType = getTypeValue();

  const profile = getUserTasteProfile();
  const pool = getCandidatePool();

  if (!pool.length) {
    recommendationBox.innerHTML =
      "Non ho trovato titoli disponibili. Aggiungi qualcosa alla watchlist oppure rimuovi qualche visto.";
    return;
  }

  let filtered = pool.filter(item =>
    matchesDuration(item, selectedDuration) &&
    matchesMood(item, selectedMood) &&
    matchesType(item, selectedType)
  );

  if (!filtered.length) {
    filtered = pool.filter(item => matchesType(item, selectedType));
  }

  if (!filtered.length) {
    filtered = pool;
  }

  const scored = filtered
    .map(item => ({
      ...item,
      score: scoreItem(item, profile, selectedMood, selectedType, item.sourceLabel)
    }))
    .sort((a, b) => b.score - a.score);

  const top5 = scored.slice(0, 5);

  if (!top5.length) {
    recommendationBox.innerHTML =
      "Non sono riuscito a trovare consigli adatti. Prova a cambiare i filtri.";
    return;
  }

  recommendationBox.innerHTML = buildRecommendationsHTML(top5);
}

window.recommendTitle = recommendTitle;
window.recommend = recommendTitle;