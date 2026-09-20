(() => {
  "use strict";

  const KEYS = {
    settings: "starlight-settings",
    scores: "starlight-scores",
    charts: "starlight-charts",
  };

  const LEGACY_CHART_KEY = "starlight-beats-chart-melodiniq-v1";

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function read(namespace, fallback) {
    const key = KEYS[namespace];
    if (!key) return fallback;
    const parsed = safeParse(window.localStorage.getItem(key));
    return parsed ?? fallback;
  }

  function write(namespace, value) {
    const key = KEYS[namespace];
    if (!key) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(namespace) {
    const key = KEYS[namespace];
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }

  function migrateLegacyChart() {
    if (window.localStorage.getItem(KEYS.charts)) return;
    const legacy = safeParse(window.localStorage.getItem(LEGACY_CHART_KEY));
    if (!legacy || !Array.isArray(legacy.notes) || legacy.notes.length === 0) return;
    write("charts", { custom: legacy });
  }

  migrateLegacyChart();

  window.StarlightStorage = { read, write, remove };
})();
