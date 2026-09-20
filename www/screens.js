(() => {
  "use strict";

  let mode = "play";
  let history = [];
  let activeId = "title";
  let selection = { song: null };

  const muteButton = document.querySelector("#muteButton");
  const songListEl = document.querySelector("#songList");
  const difficultyListEl = document.querySelector("#difficultyList");
  const difficultySongNameEl = document.querySelector("#difficultySongName");
  const titleBestScoreEl = document.querySelector("#titleBestScore");
  const practiceStartInput = document.querySelector("#practiceStart");
  const practiceEndInput = document.querySelector("#practiceEnd");
  const practiceSpeedInput = document.querySelector("#practiceSpeed");
  const practiceSpeedValueEl = document.querySelector("#practiceSpeedValue");
  const practiceLoopButton = document.querySelector("#practiceLoop");
  const practiceAutoPlayButton = document.querySelector("#practiceAutoPlay");
  const confirmModal = document.querySelector("#confirmModal");
  const confirmMessageEl = document.querySelector("#confirmMessage");

  function applyScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.screenId === id);
    });
    activeId = id;
    document.body.dataset.activeScreen = id;
    window.StarlightSettings?.setWakeLockActive(id === "game");
  }

  function showScreen(id, { push = true } = {}) {
    if (push && activeId !== id) history.push(activeId);
    applyScreen(id);
  }

  function goBack() {
    const previous = history.pop() || "title";
    applyScreen(previous);
  }

  function resetTo(id) {
    history = [];
    applyScreen(id);
  }

  function confirm(message) {
    if (!confirmModal || !confirmMessageEl || typeof confirmModal.showModal !== "function") {
      return Promise.resolve(window.confirm(message));
    }
    confirmMessageEl.textContent = message;
    confirmModal.showModal();
    return new Promise((resolve) => {
      const handleClose = () => {
        confirmModal.removeEventListener("close", handleClose);
        resolve(confirmModal.returnValue === "ok");
      };
      confirmModal.addEventListener("close", handleClose);
    });
  }

  function getScores() {
    return window.StarlightStorage.read("scores", {});
  }

  function getSongCatalog() {
    const songs = [];
    const builtIn = window.MELODINIQ_CHART;
    if (builtIn && Array.isArray(builtIn.notes) && builtIn.notes.length > 0) {
      songs.push({ id: builtIn.id || "melodiniq-ultima", chart: builtIn, editable: false });
    }
    const chartsStore = window.StarlightStorage.read("charts", {});
    const custom = chartsStore.custom;
    if (custom && Array.isArray(custom.notes) && custom.notes.length > 0) {
      songs.push({ id: "custom", chart: custom, editable: true });
    }
    return songs;
  }

  function buildSongCard(song, bestScore) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "song-card";
    const title = document.createElement("span");
    title.className = "song-card-title";
    title.textContent = song.chart.title || "UNTITLED";
    const meta = document.createElement("span");
    meta.className = "song-card-meta";
    const difficultyLabel = song.chart.difficulty || (song.editable ? "EDITED" : "STANDARD");
    meta.textContent = `${difficultyLabel} ・ Lv.${song.chart.level ?? "??"} ・ BPM ${song.chart.bpm ?? "--"}`;
    const best = document.createElement("span");
    best.className = "song-card-best";
    best.textContent = `BEST ${Number(bestScore || 0).toLocaleString("ja-JP")}`;
    card.append(title, meta, best);
    return card;
  }

  function renderSongList() {
    if (!songListEl) return;
    const songs = getSongCatalog();
    const scores = getScores();
    songListEl.replaceChildren();
    if (songs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "song-empty";
      empty.textContent = "譜面がありません。CHART EDITで作成してください。";
      songListEl.append(empty);
      return;
    }
    songs.forEach((song) => {
      const best = scores[song.id]?.bestScore ?? 0;
      const card = buildSongCard(song, best);
      card.addEventListener("click", () => {
        window.StarlightHaptics?.trigger("ui");
        selectSong(song);
      });
      songListEl.append(card);
    });
  }

  function selectSong(song) {
    selection.song = song;
    if (difficultySongNameEl) difficultySongNameEl.textContent = song.chart.title || "UNTITLED";
    renderDifficultyList();
    showScreen("difficulty");
    window.StarlightAudio.configure({ audioPath: song.chart.audioPath, bpm: song.chart.bpm });
  }

  function renderDifficultyList() {
    if (!difficultyListEl || !selection.song) return;
    difficultyListEl.replaceChildren();
    const song = selection.song;
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "difficulty-tile";
    const name = document.createElement("strong");
    name.textContent = song.chart.difficulty || (song.editable ? "EDITED" : "STANDARD");
    const level = document.createElement("span");
    level.textContent = `Lv. ${song.chart.level ?? "??"}`;
    tile.append(name, level);
    tile.addEventListener("click", () => {
      window.StarlightHaptics?.trigger("ui");
      if (mode === "practice") {
        prepareGameConfigForPractice();
        showScreen("practiceConfig");
      } else {
        showScreen("config");
      }
    });
    difficultyListEl.append(tile);
  }

  function parseTimeInput(text) {
    const match = /^(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(String(text || "").trim());
    if (!match) return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const millis = Number((match[3] || "0").padEnd(3, "0"));
    return minutes * 60 + seconds + millis / 1000;
  }

  function formatSecondsToTime(totalSeconds) {
    const clamped = Math.max(0, totalSeconds || 0);
    const minutes = Math.floor(clamped / 60);
    const seconds = Math.floor(clamped % 60);
    const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function estimateChartDuration(chart) {
    const beatSeconds = 60 / (chart.bpm || 193);
    const lastBeat = chart.notes.reduce((max, note) => Math.max(max, note.endBeat || note.beat), 0);
    return lastBeat * beatSeconds;
  }

  function prepareGameConfigForPractice() {
    if (!selection.song) return;
    const duration = estimateChartDuration(selection.song.chart);
    if (practiceStartInput) practiceStartInput.value = formatSecondsToTime(0);
    if (practiceEndInput) practiceEndInput.value = formatSecondsToTime(Math.min(30, duration));
    if (practiceSpeedInput) practiceSpeedInput.value = "1";
    if (practiceSpeedValueEl) practiceSpeedValueEl.textContent = "1.0x";
    if (practiceLoopButton) {
      practiceLoopButton.dataset.on = "true";
      practiceLoopButton.textContent = "ON";
    }
    if (practiceAutoPlayButton) {
      practiceAutoPlayButton.dataset.on = "false";
      practiceAutoPlayButton.textContent = "OFF";
    }
  }

  function renderTitleBestScore() {
    if (!titleBestScoreEl) return;
    const scores = getScores();
    const values = Object.values(scores).map((entry) => entry.bestScore || 0);
    const best = values.length ? Math.max(...values) : 0;
    titleBestScoreEl.textContent = best > 0 ? String(best).padStart(8, "0") : "--------";
  }

  function showResult(payload) {
    document.querySelector("#resultEyebrow").textContent = payload.failed ? "LIVE FAILED" : "RESULT";
    document.querySelector("#resultFullCombo").classList.toggle("is-visible", Boolean(payload.fullCombo) && !payload.failed);
    document.querySelector("#resultScore").textContent = String(payload.score).padStart(8, "0");
    const rankEl = document.querySelector("#resultRank");
    rankEl.textContent = payload.rank;
    rankEl.dataset.rank = payload.rank;
    document.querySelector("#resultPerfect").textContent = String(payload.perfect);
    document.querySelector("#resultGreat").textContent = String(payload.great);
    document.querySelector("#resultGood").textContent = String(payload.good);
    document.querySelector("#resultMiss").textContent = String(payload.miss);
    document.querySelector("#resultCombo").textContent = String(payload.maxCombo);
    document.querySelector("#resultAccuracy").textContent = `${payload.accuracy.toFixed(2)}%`;
    document.querySelector("#resultBestScore").textContent = Number(payload.bestScore).toLocaleString("ja-JP");
    document.querySelector("#resultNewRecord").classList.toggle("is-visible", Boolean(payload.isNewRecord));
    resetTo("result");
    window.StarlightHaptics?.trigger("result");
  }

  document.querySelector("#titlePlayButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    window.StarlightAudio.unlock();
    mode = "play";
    renderSongList();
    showScreen("songSelect");
  });

  document.querySelector("#titlePracticeButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    window.StarlightAudio.unlock();
    mode = "practice";
    renderSongList();
    showScreen("songSelect");
  });

  document.querySelector("#titleEditButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    showScreen("editor");
    window.dispatchEvent(new CustomEvent("starlight-editor-open"));
  });

  document.querySelector("#titleSettingsButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    showScreen("settings");
  });

  muteButton?.addEventListener("click", () => {
    window.StarlightAudio.unlock();
    const nextMuted = !window.StarlightAudio.isMuted();
    window.StarlightAudio.setMuted(nextMuted);
    muteButton.textContent = nextMuted ? "SOUND OFF" : "SOUND ON";
    muteButton.setAttribute("aria-pressed", String(nextMuted));
  });

  ["songSelectBackButton", "difficultyBackButton", "configBackButton", "practiceConfigBackButton", "settingsBackButton", "editorBackButton"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => {
      window.StarlightHaptics?.trigger("ui");
      goBack();
    });
  });

  window.StarlightSettings.bindRange("configNoteSpeed", "configNoteSpeedValue", "noteSpeed", window.StarlightSettings.formatSpeed);
  window.StarlightSettings.bindRange("configInputOffset", "configInputOffsetValue", "inputOffsetMs", window.StarlightSettings.formatMs);
  window.StarlightSettings.bindToggle("configMirror", "mirror");
  window.StarlightSettings.bindChoiceGroup("configHapticsStrength", "hapticsStrength");
  window.StarlightSettings.bindChoiceGroup("configEffects", "effects");

  document.querySelector("#configOpenSettingsButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    showScreen("settings");
  });

  document.querySelector("#configReadyButton")?.addEventListener("click", () => {
    if (!selection.song) return;
    window.StarlightHaptics?.trigger("ui");
    showScreen("game");
    window.StarlightGame.beginPlay(selection.song);
  });

  practiceSpeedInput?.addEventListener("input", () => {
    if (practiceSpeedValueEl) practiceSpeedValueEl.textContent = `${Number(practiceSpeedInput.value).toFixed(1)}x`;
  });

  [practiceLoopButton, practiceAutoPlayButton].forEach((button) => {
    button?.addEventListener("click", () => {
      window.StarlightHaptics?.trigger("ui");
      const isOn = button.dataset.on === "true";
      button.dataset.on = String(!isOn);
      button.textContent = !isOn ? "ON" : "OFF";
    });
  });

  document.querySelector("#practiceStartButton")?.addEventListener("click", () => {
    if (!selection.song) return;
    window.StarlightHaptics?.trigger("ui");
    const startSeconds = parseTimeInput(practiceStartInput?.value) ?? 0;
    let endSeconds = parseTimeInput(practiceEndInput?.value) ?? startSeconds + 30;
    if (endSeconds <= startSeconds) endSeconds = startSeconds + 0.5;
    const speed = Number(practiceSpeedInput?.value) || 1;
    const loop = practiceLoopButton?.dataset.on === "true";
    const autoPlay = practiceAutoPlayButton?.dataset.on === "true";
    showScreen("game");
    window.StarlightGame.beginPractice(selection.song, {
      startSeconds: Math.max(0, startSeconds),
      endSeconds,
      speed,
      loop,
      autoPlay,
    });
  });

  document.querySelector("#resultRetryButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    resetTo("game");
    window.StarlightGame.retry();
  });

  document.querySelector("#resultSongSelectButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    window.StarlightGame.abort();
    resetTo("songSelect");
    renderSongList();
  });

  document.querySelector("#resultTitleButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    window.StarlightGame.abort();
    resetTo("title");
    renderTitleBestScore();
  });

  window.addEventListener("starlight-scores-reset", renderTitleBestScore);
  window.addEventListener("starlight-charts-reset", () => renderSongList());

  window.StarlightScreens = {
    showScreen,
    goBack,
    resetTo,
    confirm,
    showResult,
    renderSongList,
    renderTitleBestScore,
  };

  renderTitleBestScore();
  applyScreen("title");
  if (window.MELODINIQ_CHART) {
    window.StarlightAudio.configure({ audioPath: window.MELODINIQ_CHART.audioPath, bpm: window.MELODINIQ_CHART.bpm });
  }
})();
