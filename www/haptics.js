(() => {
  "use strict";

  const IMPACT_STYLE_BY_STRENGTH = {
    LIGHT: "LIGHT",
    STANDARD: "MEDIUM",
    STRONG: "HEAVY",
  };

  const VIBRATE_MS_BY_STRENGTH = {
    LIGHT: 8,
    STANDARD: 16,
    STRONG: 30,
  };

  function currentSettings() {
    return window.StarlightSettings ? window.StarlightSettings.get() : null;
  }

  function nativeHaptics() {
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== "function") return null;
    if (!capacitor.isNativePlatform()) return null;
    return capacitor.Plugins ? capacitor.Plugins.Haptics : null;
  }

  function isEnabled(settings) {
    return Boolean(settings) && Boolean(settings.hapticsStrength) && settings.hapticsStrength !== "OFF";
  }

  function impact(strengthOverride) {
    const settings = currentSettings();
    if (!isEnabled(settings)) return;
    const strength = strengthOverride || settings.hapticsStrength;
    const native = nativeHaptics();
    if (native && typeof native.impact === "function") {
      native.impact({ style: IMPACT_STYLE_BY_STRENGTH[strength] || "MEDIUM" }).catch(() => {});
      return;
    }
    if (navigator.vibrate) navigator.vibrate(VIBRATE_MS_BY_STRENGTH[strength] || 16);
  }

  function notification(kind) {
    const settings = currentSettings();
    if (!isEnabled(settings)) return;
    const native = nativeHaptics();
    if (native && typeof native.notification === "function") {
      native.notification({ type: kind }).catch(() => {});
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === "ERROR" || kind === "WARNING" ? [18, 26, 18] : 22);
  }

  function selection() {
    const settings = currentSettings();
    if (!isEnabled(settings)) return;
    const native = nativeHaptics();
    if (native && typeof native.selectionStart === "function") {
      native.selectionStart().catch(() => {});
      if (typeof native.selectionEnd === "function") native.selectionEnd().catch(() => {});
      return;
    }
    if (navigator.vibrate) navigator.vibrate(6);
  }

  function trigger(kind) {
    if (kind === "tap") impact();
    else if (kind === "perfect") impact("LIGHT");
    else if (kind === "combo") impact();
    else if (kind === "miss") notification("WARNING");
    else if (kind === "ui") selection();
    else if (kind === "result") notification("SUCCESS");
  }

  window.StarlightHaptics = { trigger };
})();
