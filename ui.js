import {
  escapeHtml, mediaLabel, mediaBadgeClass, decadeOf,
  formatReleaseDate, rawNumberToFixed, posterUrl, uniqueKey, normalizedItem
} from "./cine-core.js?v=4b9c63b";

export function showToast(message, type = "info", title = "") {
  const wrap = document.getElementById("toastWrap");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const heading = title || (type === "success" ? "Fatto" : type === "error" ? "Attenzione" : "Info");

  toast.innerHTML = `
    <div class="toast__icon">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</div>
    <div>
      <div class="toast__title">${escapeHtml(heading)}</div>
      <div class="toast__text">${escapeHtml(message)}</div>
    </div>
  `;

  wrap.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 260);
  }, 2800);
}

let _lastHapticAt = 0;
export function haptic(pattern = 10) {
  const now = Date.now();
  if (now - _lastHapticAt < 60) return;
  _lastHapticAt = now;
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

let animateValueCounter = 0;

export function animateValue(el, target, duration = 600) {
  const end = Number(target) || 0;

  // Se lo schermo che contiene il numero è nascosto (es. animazione lanciata
  // all'avvio, prima che l'utente apra la tab Statistiche), non c'è nulla da
  // mostrare: fissiamo subito il valore finale ma NON lo segnamo come "già
  // animato", così la prima volta che la schermata diventa visibile davvero
  // il conteggio riparte da zero invece di comparire già fermo.
  if (el.offsetParent === null) {
    el.textContent = String(end);
    delete el.dataset.currentValue;
    return;
  }

  const current = Number(el.dataset.currentValue || 0);

  if (current === end) {
    el.textContent = String(end);
    return;
  }

  // Chiamata due volte di fila sullo stesso elemento prima che
  // l'animazione precedente (600ms) sia finita, senza cancellarla: i due
  // loop rAF giravano in parallelo, e quello partito per primo poteva
  // comunque arrivare per ultimo e "vincere", lasciando a video il target
  // vecchio invece di quello nuovo. animId etichetta ogni chiamata: un
  // tick() il cui id non è più quello corrente per l'elemento si ferma da
  // solo, silenziosamente.
  const animId = ++animateValueCounter;
  el._animId = animId;

  const start = current;
  const startTime = performance.now();

  function tick(now) {
    if (el._animId !== animId) return;
    const p = Math.min((now - startTime) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    const v = Math.round(start + (end - start) * e);
    el.textContent = String(v);
    el.dataset.currentValue = String(v);

    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(end);
      el.dataset.currentValue = String(end);
    }
  }

  requestAnimationFrame(tick);
}

export function animateStats(seen, watch, movies, series) {
  animateValue(document.getElementById("statSeen"), seen);
  animateValue(document.getElementById("statWatch"), watch);
  animateValue(document.getElementById("statMovies"), movies);
  animateValue(document.getElementById("statSeries"), series);
}

// Riporta le barre a 0% e le rilancia scaglionate a ogni render: la
// transizione CSS da sola non riparte se la larghezza finale è la stessa.
export function animateBarGroups() {
  const bars = document.querySelectorAll("#screen-stats .bar__fill[data-width]");
  if (!bars.length) return;

  bars.forEach(bar => {
    bar.style.width = "0%";
  });

  // Forza un reflow sincrono tra lo stato a 0% e quello finale: con il solo
  // doppio requestAnimationFrame il browser a volte unisce le due modifiche
  // nello stesso frame e salta la transizione (è quello che succedeva
  // rientrando una seconda volta nella tab Statistiche).
  void bars[0].offsetWidth;

  bars.forEach((bar, i) => {
    setTimeout(() => {
      bar.style.width = `${bar.dataset.width}%`;
    }, i * 70);
  });
}

export const SCREENS = {};
let _previousScreen = "home";

export function initScreens() {
  ["home","library","stats","tonight","backup","report","detail"].forEach(name => {
    SCREENS[name] = document.getElementById(`screen-${name}`);
  });
}

export function switchScreen(name) {
  if (name !== "detail") _previousScreen = name;

  Object.values(SCREENS).forEach(screen => {
    screen.classList.add("hidden");
    screen.classList.remove("screen-enter");
  });

  SCREENS[name].classList.remove("hidden");
  requestAnimationFrame(() => SCREENS[name].classList.add("screen-enter"));

  document.querySelectorAll(".nav__btn[data-screen]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.screen === name);
  });

  const cur = history.state;
  if (name === "home") {
    history.replaceState({ screen:"home" }, "");
  } else if (!cur || cur.screen !== name) {
    history.pushState({ screen:name }, "");
  }

  return _previousScreen;
}

