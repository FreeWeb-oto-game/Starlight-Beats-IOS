(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    noteSpeed: 2.5,
    inputOffsetMs: 0,
    audioOffsetMs: 0,
    mirror: false,
    laneEffect: true,
    musicVolume: 100,
    seVolume: 80,
    judgementVoice: true,
    hapticsStrength: "STANDARD",
    effects: "HIGH",
    particles: true,
    motion: true,
    brightnessLock: true,
  };

  let settings = { ...DEFAULT_SETTINGS, ...window.StarlightStorage.read("settings", {}) };
  const listeners = new Set();
  let wakeLockRef = null;
  let wakeLockWanted = false;

  function persist() {
    window.StarlightStorage.write("settings", settings);
  }

  function get() {
    return { ...settings };
  }

  function notify() {
    const snapshot = get();
    listeners.forEach((listener) => listener(snapshot));
    window.dispatchEvent(new CustomEvent("starlight-settings-change", { detail: snapshot }));
  }

  function set(partial) {
    settings = { ...settings, ...partial };
    persist();
    notify();
  }

  function reset() {
    settings = { ...DEFAULT_SETTINGS };
    persist();
    notify();
  }

  function resetScores() {
    window.StarlightStorage.remove("scores");
    window.dispatchEvent(new CustomEvent("starlight-scores-reset"));
  }

  function resetCharts() {
    window.StarlightStorage.remove("charts");
    window.dispatchEvent(new CustomEvent("starlight-charts-reset"));
  }

  function onChange(listener) {
    listeners.add(listener);
    listener(get());
    return () => listeners.delete(listener);
  }

  function formatMs(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : ""}${rounded} ms`;
  }

  function formatPercent(value) {
    return `${Math.round(value)}%`;
  }

  function formatSpeed(value) {
    return Number(value).toFixed(1);
  }

  function bindRange(inputId, outputId, key, formatFn) {
    const input = document.getElementById(inputId);
    const output = outputId ? document.getElementById(outputId) : null;
    if (!input) return;
    const refresh = (currentSettings) => {
      const value = currentSettings[key];
      if (document.activeElement !== input) input.value = String(value);
      if (output) output.textContent = formatFn ? formatFn(value) : String(value);
    };
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (output) output.textContent = formatFn ? formatFn(value) : String(value);
      set({ [key]: value });
    });
    onChange(refresh);
  }

  function bindToggle(buttonId, key, labels = ["OFF", "ON"]) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    const refresh = (currentSettings) => {
      const isOn = Boolean(currentSettings[key]);
      button.dataset.on = String(isOn);
      button.textContent = isOn ? labels[1] : labels[0];
      button.setAttribute("aria-pressed", String(isOn));
    };
    button.addEventListener("click", () => {
      window.StarlightHaptics?.trigger("ui");
      set({ [key]: !settings[key] });
    });
    onChange(refresh);
  }

  function bindChoiceGroup(containerId, key) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll("[data-value]"));
    const refresh = (currentSettings) => {
      const value = currentSettings[key];
      buttons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.value === String(value));
      });
    };
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        window.StarlightHaptics?.trigger("ui");
        set({ [key]: button.dataset.value });
      });
    });
    onChange(refresh);
  }

  async function requestWakeLock() {
    if (!settings.brightnessLock || !navigator.wakeLock) return;
    try {
      wakeLockRef = await navigator.wakeLock.request("screen");
      wakeLockRef.addEventListener("release", () => {
        wakeLockRef = null;
      });
    } catch {
      wakeLockRef = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef) {
      wakeLockRef.release().catch(() => {});
      wakeLockRef = null;
    }
  }

  function setWakeLockActive(active) {
    wakeLockWanted = active;
    if (active) requestWakeLock();
    else releaseWakeLock();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLockWanted && !wakeLockRef) requestWakeLock();
  });

  window.StarlightSettings = {
    get,
    set,
    reset,
    resetScores,
    resetCharts,
    onChange,
    bindRange,
    bindToggle,
    bindChoiceGroup,
    formatMs,
    formatPercent,
    formatSpeed,
    setWakeLockActive,
  };

  bindRange("settingNoteSpeed", "settingNoteSpeedValue", "noteSpeed", formatSpeed);
  bindRange("settingInputOffset", "settingInputOffsetValue", "inputOffsetMs", formatMs);
  bindRange("settingAudioOffset", "settingAudioOffsetValue", "audioOffsetMs", formatMs);
  bindToggle("settingMirror", "mirror");
  bindToggle("settingLaneEffect", "laneEffect");
  bindRange("settingMusicVolume", "settingMusicVolumeValue", "musicVolume", formatPercent);
  bindRange("settingSeVolume", "settingSeVolumeValue", "seVolume", formatPercent);
  bindToggle("settingJudgementVoice", "judgementVoice");
  bindChoiceGroup("settingHapticsStrength", "hapticsStrength");
  bindChoiceGroup("settingEffects", "effects");
  bindToggle("settingParticles", "particles");
  bindToggle("settingMotion", "motion");
  bindToggle("settingBrightnessLock", "brightnessLock");

  onChange((current) => window.StarlightAudio?.applyVolumes(current));

  document.getElementById("resetScoresButton")?.addEventListener("click", async () => {
    const confirmed = await window.StarlightScreens?.confirm("スコア記録をすべて削除しますか？");
    if (confirmed) resetScores();
  });
  document.getElementById("resetSettingsButton")?.addEventListener("click", async () => {
    const confirmed = await window.StarlightScreens?.confirm("設定をすべて初期値に戻しますか？");
    if (confirmed) reset();
  });
  document.getElementById("resetChartsButton")?.addEventListener("click", async () => {
    const confirmed = await window.StarlightScreens?.confirm("保存された譜面をすべて削除しますか？");
    if (confirmed) resetCharts();
  });
})();
