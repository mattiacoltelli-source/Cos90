function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mediaLabel(item) {
  return item.media_type === "movie" ? "Film" : "Serie TV";
}

function mediaBadgeClass(item) {
  return item.media_type === "movie" ? "badge-film" : "badge-series";
}

function decadeOf(year) {
  if (!year || year === "—" || isNaN(Number(year))) return "Sconosciuta";
  return `${Math.floor(Number(year) / 10) * 10}s`;
}

function formatReleaseDate(dateStr) {
  if (!dateStr) return "n.d.";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

function rawNumberToFixed(value, digits = 1, fallback = "n.d.") {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num.toFixed(digits) : fallback;
}

function showToast(message, type = "info", title = "") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const heading = title || (
    type === "success" ? "Fatto" :
    type === "error" ? "Attenzione" :
    "Info"
  );

  toast.innerHTML = `
    <div class="toast__icon">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</div>
    <div>
      <div class="toast__title">${escapeHtml(heading)}</div>
      <div class="toast__text">${escapeHtml(message)}</div>
    </div>
  `;

  wrap.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 260);
  }, 2800);
}

let _lastHapticAt = 0;
function haptic(pattern = 10) {
  const now = Date.now();
  if (now - _lastHapticAt < 60) return;
  _lastHapticAt = now;

  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

function animateValue(el, target, duration = 600) {
  if (!el) return;

  const end = Number(target) || 0;
  const current = Number(el.dataset.currentValue || 0);

  if (current === end) {
    el.textContent = String(end);
    return;
  }

  const start = current;
  const startTime = performance.now();

  function tick(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    const value = Math.round(start + (end - start) * e);

    el.textContent = String(value);
    el.dataset.currentValue = String(value);

    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(end);
      el.dataset.currentValue = String(end);
    }
  }

  requestAnimationFrame(tick);
}

function animateStats(seen, watch, movies, series) {
  animateValue(document.getElementById("statSeen"), seen);
  animateValue(document.getElementById("statWatch"), watch);
  animateValue(document.getElementById("statMovies"), movies);
  animateValue(document.getElementById("statSeries"), series);
}

function animateBarGroups() {
  const bars = document.querySelectorAll("#screen-stats .bar__fill[data-width]");
  if (!bars.length) return;

  bars.forEach(bar => {
    bar.style.width = "0%";
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bars.forEach((bar, index) => {
        setTimeout(() => {
          bar.style.width = `${bar.dataset.width}%`;
        }, index * 70);
      });
    });
  });
}

const SCREENS = {};
let _previousScreen = "home";

function initScreens() {
  ["home", "library", "stats", "tonight", "backup", "detail"].forEach(name => {
    const el = document.getElementById(`screen-${name}`);
    if (el) {
      SCREENS[name] = el;
    } else {
      console.warn("Screen mancante:", name);
    }
  });
}