export function getPreviousScreen() {
  return _previousScreen;
}

export function renderShelf(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = items.map((item, i) => {
    const src = posterUrl(item.poster_path, "w342");
    // Le prime card sono visibili subito (shelf orizzontale sopra la piega):
    // caricamento eager e priorità alta perché una di queste è tipicamente
    // il Largest Contentful Paint della home. Le altre restano lazy.
    const img = src
      ? `<img class="shelf-card__poster-img" src="${escapeHtml(src)}" alt=""
           loading="${i < 3 ? "eager" : "lazy"}" fetchpriority="${i < 3 ? "high" : "auto"}" decoding="async"
           onerror="this.style.display='none'">`
      : "";
    return `
    <div class="shelf-card open-stored-detail" data-key="${uniqueKey(item)}">
      <div class="shelf-card__poster">
        ${img}
        <span class="badge ${mediaBadgeClass(item)}">${mediaLabel(item)}</span>
        ${item.vote ? `<span class="shelf-card__vote">★ ${escapeHtml(item.vote)}</span>` : ""}
      </div>
      <div class="shelf-card__info">
        <div class="shelf-card__title">${escapeHtml(item.title)}</div>
        <div class="shelf-card__meta">${escapeHtml(item.year)}</div>
      </div>
    </div>
  `;
  }).join("");
}

