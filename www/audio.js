(() => {
  "use strict";

  const HIT_TONE_PROFILES = {
    tap: { frequency: 520, duration: 0.075, type: "square", gain: 0.09 },
    gold: { frequency: 640, duration: 0.09, type: "square", gain: 0.11 },
    flick: { frequency: 760, duration: 0.08, type: "sawtooth", gain: 0.09 },
    holdStart: { frequency: 440, duration: 0.09, type: "triangle", gain: 0.09 },
    holdEnd: { frequency: 660, duration: 0.11, type: "sine", gain: 0.1 },
  };

  let audioContext = null;
  let musicGain = null;
  let seGain = null;
  let songBuffer = null;
  let bufferLoadPromise = null;
  let currentSource = null;
  let melodyTimer = null;
  let currentAudioPath = "";
  let currentBpm = 193;
  let isPlaying = false;
  let playbackRateRef = 1;
  let offsetSecondsRef = 0;
  let muted = false;
  let volumes = { musicVolume: 100, seVolume: 80 };

  function ensureContext() {
    if (audioContext) return audioContext;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext = new AudioCtor();
    musicGain = audioContext.createGain();
    seGain = audioContext.createGain();
    musicGain.connect(audioContext.destination);
    seGain.connect(audioContext.destination);
    applyGainValues();
    return audioContext;
  }

  function applyGainValues() {
    if (!musicGain || !seGain) return;
    musicGain.gain.value = muted ? 0 : (volumes.musicVolume / 100) * 0.85;
    seGain.gain.value = muted ? 0 : (volumes.seVolume / 100) * 1;
  }

  function unlock() {
    const ctx = ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function configure({ audioPath, bpm }) {
    if (audioPath === currentAudioPath && (songBuffer || bufferLoadPromise)) {
      currentBpm = bpm || currentBpm;
      return bufferLoadPromise ?? Promise.resolve(songBuffer);
    }
    currentAudioPath = audioPath || "";
    currentBpm = bpm || currentBpm;
    songBuffer = null;
    if (!audioPath) {
      bufferLoadPromise = Promise.resolve(null);
      return bufferLoadPromise;
    }
    const ctx = ensureContext();
    if (!ctx) {
      bufferLoadPromise = Promise.resolve(null);
      return bufferLoadPromise;
    }
    bufferLoadPromise = fetch(audioPath)
      .then((response) => {
        if (!response.ok) throw new Error("audio fetch failed");
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        songBuffer = buffer;
        return buffer;
      })
      .catch(() => {
        songBuffer = null;
        return null;
      });
    return bufferLoadPromise;
  }

  function stopCurrentSource() {
    if (currentSource) {
      try {
        currentSource.onended = null;
        currentSource.stop();
      } catch {}
      try {
        currentSource.disconnect();
      } catch {}
      currentSource = null;
    }
    if (melodyTimer) {
      window.clearInterval(melodyTimer);
      melodyTimer = null;
    }
  }

  function scheduleMelody(atSongTime, startContextTime, playbackRate) {
    const melody = [392, 440, 493.88, 587.33, 659.25, 587.33, 493.88, 440];
    const beat = 60 / currentBpm;
    const contentTimeAt = (contextTime) => atSongTime + Math.max(0, contextTime - startContextTime) * playbackRate;
    let beatIndex = Math.floor(contentTimeAt(audioContext.currentTime) / beat);

    const tick = () => {
      if (!isPlaying || !audioContext) return;
      const lookahead = contentTimeAt(audioContext.currentTime) + beat * 8;
      while (beatIndex * beat < lookahead) {
        const targetContent = beatIndex * beat;
        const contextTime = startContextTime + (targetContent - atSongTime) / playbackRate;
        const playAt = Math.max(contextTime, audioContext.currentTime);
        const note = melody[((beatIndex % melody.length) + melody.length) % melody.length];
        playTone(note, playAt, beat * 0.3, "triangle", 0.07, "music");
        if (beatIndex % 2 === 0) playTone(98, playAt, beat * 0.22, "sine", 0.11, "music");
        if (beatIndex % 2 === 1) playNoiseBurst(playAt, 0.045, 0.03, "music");
        beatIndex += 1;
      }
    };

    tick();
    melodyTimer = window.setInterval(tick, 140);
  }

  function start({ atSongTime = 0, playbackRate = 1, offsetSeconds = 0, leadIn = 0.45 } = {}) {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    stopCurrentSource();
    playbackRateRef = playbackRate;
    offsetSecondsRef = offsetSeconds;
    const baseStart = ctx.currentTime + Math.max(0, leadIn);
    const shiftedStart = baseStart - offsetSeconds;
    const startContextTime = Math.max(ctx.currentTime, shiftedStart);
    const missedLead = Math.max(0, ctx.currentTime - shiftedStart);
    isPlaying = true;

    if (songBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = songBuffer;
      source.playbackRate.value = playbackRate;
      source.connect(musicGain);
      const contentPosition = Math.max(0, atSongTime + missedLead * playbackRate);
      try {
        source.start(startContextTime, contentPosition);
      } catch {
        try {
          source.start(ctx.currentTime, contentPosition);
        } catch {}
      }
      source.onended = () => {
        if (currentSource === source) currentSource = null;
      };
      currentSource = source;
    } else {
      scheduleMelody(atSongTime, startContextTime, playbackRate);
    }
  }

  function pause() {
    isPlaying = false;
    stopCurrentSource();
  }

  function resume(atSongTime, playbackRate = 1) {
    start({ atSongTime, playbackRate, offsetSeconds: offsetSecondsRef, leadIn: 0 });
  }

  function stop() {
    isPlaying = false;
    stopCurrentSource();
  }

  function isUsingRealAudio() {
    return Boolean(songBuffer);
  }

  function playTone(frequency, time, duration, type, gainValue, channel = "se") {
    if (!audioContext || muted) return;
    const target = channel === "music" ? musicGain : seGain;
    if (!target) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(target);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  function playNoiseBurst(time, duration, gainValue, channel = "se") {
    if (!audioContext || muted) return;
    const target = channel === "music" ? musicGain : seGain;
    if (!target) return;
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(target);
    source.start(time);
  }

  function playHitTone(kind) {
    if (!audioContext) return;
    const profile = HIT_TONE_PROFILES[kind] || HIT_TONE_PROFILES.tap;
    playTone(profile.frequency, audioContext.currentTime, profile.duration, profile.type, profile.gain, "se");
  }

  function playMissTone() {
    if (!audioContext) return;
    playNoiseBurst(audioContext.currentTime, 0.04, 0.05, "se");
  }

  function setMuted(value) {
    muted = value;
    applyGainValues();
  }

  function isMuted() {
    return muted;
  }

  function applyVolumes(settings) {
    volumes = { musicVolume: settings.musicVolume, seVolume: settings.seVolume };
    applyGainValues();
  }

  window.StarlightAudio = {
    configure,
    unlock,
    start,
    pause,
    resume,
    stop,
    isUsingRealAudio,
    playHitTone,
    playMissTone,
    setMuted,
    isMuted,
    applyVolumes,
  };

  if (window.StarlightSettings) {
    applyVolumes(window.StarlightSettings.get());
  }
})();
