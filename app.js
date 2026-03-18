const CineApp = (() => {
  const core = window.CineCore;

  function getElements() {
    return {
      searchInput: document.getElementById("searchInput"),
      searchBtn: document.getElementById("searchBtn"),
      resultsSection: document.getElementById("resultsSection"),
      results: document.getElementById("results"),
      resultsEmpty: document.getElementById("resultsEmpty"),
      resultCount: document.getElementById("resultCount"),
      tabs: [...document.querySelectorAll(".tab")],

      watchShelf: document.getElementById("watchShelf"),
      seenMovieShelf: document.getElementById("seenMovieShelf"),
      seenSeriesShelf: document.getElementById("seenSeriesShelf"),

      watchShelfEmpty: document.getElementById("watchShelfEmpty"),
      seenMovieShelfEmpty: document.getElementById("seenMovieShelfEmpty"),
      seenSeriesShelfEmpty: document.getElementById("seenSeriesShelfEmpty"),

      openWatchAll: document.getElementById("openWatchAll"),
      openSeenMovies: document.getElementById("openSeenMovies"),
      openSeenSeries: document.getElementById("openSeenSeries"),

      libraryBackBtn: document.getElementById("libraryBackBtn"),
      libraryTitle: document.getElementById("libraryTitle"),
      libraryList: document.getElementById("libraryList"),
      libraryEmpty: document.getElementById("libraryEmpty"),
      libraryFilters: [...document.querySelectorAll(".filterPill[data-filter]")],
      libraryGenreFilters: document.getElementById("libraryGenreFilters"),
      genreFiltersTitle: document.getElementById("genreFiltersTitle"),

      statSeen: document.getElementById("statSeen"),
      statWatch: document.getElementById("statWatch"),
      statMovies: document.getElementById("statMovies"),
      statSeries: document.getElementById("statSeries"),

      genreBars: document.getElementById("genreBars"),
      top100Podium: document.getElementById("top100Podium"),
      top100List: document.getElementById("top100List"),
      top100CountBadge: document.getElementById("top100CountBadge"),
      top100SeriesPodium: document.getElementById("top100SeriesPodium"),
      top100SeriesList: document.getElementById("top100SeriesList"),
      top100SeriesCountBadge: document.getElementById("top100SeriesCountBadge"),

      genreSelect: document.getElementById("genreSelect"),
      recommendBtn: document.getElementById("recommendBtn"),
      discoverBtn: document.getElementById("discoverBtn"),
      classicBtn: document.getElementById("classicBtn"),
      tonightSuggestion: document.getElementById("tonightSuggestion"),

      exportBtn2: document.getElementById("exportBtn2"),
      importBtn: document.getElementById("importBtn"),
      importFileInput: document.getElementById("importFileInput"),

      detailBackBtn: document.getElementById("detailBackBtn"),
      detailBackdrop: document.getElementById("detailBackdrop"),
      detailPoster: document.getElementById("detailPoster"),
      detailTitle: document.getElementById("detailTitle"),
      detailMeta: document.getElementById("detailMeta"),
      detailGenres: document.getElementById("detailGenres"),
      detailOverview: document.getElementById("detailOverview"),
      detailFacts: document.getElementById("detailFacts"),
      detailVoteInput: document.getElementById("detailVoteInput"),
      detailCommentInput: document.getElementById("detailCommentInput"),
      detailSeenBtn: document.getElementById("detailSeenBtn"),
      detailWatchBtn: document.getElementById("detailWatchBtn"),
      detailSaveNoteBtn: document.getElementById("detailSaveNoteBtn"),
      detailRemoveBtn: document.getElementById("detailRemoveBtn"),

      toastWrap: document.getElementById("toastWrap"),

      rankingToggleMovies: document.getElementById("rankingToggleMovies"),
      rankingToggleSeries: document.getElementById("rankingToggleSeries"),
      rankingPanelMovies: document.getElementById("rankingPanelMovies"),
      rankingPanelSeries: document.getElementById("rankingPanelSeries"),

      screens: {
        home: document.getElementById("screen-home"),
        library: document.getElementById("screen-library"),
        stats: document.getElementById("screen-stats"),
        tonight: document.getElementById("screen-tonight"),
        backup: document.getElementById("screen-backup"),
        detail: document.getElementById("screen-detail")
      }
    };
  }

  function bindEvents(els) {
    document.addEventListener("click", async function(e) {
      const seenBtn = e.target.closest(".action-seen");
      const watchBtn = e.target.closest(".action-watch");
      const detailsBtn = e.target.closest(".action-details");
      const removeSeenBtn = e.target.closest(".remove-seen");
      const removeWatchBtn = e.target.closest(".remove-watch");
      const moveWatchBtn = e.target.closest(".move-watch-seen");
      const openStoredBtn = e.target.closest(".open-stored-detail");
      const openTonightBtn = e.target.closest(".open-tonight-detail");
      const genreFilterBtn = e.target.closest("[data-genre-filter]");
      const genericTap = e.target.closest("button, .navBtn, .tab, .filterPill, .seeAllBtn, .shelfCard, .tonightCard");

      if (genericTap) core.haptic([8]);

      try {
        if (genreFilterBtn) {
          core.setLibraryGenre(genreFilterBtn.dataset.genreFilter);
          return;
        }

        if (seenBtn) await core.addSeen(seenBtn.dataset.type, seenBtn.dataset.id);
        if (watchBtn) await core.addWatch(watchBtn.dataset.type, watchBtn.dataset.id);
        if (detailsBtn) await core.showDetails(detailsBtn.dataset.type, detailsBtn.dataset.id);
        if (removeSeenBtn) core.removeSeen(removeSeenBtn.dataset.key);
        if (removeWatchBtn) core.removeWatch(removeWatchBtn.dataset.key);
        if (moveWatchBtn) core.moveWatchToSeen(moveWatchBtn.dataset.key);

        if (openStoredBtn) {
          const key = openStoredBtn.dataset.key;
          const item =
            core.state.db.seen.find(x => `${x.media_type}_${x.id}` === key) ||
            core.state.db.watchlist.find(x => `${x.media_type}_${x.id}` === key);
          if (item) core.openDetail(item);
        }

        if (openTonightBtn) {
          await core.showDetails(openTonightBtn.dataset.type, openTonightBtn.dataset.id);
        }
      } catch {
        console.error("Errore click handler");
      }
    });

    els.tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        els.tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        core.state.currentType = tab.dataset.type;
      });
    });

    els.libraryFilters.forEach(btn => {
      btn.addEventListener("click", () => core.setLibraryFilter(btn.dataset.filter));
    });

    els.searchBtn.addEventListener("click", core.searchTitles);
    els.searchInput.addEventListener("keydown", e => {
      if (e.key === "Enter") core.searchTitles();
    });

    els.rankingToggleMovies.addEventListener("click", () => {
      els.rankingToggleMovies.classList.add("active");
      els.rankingToggleSeries.classList.remove("active");
      els.rankingPanelMovies.classList.remove("hidden");
      els.rankingPanelSeries.classList.add("hidden");
      core.haptic([8]);
    });

    els.rankingToggleSeries.addEventListener("click", () => {
      els.rankingToggleSeries.classList.add("active");
      els.rankingToggleMovies.classList.remove("active");
      els.rankingPanelSeries.classList.remove("hidden");
      els.rankingPanelMovies.classList.add("hidden");
      core.haptic([8]);
    });

    els.openWatchAll.addEventListener("click", () => core.openLibrary("watch", "all"));
    els.openSeenMovies.addEventListener("click", () => core.openLibrary("seen", "movie"));
    els.openSeenSeries.addEventListener("click", () => core.openLibrary("seen", "series"));

    els.recommendBtn.addEventListener("click", () => core.recommendTonightFive({ auto: false }));
    els.discoverBtn.addEventListener("click", core.discoverByTaste);
    els.classicBtn.addEventListener("click", core.suggestClassic);

    document.querySelectorAll(".navBtn[data-screen]").forEach(btn => {
      btn.addEventListener("click", () => core.switchScreen(btn.dataset.screen));
    });

    els.exportBtn2.addEventListener("click", core.exportBackup);
    els.importBtn.addEventListener("click", () => els.importFileInput.click());

    els.importFileInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (file) core.importBackup(file);
      els.importFileInput.value = "";
    });

    els.libraryBackBtn.addEventListener("click", () => core.switchScreen("home"));

    els.detailBackBtn.addEventListener("click", () => {
      core.switchScreen(core.state.previousScreen || "home");
    });

    els.detailSeenBtn.addEventListener("click", () => {
      if (!core.state.currentDetail) return;

      const voteCheck = core.validateVoteOrShowToast(els.detailVoteInput.value);
      if (!voteCheck.ok) return;

      if (!core.state.db.seen.find(x => `${x.media_type}_${x.id}` === `${core.state.currentDetail.media_type}_${core.state.currentDetail.id}`)) {
        core.state.db.seen.unshift({
          ...core.state.currentDetail,
          vote: voteCheck.value,
          comment: els.detailCommentInput.value.trim()
        });
        core.state.db.watchlist = core.state.db.watchlist.filter(
          x => `${x.media_type}_${x.id}` !== `${core.state.currentDetail.media_type}_${core.state.currentDetail.id}`
        );
        localStorage.setItem("cineTrackerDB", JSON.stringify(core.state.db));
        core.renderAll();
      } else {
        core.saveDetailNotes();
        return;
      }

      core.openDetail(core.state.currentDetail);
    });

    els.detailWatchBtn.addEventListener("click", () => {
      if (!core.state.currentDetail) return;

      const voteCheck = core.validateVoteOrShowToast(els.detailVoteInput.value);
      if (!voteCheck.ok) return;

      const key = `${core.state.currentDetail.media_type}_${core.state.currentDetail.id}`;
      const inSeen = core.state.db.seen.find(x => `${x.media_type}_${x.id}` === key);
      const inWatch = core.state.db.watchlist.find(x => `${x.media_type}_${x.id}` === key);

      if (!inSeen && !inWatch) {
        core.state.db.watchlist.unshift({
          ...core.state.currentDetail,
          vote: voteCheck.value,
          comment: els.detailCommentInput.value.trim()
        });
        localStorage.setItem("cineTrackerDB", JSON.stringify(core.state.db));
        core.renderAll();
      } else if (inWatch) {
        core.saveDetailNotes();
        return;
      }

      core.openDetail(core.state.currentDetail);
    });

    els.detailSaveNoteBtn.addEventListener("click", core.saveDetailNotes);

    els.detailRemoveBtn.addEventListener("click", () => {
      if (!core.state.currentDetail) return;
      const ok = confirm("Vuoi rimuovere questo titolo dalla tua libreria?");
      if (!ok) return;
      core.removeCurrentDetail();
    });

    window.addEventListener("popstate", core.handlePopState);

    window.addEventListener("load", () => {
      setTimeout(() => {
        const splash = document.getElementById("splashScreen");
        const app = document.querySelector(".app");

        if (app) app.classList.add("appReady");
        if (!splash) return;

        splash.style.opacity = "0";
        setTimeout(() => splash.remove(), 600);
      }, 900);
    });
  }

  function init() {
    const els = getElements();
    core.setElements(els);
    core.initState();
    core.bootUi();
    bindEvents(els);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  CineApp.init();
});