export function renderSearchResults(items, db) {
  return items.map(item => {
    const n = normalizedItem(item);
    const seen = !!db.seen.find(x => uniqueKey(x) === uniqueKey(n));
    const watch = !!db.watchlist.find(x => uniqueKey(x) === uniqueKey(n));
    const inLibrary = seen || watch;

    return `
      <div class="poster-card">
        <div class="poster-card__img" style="background-image:url('${escapeHtml(posterUrl(n.poster_path))}')">
          <span class="badge ${mediaBadgeClass(n)}">${mediaLabel(n)}</span>
          ${inLibrary
            ? `<span class="poster-card__tag open-stored-detail" data-key="${uniqueKey(n)}">✓ Già in libreria · tocca per votare</span>`
            : `
              <div class="poster-card__actions">
                <button class="poster-btn poster-btn--watch action-watch" data-id="${n.id}" data-type="${n.media_type}">♡ Lista</button>
                <button class="poster-btn poster-btn--seen action-seen" data-id="${n.id}" data-type="${n.media_type}">✓ Visto</button>
              </div>
            `}
        </div>

        <div class="poster-card__info">
          <div class="poster-card__title">${escapeHtml(n.title)}</div>
          <div class="poster-card__meta">${escapeHtml(n.year)} · ${mediaLabel(n)}</div>
          ${!inLibrary ? `<button class="poster-card__scheda action-details" data-id="${n.id}" data-type="${n.media_type}">Scheda →</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

export function renderLibraryList(items, mode) {
  return items.map(item => `
    <div class="list-item open-stored-detail" data-key="${uniqueKey(item)}">
      <div class="list-item__thumb" style="background-image:url('${escapeHtml(posterUrl(item.poster_path))}')">
        <span class="badge ${mediaBadgeClass(item)}">${mediaLabel(item)}</span>
      </div>

      <div class="list-item__body">
        <div class="list-item__title">${escapeHtml(item.title)}</div>
        <div class="list-item__meta">${escapeHtml(item.year)} · ${mediaLabel(item)}</div>

        <div class="chip-row">
          <span class="chip chip--status ${mode === "watch" ? "" : "chip--seen"}">${mode === "watch" ? "♡ In watchlist" : "✓ Visto"}</span>
          ${item.genre_names?.length ? item.genre_names.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join("") : ""}
          ${item.director && item.media_type === "movie" ? `<span class="chip">🎬 ${escapeHtml(item.director)}</span>` : ""}
          ${item.vote ? `<span class="chip chip--vote">★ ${escapeHtml(item.vote)}</span>` : ""}
        </div>

        ${item.comment ? `<div class="list-item__comment">"${escapeHtml(item.comment).slice(0,60)}${item.comment.length > 60 ? "…" : ""}"</div>` : ""}
      </div>
    </div>
  `).join("");
}

export function renderGenreFilters(genres, activeGenre) {
  const titleEl = document.getElementById("genreFiltersTitle");
  const filterEl = document.getElementById("libraryGenreFilters");

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

// Vista "Barre": la lettura riga per riga degli stessi dati delle bolle —
// lunghezza = quanti titoli, ★ accanto = media voto. Resta la vista più
// precisa da leggere; le bolle sono quella più d'impatto.
export function renderGenreBars(entries) {
  const container = document.getElementById("genreBars");

  if (!entries.length) {
    container.innerHTML = `<p class="empty-hint">Salva almeno 3 titoli visti.</p>`;
    return;
  }

  const max = entries[0].value || 1;

  container.innerHTML = entries.map(entry => {
    const formattedAvg = entry.avgVote && Number.isFinite(entry.avgVote)
      ? entry.avgVote.toFixed(1).replace(".", ",")
      : null;

    const countText = `${entry.value} ${entry.value === 1 ? "titolo" : "titoli"}`;
    const avgHtml = formattedAvg
      ? `<span class="bar-row__avg">★ ${formattedAvg}</span>`
      : "";

    return `
    <div class="bar-row">
      <div class="bar-row__label">
        <span class="bar-row__name">${escapeHtml(entry.label)}</span>
        <span class="bar-row__count">${countText} ${avgHtml}</span>
      </div>
      <div class="bar-track">
        <div class="bar__fill" data-width="${Math.max(8, (entry.value / max) * 100).toFixed(1)}"></div>
      </div>
    </div>
  `;
  }).join("");

  animateBarGroups();
}

// Posizioni in % del riquadro, con la bolla larga il 32% (vedi
// .genre-bubble). Non una griglia regolare: posizioni scelte a mano,
// irregolari e asimmetriche apposta — nessuna formula unica di spaziatura,
// ogni coppia vicina si sovrappone (o si stacca) di un valore diverso,
// mai oltre il 19% circa: abbastanza da leggersi come un gruppo compatto e
// organico, mai una bolla che ne nasconde un'altra.
//
// La coppia di destra di ogni riga (Horror, Azione) arriva alla stessa
// distanza dal bordo destro: nella prima versione una arrivava molto più
// vicina al bordo dell'altra, e il gruppo sembrava spostato a sinistra
// anche se il centro geometrico era quasi giusto — non basta il centroide,
// contano i bordi esterni che l'occhio segue riga per riga.
//
// La pulsazione può quindi far toccare per un attimo anche una coppia che a
// riposo ha un piccolo distacco: non è un problema qui, è parte
// dell'aspetto voluto (bolle vive, non un reticolo fisso) — a differenza
// della disposizione a griglia di prima, dove invece nessuna coppia doveva
// MAI toccarsi ed era necessario un margine di sicurezza calcolato.
const GENRE_BUBBLE_LAYOUT = [
  { left: 3, top: 6 }, { left: 52, top: 3 },
  { left: 23, top: 27 }, { left: 60, top: 30 },
  { left: 6, top: 56 }, { left: 52, top: 54 },
];

// Respiro: un unico impulso morbido (solo scale + un filo di brightness),
// stesso per tutte, sfasato abbastanza (550ms) da una bolla alla successiva
// che non si leggano mai come un blocco unico che pulsa insieme — con 6
// bolle lo sfasamento totale copre più di due terzi del periodo, quindi
// quando una è al picco le altre sono altrove nel loro ciclo: bolle
// indipendenti, non un "turno" scandito né un blocco sincronizzato.
//
// Periodo leggermente diverso per ognuna (4,0s → 4,5s) invece che identico:
// le fasi non tornano mai a coincidere allo stesso modo, quindi il respiro
// non si ripete mai in un pattern perfettamente meccanico — costo zero,
// stessa @keyframes, solo animation-duration diversa.
const GENRE_PULSE_STAGGER_MS = 550;
const GENRE_PULSE_PERIODS_S = [4.0, 4.1, 4.2, 4.3, 4.4, 4.5];

export function renderGenreBubbles(entries) {
  const container = document.getElementById("genreBars");

  if (!entries.length) {
    container.innerHTML = `<p class="empty-hint">Salva almeno 3 titoli visti.</p>`;
    return;
  }

  const GOLD = "#fdd878", BLUE = "#4da3ff", CREAM = "hsl(43,22%,84%)";
  const maxCount = Math.max(...entries.map(d => d.value)) || 1;
  const ratedAvgs = entries.map(d => d.avgVote).filter(v => Number.isFinite(v));
  const minAvg = ratedAvgs.length ? Math.min(...ratedAvgs) : 0;
  const maxAvg = ratedAvgs.length ? Math.max(...ratedAvgs) : 1;
  const avgRange = (maxAvg - minAvg) || 1;

  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "genre-bubbles-wrap";

  entries.forEach((g, i) => {
    const hasAvg = Number.isFinite(g.avgVote);
    const t = hasAvg ? (g.avgVote - minAvg) / avgRange : 0.5;
    const fillPct = Math.round((g.value / maxCount) * 85) + 10;
    const boundary = 92 - t * 80;
    const low = Math.max(0, boundary - 27), high = Math.min(100, boundary + 27);
    const fillGradient = `linear-gradient(to top, ${BLUE} 0%, ${BLUE} ${low.toFixed(1)}%, ${CREAM} ${boundary.toFixed(1)}%, ${GOLD} ${high.toFixed(1)}%, ${GOLD} 100%)`;
    const pos = GENRE_BUBBLE_LAYOUT[i] || { left: (i * 20) % 60, top: (i * 25) % 60 };
    const fillDelay = i * 90;
    const voteText = hasAvg ? `★ ${g.avgVote.toFixed(1).replace(".", ",")}` : "";

    const el = document.createElement("div");
    el.className = "genre-bubble";
    el.style.left = pos.left + "%";
    el.style.top = pos.top + "%";

    const pulseDelay = i * GENRE_PULSE_STAGGER_MS;
    const pulsePeriod = GENRE_PULSE_PERIODS_S[i] || 4.2;
    el.innerHTML = `
      <div class="genre-bubble-breathe" style="animation-delay:-${pulseDelay}ms;animation-duration:${pulsePeriod}s;">
        <div class="genre-bubble-inner">
          <div class="genre-bubble-fill" style="height:${fillPct}%;animation-delay:${fillDelay}ms;">
            <div class="genre-bubble-fill-inner" style="background:${fillGradient};"></div>
          </div>
          <div class="genre-bubble-sheen"></div>
          <div class="genre-bubble-text">
            <div class="name">${escapeHtml(g.label.toUpperCase())}</div>
            <div class="count">${g.value}</div>
            <div class="label">titoli</div>
            ${voteText ? `<div class="vote" style="display:none;">${voteText}</div>` : ""}
          </div>
        </div>
      </div>`;

    if (voteText) {
      el.addEventListener("click", () => {
        const isActive = el.classList.contains("active");
        wrap.querySelectorAll(".genre-bubble.active").forEach(b => {
          b.classList.remove("active");
          const v = b.querySelector(".vote");
          if (v) v.style.display = "none";
        });
        if (!isActive) {
          el.classList.add("active");
          el.querySelector(".vote").style.display = "";
        }
      });
    }

    wrap.appendChild(el);
  });

  container.appendChild(wrap);
}

const MEDALS = [
  { icon:"🥇", cls:"gold", label:"1°" },
  { icon:"🥈", cls:"silver", label:"2°" },
  { icon:"🥉", cls:"bronze", label:"3°" }
];

export function renderPodium(podiumEl, items, typeLabel) {
  if (!items.length) {
    podiumEl.innerHTML = `<p class="empty-hint">Vota alcuni titoli per vedere il podio.</p>`;
    return;
  }

  podiumEl.innerHTML = items.map((item, i) => `
    <div class="podium-card podium-card--${MEDALS[i].cls} open-stored-detail" data-key="${uniqueKey(item)}">
      <div class="podium-card__medal">${MEDALS[i].icon}</div>
      <div class="podium-card__poster" style="background-image:url('${escapeHtml(posterUrl(item.poster_path))}')"></div>
      <div class="podium-card__title">${escapeHtml(item.title)}</div>
      <div class="podium-card__meta">${escapeHtml(item.year)} · ${typeLabel}</div>
      <div class="podium-card__vote">★ ${escapeHtml(item.vote)}</div>
    </div>
  `).join("");
}

// Quante righe restano visibili sotto al podio prima di "Mostra tutti".
const RANKING_LIST_INITIAL = 4;

// Film e serie sono due classifiche distinte, ognuna con il suo bottone e il
// suo stato aperto/chiuso: lo stato sta sull'elemento della lista invece che
// in due variabili di modulo, così aggiungerne una terza non richiede altro.
const _rankingLists = new WeakMap();

function rankRowHtml(item, pos, typeLabel) {
  return `
    <div class="rank-row open-stored-detail" data-key="${uniqueKey(item)}">
      <div class="rank-row__pos">${pos}</div>
      <div class="rank-row__poster" style="background-image:url('${escapeHtml(posterUrl(item.poster_path))}')"></div>
      <div class="rank-row__info">
        <div class="rank-row__title">${escapeHtml(item.title)}</div>
        <div class="rank-row__meta">${escapeHtml(item.year)} · ${typeLabel}</div>
      </div>
      <div class="rank-row__vote">★ ${escapeHtml(item.vote)}</div>
    </div>
  `;
}

function drawRankingRows(listEl, st) {
  const shown = st.expanded ? st.items : st.items.slice(0, RANKING_LIST_INITIAL);
  listEl.innerHTML = shown.map((item, i) => rankRowHtml(item, i + st.offset, st.typeLabel)).join("");

  const btn = st.btn;
  if (!btn) return;

  const hiddenCount = st.items.length - RANKING_LIST_INITIAL;
  if (hiddenCount <= 0) {
    btn.classList.add("hidden");
    return;
  }

  btn.classList.remove("hidden");
  btn.classList.toggle("is-up", st.expanded);
  btn.querySelector(".rank-expand-btn__label").textContent = st.expanded ? "Mostra meno" : "Mostra tutti";
  const countEl = btn.querySelector(".rank-expand-btn__count");
  countEl.textContent = `· ${hiddenCount}`;
  countEl.classList.toggle("hidden", st.expanded);
}

export function renderRankingList(listEl, items, offset, typeLabel, expandBtn = null) {
  if (!items.length) {
    listEl.innerHTML = `<p class="empty-hint">Aggiungi altri voti per completare la classifica.</p>`;
    if (expandBtn) expandBtn.classList.add("hidden");
    _rankingLists.delete(listEl);
    return;
  }

  // Ogni render riparte da chiusa: renderStats gira a ogni apertura di
  // Statistiche, e ritrovarsi la lista già aperta da una visita precedente
  // sarebbe una sorpresa.
  const st = { items, offset, typeLabel, expanded: false, btn: expandBtn };
  _rankingLists.set(listEl, st);
  drawRankingRows(listEl, st);
}

// Richiamando con la lista già in cima si evita di restare a metà di una
// classifica che si è appena accorciata sotto i piedi.
export function toggleRankingList(listEl, scrollBackEl = null) {
  const st = _rankingLists.get(listEl);
  if (!st) return;

  st.expanded = !st.expanded;
  drawRankingRows(listEl, st);

  if (!st.expanded && scrollBackEl) {
    scrollBackEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Stessa card "poster grande" usata per i risultati di ricerca (poster-card),
// con l'aggiunta di badge affinità e pulsanti sempre visibili (non a comparsa
// al tap, come nell'overlay di ricerca): qui l'utente deve poter aggiungere
// un titolo al volo, uno dopo l'altro, senza tap extra per rivelare i bottoni.
export function renderTonightFive(entries, profile, note) {
  const noteHtml = note ? `<p class="tonight__note">${escapeHtml(note)}</p>` : "";

  return `
    ${noteHtml}
    <div class="results-grid">
      ${entries.map(({ item, affinity, reasons }) => `
        <div class="poster-card" data-tonight-key="${item.media_type}_${item.id}">
          <div class="poster-card__img" style="background-image:url('${escapeHtml(posterUrl(item.poster_path))}')">
            <span class="badge ${mediaBadgeClass(item)}">${mediaLabel(item)}</span>
            <span class="tonight-card__affinity">${affinity}%</span>
            <div class="poster-card__actions">
              <button class="poster-btn poster-btn--watch action-watch" data-id="${item.id}" data-type="${item.media_type}">♡ Lista</button>
              <button class="poster-btn poster-btn--seen action-seen" data-id="${item.id}" data-type="${item.media_type}">✓ Visto</button>
            </div>
          </div>
          <div class="poster-card__info">
            <div class="poster-card__title">${escapeHtml(item.title)}</div>
            <div class="poster-card__meta">${escapeHtml(item.year)} · ${mediaLabel(item)} · ★ ${rawNumberToFixed(item.vote_average, 1)} TMDB</div>
            <div class="tonight-card__reason">
              ${reasons.length ? `🎯 ${escapeHtml(reasons.join(" · "))}` : "🎯 Consigliato in base ai tuoi gusti"}
            </div>
            <button class="poster-card__scheda action-details" data-id="${item.id}" data-type="${item.media_type}">Scheda →</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// Stessa card di sopra, in versione singola e centrata (usata da "Scopri" e
// "Rivedi un classico": un solo titolo alla volta invece di una griglia).
export function renderDiscoverResult(chosen, whyBits, rating, fallbackNote) {
  return `
    <div class="tonight-solo">
      <div class="poster-card" data-tonight-key="${chosen.media_type}_${chosen.id}">
        <div class="poster-card__img" style="background-image:url('${escapeHtml(posterUrl(chosen.poster_path))}')">
          <span class="badge ${mediaBadgeClass(chosen)}">${mediaLabel(chosen)}</span>
          <div class="poster-card__actions">
            <button class="poster-btn poster-btn--watch action-watch" data-id="${chosen.id}" data-type="${chosen.media_type}">♡ Lista</button>
            <button class="poster-btn poster-btn--seen action-seen" data-id="${chosen.id}" data-type="${chosen.media_type}">✓ Visto</button>
          </div>
        </div>
        <div class="poster-card__info">
          <div class="poster-card__title">✨ ${escapeHtml(chosen.title)}</div>
          <div class="poster-card__meta">${escapeHtml(chosen.year)} · ${mediaLabel(chosen)} · ★ ${rating}/10</div>
          <div class="tonight-card__reason">
            Scelto perché ${escapeHtml(whyBits.join(", "))}.${fallbackNote ? ` ${escapeHtml(fallbackNote)}` : ""}
          </div>
          <button class="poster-card__scheda action-details" data-id="${chosen.id}" data-type="${chosen.media_type}">Scheda →</button>
        </div>
      </div>
    </div>
  `;
}

// Il classico è già in libreria: niente pulsanti di aggiunta, la card apre
// direttamente la scheda salvata (stesso pattern delle shelf-card in home).
export function renderClassicResult(pick, voto, commento) {
  return `
    <div class="tonight-solo">
      <div class="poster-card open-stored-detail" data-key="${uniqueKey(pick)}">
        <div class="poster-card__img" style="background-image:url('${escapeHtml(posterUrl(pick.poster_path))}')">
          <span class="badge ${mediaBadgeClass(pick)}">${mediaLabel(pick)}</span>
        </div>
        <div class="poster-card__info">
          <div class="poster-card__title">🏛️ ${escapeHtml(pick.title)}</div>
          <div class="poster-card__meta">${escapeHtml(pick.year)} · ${mediaLabel(pick)} · tuo voto: ${escapeHtml(voto)}</div>
          <div class="tonight-card__reason">${escapeHtml(commento)}</div>
        </div>
      </div>
    </div>
  `;
}

// ─── REPORT ──────────────────────────────────────────────────────────────────

export function formatReportDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

// Il ciclo è ogni 6 mesi: la data del prossimo aggiornamento automatico è
// solo indicativa (il cron reale, vedi app.js::maybeAutoRefreshReport,
// controlla il superamento dei 6 mesi ad ogni sua esecuzione mensile, non
// scatta esattamente in questa data).
export function nextReportDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + 6);
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

export function renderReportMeta(report) {
  const el = document.getElementById("reportMetaLine");
  if (!el) return;

  if (!report) {
    el.textContent = "Nessun report ancora generato.";
    return;
  }

  el.textContent = `Aggiornato il ${formatReportDate(report.generated_at)} · prossimo aggiornamento automatico l'${nextReportDate(report.generated_at)}`;
}

// Converte i **grassetti** in stile markdown scritti da Claude in <b>, DOPO
// aver già passato il testo da escapeHtml — l'escape avviene prima, quindi
// non c'è HTML arbitrario da interpretare, solo questa singola sostituzione
// controllata su testo già sicuro.
function mdBold(escapedText) {
  return escapedText.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

export function renderReportContent(report) {
  const el = document.getElementById("reportBody");
  if (!el) return;

  if (!report) {
    el.innerHTML = `<p class="empty-hint">Tocca "Aggiorna" per generare il tuo primo report.</p>`;
    return;
  }

  const { profile = [], genres_note = "", directors = [], recommendations = [] } = report.payload || {};

  const profileHtml = profile.map(p => `<p>${mdBold(escapeHtml(p))}</p>`).join("");

  const directorsHtml = directors.length
    ? directors.map(d => `
      <div class="director-row">
        <span class="director-row__name">${escapeHtml(d.name)}</span>
        <span class="director-row__n">${d.count} titoli</span>
        <span class="director-row__avg">★ ${Number(d.avg).toFixed(2)}</span>
      </div>
    `).join("")
    : `<p class="empty-hint">Nessun regista visto almeno 2 volte, per ora.</p>`;

  const recsHtml = recommendations.map((r, i) => {
    const poster = posterUrl(r.poster_path || "");
    const posterStyle = poster ? ` style="background-image:url('${escapeHtml(poster)}')"` : "";
    return `
    <div class="rec-card">
      <div class="rec-card__poster"${posterStyle}>${poster ? "" : `<span class="rec-card__num">${String(i + 1).padStart(2, "0")}</span>`}</div>
      <div class="rec-card__title">${escapeHtml(r.title)}</div>
      <div class="rec-card__meta">${escapeHtml(r.year)} &middot; ${escapeHtml(r.director)}</div>
      <div class="rec-card__why">${mdBold(escapeHtml(r.why))}</div>
    </div>
  `;
  }).join("");

  el.innerHTML = `
    <div class="taste-block">
      <div class="taste-block__title">Il tuo profilo<span class="by">scritto da Claude</span></div>
      ${profileHtml}
    </div>

    <div class="taste-block">
      <div class="taste-block__title">Generi</div>
      <p>${mdBold(escapeHtml(genres_note))}</p>
    </div>

    <div class="taste-block">
      <div class="taste-block__title">Registi che ti fidelizzano<span class="taste-block__hint">★ media voto</span></div>
      ${directorsHtml}
    </div>

    <div class="section">
      <div class="taste-block__title" style="margin-bottom:12px;">10 titoli per te<span class="by">scritto da Claude</span></div>
      <div class="rec-shelf">${recsHtml}</div>
    </div>
  `;
}

// matchedActors: array di nomi da FAVORITE_ACTORS trovati nel cast (vedi
// matchedFavoriteActors), mostrato solo per titoli non ancora visti.
export function renderDetailFacts(source, inSeenFn, inWatchFn, matchedActors = []) {
  const facts = [
    `${mediaLabel(source)}`,
    source.year,
    source.genre_names?.length ? source.genre_names.join(", ") : null,
    source.director && source.media_type === "movie" ? `Regia: ${source.director}` : null,
    source.release_date && source.media_type === "movie" ? `Uscita: ${formatReleaseDate(source.release_date)}` : null,
    inSeenFn(source) ? "✓ Visto" : inWatchFn(source) ? "★ In watchlist" : "Non salvato",
    !inSeenFn(source) && matchedActors.length
      ? `⭐ ${matchedActors.join(", ")}`
      : null
  ].filter(Boolean);

  return facts.map(f => `<span class="detail-fact">${escapeHtml(f)}</span>`).join("");
}