function switchScreen(name) {
  if (!SCREENS[name]) return;
  if (name !== "detail") _previousScreen = name;

  Object.values(SCREENS).forEach(screen => {
    screen.classList.add("hidden");
    screen.classList.remove("screen-enter");
  });

  SCREENS[name].classList.remove("hidden");

  requestAnimationFrame(() => {
    SCREENS[name].classList.add("screen-enter");
  });

  document.querySelectorAll(".nav__btn[data-screen]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });

  const currentState = history.state;
  if (name === "home") {
    history.replaceState({ screen: "home" }, "");
  } else if (!currentState || currentState.screen !== name) {
    history.pushState({ screen: name }, "");
  }
}

function getPreviousScreen() {
  return _previousScreen;
}

function renderShelf(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = items.map(item => `
    <div class="shelf-card open-stored-detail" data-key="${item.media_type}_${item.id}">
      <div class="shelf-card__poster" style="background-image:url('${posterUrl(item.poster_path)}')">
        <span class="badge ${mediaBadgeClass(item)}">${mediaLabel(item)}</span>
        ${item.vote ? `<span class="shelf-card__vote">★ ${escapeHtml(item.vote)}</span>` : ""}
      </div>
      <div class="shelf-card__info">
        <div class="shelf-card__title">${escapeHtml(item.title)}</div>
        <div class="shelf-card__meta">${item.year}</div>
      </div>
    </div>
  `).join("");
}

function renderSearchResults(items, db) {
  return items.map(item => {
    const n = normalizedItem(item);
    const key = `${n.media_type}_${n.id}`;
    const seen = !!db.seen.find(x => `${x.media_type}_${x.id}` === key);
    const watch = !!db.watchlist.find(x => `${x.media_type}_${x.id}` === key);

    return `
      <div class="poster-card">
        <div class="poster-card__img" style="background-image:url('${posterUrl(n.poster_path)}')">
          <span class="badge ${mediaBadgeClass(n)}">${mediaLabel(n)}</span>
          <div class="poster-card__overlay">
            <button class="btn btn--icon action-seen" data-id="${n.id}" data-type="${n.media_type}">
              ${seen ? "✓ Visto" : "+ Visto"}
            </button>
            <button class="btn btn--icon action-watch" data-id="${n.id}" data-type="${n.media_type}">
              ${watch ? "★ Lista" : "♡ Lista"}
            </button>
          </div>
        </div>
        <div class="poster-card__info">
          <div class="poster-card__title">${escapeHtml(n.title)}</div>
          <div class="poster-card__meta">${n.year} · ${mediaLabel(n)}</div>
          <button class="btn btn--ghost btn--sm action-details" data-id="${n.id}" data-type="${n.media_type}">
            Scheda →
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderLibraryList(items, mode) {
  return items.map(item => `
    <div class="list-item">
      <div class="list-item__thumb" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="list-item__body">
        <div class="list-item__title">${escapeHtml(item.title)}</div>
        <div class="list-item__meta">${item.year} · ${mediaLabel(item)}</div>

        <div class="chip-row">
          ${item.genre_names?.[0] ? `<span class="chip">${escapeHtml(item.genre_names[0])}</span>` : ""}
          ${item.director && item.media_type === "movie" ? `<span class="chip chip--director">🎬 ${escapeHtml(item.director)}</span>` : ""}
          ${item.vote ? `<span class="chip chip--vote">★ ${escapeHtml(item.vote)}</span>` : ""}
        </div>

        ${item.comment ? `<div class="list-item__comment">"${escapeHtml(item.comment).slice(0, 60)}${item.comment.length > 60 ? "…" : ""}"</div>` : ""}

        <div class="list-item__actions">
          ${mode === "watch" ? `<button class="btn btn--ok btn--sm move-watch-seen" data-key="${item.media_type}_${item.id}">✓ Visto</button>` : ""}
          <button class="btn btn--ghost btn--sm open-stored-detail" data-key="${item.media_type}_${item.id}">Scheda</button>
          <button class="btn btn--danger btn--sm ${mode === "watch" ? "remove-watch" : "remove-seen"}" data-key="${item.media_type}_${item.id}">✕</button>
        </div>
      </div>
    </div>
  `).join("");
}

function renderGenreFilters(genres, activeGenre) {
  const titleEl = document.getElementById("genreFiltersTitle");
  const filterEl = document.getElementById("libraryGenreFilters");
  if (!titleEl || !filterEl) return;

  if (!genres.length) {
    filterEl.innerHTML = "";
    filterEl.classList.add("hidden");
    titleEl.classList.add("hidden");
    return;
  }

  titleEl.classList.remove("hidden");
  filterEl.classList.remove("hidden");

  filterEl.innerHTML = `
    <button class="filter-pill ${activeGenre === "all" ? "active" : ""}" data-genre-filter="all">Tutti</button>
    ${genres.map(g => `
      <button class="filter-pill ${activeGenre === g ? "active" : ""}" data-genre-filter="${escapeHtml(g)}">
        ${escapeHtml(g)}
      </button>
    `).join("")}
  `;
}

function renderGenreBars(entries) {
  const container = document.getElementById("genreBars");
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `<p class="empty-hint">Salva almeno 3 titoli visti.</p>`;
    return;
  }

  const max = entries[0].value || 1;

  container.innerHTML = entries.map(entry => `
    <div class="bar-row">
      <div class="bar-row__label">
        <span class="bar-row__name">${escapeHtml(entry.label)}</span>
        <span class="bar-row__count">${entry.value}</span>
      </div>
      <div class="bar-track">
        <div class="bar__fill" data-width="${Math.max(8, (entry.value / max) * 100).toFixed(1)}"></div>
      </div>
    </div>
  `).join("");
}

const MEDALS = [
  { icon:"🥇", cls:"gold" },
  { icon:"🥈", cls:"silver" },
  { icon:"🥉", cls:"bronze" }
];

function renderPodium(podiumEl, items, typeLabel) {
  if (!podiumEl) return;

  if (!items.length) {
    podiumEl.innerHTML = `<p class="empty-hint">Vota alcuni titoli per vedere il podio.</p>`;
    return;
  }

  podiumEl.innerHTML = items.map((item, i) => `
    <div class="podium-card podium-card--${MEDALS[i].cls} open-stored-detail" data-key="${item.media_type}_${item.id}">
      <div class="podium-card__medal">${MEDALS[i].icon}</div>
      <div class="podium-card__poster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="podium-card__title">${escapeHtml(item.title)}</div>
      <div class="podium-card__meta">${escapeHtml(item.year)} · ${typeLabel}</div>
      <div class="podium-card__vote">★ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");
}

function renderRankingList(listEl, items, offset, typeLabel) {
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = `<p class="empty-hint">Aggiungi altri voti per completare la classifica.</p>`;
    return;
  }

  listEl.innerHTML = items.map((item, i) => `
    <div class="rank-row open-stored-detail" data-key="${item.media_type}_${item.id}">
      <div class="rank-row__pos">${i + offset}</div>
      <div class="rank-row__poster" style="background-image:url('${posterUrl(item.poster_path)}')"></div>
      <div class="rank-row__info">
        <div class="rank-row__title">${escapeHtml(item.title)}</div>
        <div class="rank-row__meta">${escapeHtml(item.year)} · ${typeLabel}</div>
      </div>
      <div class="rank-row__vote">★ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");
}

function renderTonightFive(entries, note) {
  const noteHtml = note ? `<p class="tonight__note">${escapeHtml(note)}</p>` : "";

  return `
    ${noteHtml}
    <div class="tonight-list">
      ${entries.map(({ item, affinity, reasons }) => `
        <div class="tonight-card open-tonight-detail" data-id="${item.id}" data-type="${item.media_type}">
          <div class="tonight-card__poster" style="background-image:url('${posterUrl(item.poster_path)}')">
            <div class="tonight-card__affinity">${affinity}%</div>
          </div>
          <div class="tonight-card__body">
            <div class="tonight-card__title">${escapeHtml(item.title)}</div>
            <div class="tonight-card__meta">${escapeHtml(item.year)} · ${mediaLabel(item)} · ★ ${rawNumberToFixed(item.vote_average, 1)}</div>
            ${reasons.length ? `<div class="tonight-card__reason">🎯 ${escapeHtml(reasons.join(" · "))}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDiscoverResult(chosen, whyBits, rating, fallbackNote) {
  const poster = chosen.poster_path
    ? `<div class="discover-poster" style="background-image:url('${posterUrl(chosen.poster_path)}')"></div>`
    : "";

  const extra = fallbackNote ? ` ${escapeHtml(fallbackNote)}` : "";

  return `
    <div class="discover-result">
      ${poster}
      <div class="discover-result__body">
        <div class="discover-result__title">✨ ${escapeHtml(chosen.title)}</div>
        <div class="discover-result__meta">${chosen.year} · ${mediaLabel(chosen)} · ★ ${rating}/10</div>
        <div class="discover-result__why">Scelto perché ${escapeHtml(whyBits.join(", "))}.${extra}</div>
      </div>
    </div>
  `;
}

function renderClassicResult(pick, voto, commento) {
  return `
    <div class="classic-result">
      <div class="classic-result__poster" style="background-image:url('${posterUrl(pick.poster_path)}')"></div>
      <div class="classic-result__body">
        <div class="classic-result__title">⭐ ${escapeHtml(pick.title)}</div>
        <div class="classic-result__meta">${pick.year} · ${mediaLabel(pick)} · tuo voto: ${escapeHtml(voto)}</div>
        <div class="classic-result__why">${escapeHtml(commento)}</div>
      </div>
    </div>
  `;
}

function renderDetailFacts(source, isSeen, isWatch) {
  const facts = [
    mediaLabel(source),
    source.year,
    source.genre_names?.length ? source.genre_names.join(", ") : null,
    source.director && source.media_type === "movie" ? `Regia: ${source.director}` : null,
    source.release_date && source.media_type === "movie" ? `Uscita: ${formatReleaseDate(source.release_date)}` : null,
    isSeen ? "✓ Visto" : isWatch ? "★ In watchlist" : "Non salvato"
  ].filter(Boolean);

  return facts.map(f => `<span class="detail-fact">${escapeHtml(f)}</span>`).join("");
}