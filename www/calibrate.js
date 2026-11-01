(() => {
  "use strict";

  const TOTAL_TAPS = 16;
  const MAX_BEATS = 32;
  const MATCH_WINDOW_MS = 250;
  const MAX_OFFSET_MS = 150;

  const pad = document.querySelector("#calibratePad");
  const beatEl = document.querySelector("#calibrateBeat");
  const countEl = document.querySelector("#calibrateCount");
  const resultEl = document.querySelector("#calibrateResult");
  const timingEl = document.querySelector("#calibrateTiming");
  const hintEl = document.querySelector("#calibrateHint");
  const bpmInput = document.querySelector("#calibrateBpm");
  const bpmValue = document.querySelector("#calibrateBpmValue");
  const startButton = document.querySelector("#calibrateStartButton");
  const applyButton = document.querySelector("#calibrateApplyButton");
  const clearButton = document.querySelector("#calibrateClearButton");
  const backButton = document.querySelector("#calibrateBackButton");

  if (!pad || !startButton) return;

  let beats = [];
  let deltas = [];
  let running = false;
  let sessionId = 0;
  let frame = 0;
  let stopTimer = 0;
  let suggestedOffset = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const trimmed = sorted.length >= 8 ? sorted.slice(2, sorted.length - 2) : sorted;
    const mid = Math.floor(trimmed.length / 2);
    return trimmed.length % 2 ? trimmed[mid] : (trimmed[mid - 1] + trimmed[mid]) / 2;
  }

  function formatMs(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : ""}${rounded} ms`;
  }

  function updateCount() {
    if (countEl) countEl.textContent = `${deltas.length} / ${TOTAL_TAPS}`;
  }

  function updateReadout() {
    updateCount();
    if (deltas.length < 4) {
      resultEl.textContent = "-- ms";
      timingEl.textContent = deltas.length ? "MEASURING..." : "NOT MEASURED";
      suggestedOffset = null;
      applyButton.disabled = true;
      return;
    }
    const value = median(deltas);
    resultEl.textContent = formatMs(value);
    if (Math.abs(value) < 8) timingEl.textContent = "GOOD SYNC";
    else if (value > 0) timingEl.textContent = `LATE ${Math.round(value)} ms`;
    else timingEl.textContent = `FAST ${Math.round(-value)} ms`;
    suggestedOffset = clamp(Math.round(-value), -MAX_OFFSET_MS, MAX_OFFSET_MS);
    applyButton.disabled = false;
  }

  function pulseBeat(accent) {
    if (!beatEl) return;
    beatEl.classList.remove("is-hit", "is-accent");
    void beatEl.offsetWidth;
    beatEl.classList.add("is-hit");
    if (accent) beatEl.classList.add("is-accent");
  }

  function stop() {
    sessionId += 1;
    running = false;
    window.StarlightAudio?.stopMetronome?.();
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = 0;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    pad.classList.remove("is-running");
    startButton.textContent = "START";
    beats = [];
  }

  function resetMeasurement() {
    deltas = [];
    suggestedOffset = null;
    resultEl.textContent = "-- ms";
    timingEl.textContent = "NOT MEASURED";
    applyButton.disabled = true;
    updateCount();
  }

  function finish(message) {
    stop();
    updateReadout();
    if (suggestedOffset !== null) {
      hintEl.textContent = `判定オフセット ${formatMs(suggestedOffset)} を推奨します。APPLY RESULTで反映できます。`;
    } else {
      hintEl.textContent = message || "タップが少なすぎます。もう一度STARTを押してください。";
    }
  }

  function start() {
    const audio = window.StarlightAudio;
    if (!audio) return;
    audio.unlock();
    const ctx = audio.getContext();
    if (!ctx) {
      hintEl.textContent = "この端末では音声を初期化できませんでした。";
      return;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    stop();
    resetMeasurement();
    const mySession = sessionId;
    const bpm = Math.max(60, Number(bpmInput?.value) || 120);
    const beatSeconds = 60 / bpm;
    const firstBeat = ctx.currentTime + 1.05;

    for (let i = 0; i < MAX_BEATS; i += 1) {
      const ctxTime = firstBeat + i * beatSeconds;
      audio.playMetronomeClick(ctxTime, i % 4 === 0);
      beats.push({ ctxTime, perf: audio.contextTimeToPerfMs(ctxTime), index: i, used: false, flashed: false });
    }

    running = true;
    pad.classList.add("is-running");
    startButton.textContent = "STOP";
    hintEl.textContent = audio.isMuted()
      ? "ミュート中です。SOUND ONにすると音に合わせて測れます。"
      : "メトロノームに合わせてパッドを16回タップしてください。";

    const animate = () => {
      if (!running || mySession !== sessionId) return;
      const now = performance.now();
      for (const beat of beats) {
        if (beat.flashed || now < beat.perf) continue;
        beat.flashed = true;
        pulseBeat(beat.index % 4 === 0);
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    const duration = (firstBeat + MAX_BEATS * beatSeconds - ctx.currentTime + 0.4) * 1000;
    stopTimer = window.setTimeout(() => {
      if (!running || mySession !== sessionId) return;
      finish();
    }, duration);
  }

  function onTap(event) {
    if (!running) return;
    event.preventDefault();
    const now = performance.now();
    let best = null;
    for (const beat of beats) {
      if (beat.used) continue;
      const diff = now - beat.perf;
      if (Math.abs(diff) > MATCH_WINDOW_MS) continue;
      if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { beat, diff };
    }
    if (!best) return;
    best.beat.used = true;
    deltas.push(best.diff);
    window.StarlightHaptics?.trigger("tap");
    pad.classList.remove("is-tap");
    void pad.offsetWidth;
    pad.classList.add("is-tap");
    updateReadout();
    if (deltas.length >= TOTAL_TAPS) finish();
  }

  pad.addEventListener("pointerdown", onTap);

  startButton.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    if (running) {
      finish();
      return;
    }
    start();
  });

  applyButton.addEventListener("click", () => {
    if (suggestedOffset === null) return;
    window.StarlightHaptics?.trigger("ui");
    window.StarlightSettings?.set({ inputOffsetMs: suggestedOffset });
    hintEl.textContent = `判定オフセットを ${formatMs(suggestedOffset)} に設定しました。`;
    applyButton.disabled = true;
  });

  clearButton.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    stop();
    resetMeasurement();
    hintEl.textContent = "測定値をクリアしました。STARTでもう一度測れます。";
  });

  backButton?.addEventListener("click", () => stop());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });

  bpmInput?.addEventListener("input", () => {
    if (bpmValue) bpmValue.textContent = String(Math.round(Number(bpmInput.value) || 120));
  });
  bpmInput?.addEventListener("change", () => {
    if (running) start();
  });

  if (window.StarlightSettings) {
    window.StarlightSettings.bindRange("calibrateInputOffset", "calibrateInputOffsetValue", "inputOffsetMs", window.StarlightSettings.formatMs);
    window.StarlightSettings.bindRange("calibrateAudioOffset", "calibrateAudioOffsetValue", "audioOffsetMs", window.StarlightSettings.formatMs);
  }

  resetMeasurement();
})();
