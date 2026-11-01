(() => {
  "use strict";

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.querySelector("#score");
  const scoreProgressEl = document.querySelector("#scoreProgress");
  const comboCounterEl = document.querySelector("#comboCounter");
  const comboHudEl = document.querySelector("#comboHud");
  const rankEl = document.querySelector("#rank");
  const lifeBarEl = document.querySelector("#lifeBar");
  const lifeValueEl = document.querySelector("#lifeValue");
  const judgementEl = document.querySelector("#judgement");
  const judgementMainEl = document.querySelector("#judgementMain");
  const judgementSubEl = document.querySelector("#judgementSub");
  const chartLabelEl = document.querySelector("#chartLabel");
  const pauseButtonEl = document.querySelector("#pauseButton");
  const readyOverlayEl = document.querySelector("#readyOverlay");
  const readyCountEl = document.querySelector("#readyCount");
  const readySongTitleEl = document.querySelector("#readySongTitle");
  const pauseOverlayEl = document.querySelector("#pauseOverlay");

  const HIT_WINDOWS = [
    { key: "CRITICAL", label: "JUSTICE CRITICAL", ms: 70, weight: 1, color: "#ffd84a" },
    { key: "JUSTICE", label: "JUSTICE", ms: 130, weight: 0.7, color: "#6eefff" },
    { key: "ATTACK", label: "ATTACK", ms: 200, weight: 0.4, color: "#7cff9b" },
  ];
  const MISS_COLOR = "#b48cff";
  const MISS_WINDOW = 0.3;
  const MAX_LIFE = 1000;
  const MAX_SCORE = 1010000;
  const BASE_LEAD_TIME = 2.35;
  const BASE_SPEED = 2.5;
  const laneColors = ["#ff5c7a", "#ff8a5c", "#ffc35c", "#ffe066", "#a6ff7a", "#5cffcf", "#5cc8ff", "#b48cff"];
  const tapKeys = ["a", "s", "d", "f", "j", "k", "l", ";"];

  let currentSong = null;
  let DIVISIONS = 8;
  let beatSeconds = 60 / 193;
  let chart = [];
  let particles = [];
  let ripples = [];
  let laneBursts = Array.from({ length: DIVISIONS }, () => 0);
  let activePointers = new Map();
  let state = "idle";
  let practiceOptions = null;
  let judgementCounts = { CRITICAL: 0, JUSTICE: 0, ATTACK: 0, MISS: 0 };
  let weightedScore = 0;
  let timingEarly = 0;
  let timingLate = 0;
  let timingSumMs = 0;
  let timingSamples = 0;
  let combo = 0;
  let maxCombo = 0;
  let life = MAX_LIFE;
  let currentLeadTime = BASE_LEAD_TIME;
  let inputOffsetSeconds = 0;
  let effectsHigh = true;
  let particlesEnabled = true;
  let motionEnabled = true;
  let laneEffectEnabled = true;
  let judgementVoiceEnabled = true;
  let clockStartMs = 0;
  let atSongTimeRef = 0;
  let playbackRateRef = 1;
  let pausedSongTime = 0;
  let animationFrame = 0;
  let loopRunning = false;
  let judgementTimer = 0;
  let comboPopTimer = 0;
  let missFlashUntil = 0;
  let shakeUntil = 0;
  let countdownToken = 0;
  let resumeCountdownActive = false;
  let needsResize = true;
  let cachedSettings = {
    noteSpeed: 2.5,
    inputOffsetMs: 0,
    effects: "HIGH",
    particles: true,
    motion: true,
    laneEffect: true,
    judgementVoice: true,
    failEnabled: false,
    showJudgement: true,
    showCombo: true,
    timingFeedback: true,
    laneCover: 0,
    laneBrightness: 100,
    mirror: false,
  };

  function getLeadTime(speed) {
    return BASE_LEAD_TIME * (BASE_SPEED / Math.max(0.5, speed));
  }

  function applySettings(snapshot) {
    cachedSettings = { ...cachedSettings, ...snapshot };
    currentLeadTime = getLeadTime(cachedSettings.noteSpeed);
    inputOffsetSeconds = cachedSettings.inputOffsetMs / 1000;
    effectsHigh = cachedSettings.effects !== "LOW";
    particlesEnabled = cachedSettings.particles;
    motionEnabled = cachedSettings.motion;
    laneEffectEnabled = cachedSettings.laneEffect;
    judgementVoiceEnabled = cachedSettings.judgementVoice;
  }

  function mirrorLane(lane, width) {
    return DIVISIONS - width - lane;
  }

  function buildChart() {
    const settings = window.StarlightSettings.get();
    const mirrored = Boolean(settings.mirror);
    return currentSong.chart.notes.map((entry, index) => {
      const lane = mirrored ? mirrorLane(entry.lane, entry.width) : entry.lane;
      const endLane = mirrored ? mirrorLane(entry.endLane ?? entry.lane, entry.width) : entry.endLane ?? entry.lane;
      return {
        id: entry.id ?? `n-${index}`,
        type: entry.type,
        lane,
        width: entry.width,
        endLane,
        time: entry.beat * beatSeconds,
        endTime: entry.endBeat ? entry.endBeat * beatSeconds : null,
        hit: false,
        missed: false,
        started: false,
        finished: false,
        pointerId: null,
        pendingFlick: false,
        pendingAir: false,
        deviateSince: 0,
        lastHoldAward: 0,
      };
    });
  }

  function loadSong(song) {
    currentSong = song;
    DIVISIONS = song.chart.divisions ?? 8;
    beatSeconds = 60 / (song.chart.bpm || 193);
    laneBursts = Array.from({ length: DIVISIONS }, () => 0);
    if (chartLabelEl) chartLabelEl.textContent = song.chart.title || "CUSTOM CHART";
    window.StarlightAudio.configure({ audioPath: song.chart.audioPath, bpm: song.chart.bpm });
  }

  function resetStats() {
    weightedScore = 0;
    timingEarly = 0;
    timingLate = 0;
    timingSumMs = 0;
    timingSamples = 0;
    combo = 0;
    maxCombo = 0;
    life = MAX_LIFE;
    judgementCounts = { CRITICAL: 0, JUSTICE: 0, ATTACK: 0, MISS: 0 };
  }

  function setClock({ atSongTime = 0, playbackRate = 1, delaySeconds = 0 } = {}) {
    atSongTimeRef = atSongTime;
    playbackRateRef = playbackRate;
    clockStartMs = performance.now() + delaySeconds * 1000;
  }

  function rawSongTime() {
    if (state === "paused") return pausedSongTime;
    return atSongTimeRef + ((performance.now() - clockStartMs) / 1000) * playbackRateRef;
  }

  function judgeTime() {
    return rawSongTime() + inputOffsetSeconds;
  }

  function timingLabelFor(delta) {
    if (delta > 0.008) return "LATE";
    if (delta < -0.008) return "FAST";
    return null;
  }

  function totalNotes() {
    return Math.max(1, chart.length);
  }

  function judgedCount() {
    return judgementCounts.CRITICAL + judgementCounts.JUSTICE + judgementCounts.ATTACK + judgementCounts.MISS;
  }

  function computeScore() {
    const total = totalNotes();
    const base = (weightedScore / total) * 1000000;
    const comboBonus = judgementCounts.MISS === 0 ? 10000 * Math.min(1, judgedCount() / total) : 0;
    return Math.round(base + comboBonus);
  }

  function computeAccuracy() {
    const judged = judgedCount();
    if (judged === 0) return 100;
    const weighted = judgementCounts.CRITICAL * 1 + judgementCounts.JUSTICE * 0.7 + judgementCounts.ATTACK * 0.4;
    return (weighted / judged) * 100;
  }

  function computeRank(value) {
    if (value >= 1007500) return "SSS+";
    if (value >= 1000000) return "SSS";
    if (value >= 995000) return "SS+";
    if (value >= 990000) return "SS";
    if (value >= 985000) return "S+";
    if (value >= 975000) return "S";
    if (value >= 950000) return "AAA";
    if (value >= 900000) return "AA";
    if (value >= 850000) return "A";
    if (value >= 750000) return "BBB";
    if (value >= 650000) return "BB";
    if (value >= 500000) return "B";
    if (value >= 350000) return "C";
    return "D";
  }

  function formatScore(value) {
    return window.StarlightFormat ? window.StarlightFormat.score(value) : String(Math.round(value));
  }

  function updateHud() {
    const currentScore = computeScore();
    scoreEl.textContent = formatScore(currentScore);
    if (comboCounterEl) comboCounterEl.textContent = String(combo);
    rankEl.textContent = judgedCount() >= 5 ? computeRank(computeAccuracy() * 10000) : "-";
    lifeValueEl.textContent = practiceOptions ? "---" : String(life);
    lifeBarEl.style.width = practiceOptions ? "100%" : `${Math.max(0, Math.min(100, (life / MAX_LIFE) * 100))}%`;
    scoreProgressEl.style.width = `${Math.max(0, Math.min(100, (currentScore / MAX_SCORE) * 100))}%`;
  }

  function popCombo() {
    if (!comboHudEl) return;
    comboHudEl.classList.add("is-pop");
    window.clearTimeout(comboPopTimer);
    comboPopTimer = window.setTimeout(() => comboHudEl.classList.remove("is-pop"), 90);
  }

  function showJudgement(text, color, timingLabel) {
    if (!cachedSettings.showJudgement) return;
    judgementMainEl.textContent = text;
    judgementMainEl.style.color = color;
    judgementMainEl.style.textShadow = `0 0 ${effectsHigh ? 22 : 10}px ${color}`;
    judgementSubEl.textContent = cachedSettings.timingFeedback ? timingLabel || "" : "";
    judgementEl.classList.add("is-active");
    judgementTimer = performance.now() + 420;
  }

  function loseLife(amount) {
    if (practiceOptions || !cachedSettings.failEnabled) {
      updateHud();
      return;
    }
    life = Math.max(0, life - amount);
    updateHud();
    if (life <= 0 && state === "playing") endGame(true);
  }

  function addCombo(quality, award = true) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    if (award && quality) weightedScore += quality.weight;
    popCombo();
    updateHud();
    if (combo > 0 && combo % 50 === 0) window.StarlightHaptics.trigger("combo");
  }

  function spawnParticles(x, y, color, count = 16) {
    const layout = getLayout();
    const actualCount = effectsHigh ? count : Math.ceil(count / 2);
    for (let i = 0; i < actualCount; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = 3 + Math.random() * 8;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: layout.width * (0.002 + Math.random() * 0.003),
      });
    }
  }

  function spawnRipple(x, y) {
    if (!motionEnabled) return;
    ripples.push({ x, y, radius: 4, life: 1 });
  }

  function updateRipples() {
    const layout = getLayout();
    ripples = ripples.filter((ripple) => ripple.life > 0.02);
    for (const ripple of ripples) {
      ripple.radius += layout.width * 0.006;
      ripple.life *= 0.88;
    }
  }

  function drawRipples() {
    for (const ripple of ripples) {
      ctx.save();
      ctx.globalAlpha = ripple.life * 0.5;
      ctx.strokeStyle = "#bdf6ff";
      ctx.lineWidth = Math.max(1, getLayout().width * 0.0018);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function noteColor(note) {
    if (note.type === "gold") return "#ffd84a";
    if (note.type === "hold") return "#63ffc9";
    if (note.type === "flick") return "#ff6ad5";
    if (note.type === "air") return "#eef3ff";
    if (note.type === "slide") return "#ffa84a";
    return "#7ce8ff";
  }

  function isTrail(note) {
    return note.type === "hold" || note.type === "slide";
  }

  function recordTiming(delta) {
    if (!Number.isFinite(delta)) return;
    const ms = delta * 1000;
    timingSumMs += ms;
    timingSamples += 1;
    if (ms > 8) timingLate += 1;
    else if (ms < -8) timingEarly += 1;
  }

  function hitNote(note, quality, point, timingLabel, delta = null) {
    recordTiming(delta);
    note.hit = true;
    note.finished = true;
    if (laneEffectEnabled) laneBursts[note.lane] = 1;
    judgementCounts[quality.key] += 1;
    addCombo(quality);
    showJudgement(quality.label, quality.color, timingLabel);
    if (particlesEnabled) spawnParticles(point.x, point.y, noteColor(note), note.type === "gold" ? 26 : 18);
    if (judgementVoiceEnabled) window.StarlightAudio.playHitTone(note.type === "gold" ? "gold" : note.type === "flick" ? "flick" : "tap");
    window.StarlightHaptics.trigger(quality.key === "CRITICAL" ? "perfect" : "tap");
  }

  function startHold(note, quality, pointerId, point) {
    note.started = true;
    note.pointerId = pointerId;
    note.deviateSince = 0;
    note.lastHoldAward = rawSongTime();
    if (laneEffectEnabled) laneBursts[note.lane] = 1;
    addCombo(quality, false);
    showJudgement("HOLD", "#71ff99", null);
    if (particlesEnabled) spawnParticles(point.x, point.y, "#71ff99", 16);
    if (judgementVoiceEnabled) window.StarlightAudio.playHitTone("holdStart");
    window.StarlightHaptics.trigger("tap");
  }

  function finishHold(note, point, forcedQuality) {
    if (note.finished || note.missed) return;
    const quality = forcedQuality ?? HIT_WINDOWS[0];
    note.hit = true;
    note.finished = true;
    note.pointerId = null;
    if (laneEffectEnabled) laneBursts[note.endLane] = 1;
    judgementCounts[quality.key] += 1;
    addCombo(quality);
    showJudgement(quality.label, quality.color, null);
    if (particlesEnabled) spawnParticles(point.x, point.y, "#71ff99", 24);
    if (judgementVoiceEnabled) window.StarlightAudio.playHitTone("holdEnd");
    window.StarlightHaptics.trigger(quality.key === "CRITICAL" ? "perfect" : "tap");
  }

  function failNote(note) {
    if (note.missed || note.finished) return;
    note.missed = true;
    note.pointerId = null;
    combo = 0;
    judgementCounts.MISS += 1;
    loseLife(note.type === "hold" ? 85 : 60);
    showJudgement("MISS", MISS_COLOR, null);
    if (judgementVoiceEnabled) window.StarlightAudio.playMissTone();
    window.StarlightHaptics.trigger("miss");
    if (motionEnabled) {
      missFlashUntil = performance.now() + 220;
      shakeUntil = performance.now() + 180;
    }
    updateHud();
  }

  function findCandidate(point) {
    const layout = getLayout();
    const jt = judgeTime();
    let candidate = null;
    let candidateAbsDelta = Infinity;
    for (const note of chart) {
      if (note.missed || note.finished || note.pendingFlick || note.pendingAir) continue;
      if (isTrail(note) && note.started) continue;
      const delta = jt - note.time;
      const absDelta = Math.abs(delta);
      const quality = HIT_WINDOWS.find((hitWindow) => absDelta * 1000 <= hitWindow.ms);
      if (!quality) continue;
      if (!pointMatchesNote(point, note, layout)) continue;
      if (absDelta < candidateAbsDelta) {
        candidate = { note, quality, delta };
        candidateAbsDelta = absDelta;
      }
    }
    return candidate;
  }

  function handleCandidate(candidate, point, pointer) {
    if (!candidate) return false;
    const { note, quality, delta } = candidate;

    if (isTrail(note)) {
      startHold(note, quality, pointer.id, point);
      return true;
    }

    if (note.type === "air") {
      note.pendingAir = true;
      note.pointerId = pointer.id;
      pointer.pendingAir = note.id;
      showJudgement("AIR", "#eef3ff", null);
      if (laneEffectEnabled) laneBursts[note.lane] = 1;
      return true;
    }

    if (note.type === "flick") {
      note.pendingFlick = true;
      note.pointerId = pointer.id;
      pointer.pendingFlick = note.id;
      showJudgement("FLICK", "#ff5ad6", null);
      if (laneEffectEnabled) laneBursts[note.lane] = 1;
      return true;
    }

    hitNote(note, quality, point, timingLabelFor(delta), delta);
    return true;
  }

  function tryFinishFlick(pointer) {
    if (!pointer.pendingFlick) return false;
    const note = chart.find((item) => item.id === pointer.pendingFlick);
    if (!note || note.finished || note.missed) return false;
    const moveX = pointer.point.x - pointer.startPoint.x;
    const moveY = pointer.point.y - pointer.startPoint.y;
    const distance = Math.hypot(moveX, moveY);
    const threshold = getLayout().height * 0.055;
    const jt = judgeTime();
    const delta = jt - note.time;
    const quality = HIT_WINDOWS.find((hitWindow) => Math.abs(delta) * 1000 <= hitWindow.ms + 70) ?? HIT_WINDOWS[2];

    if (distance < threshold && jt < note.time + MISS_WINDOW) return false;
    hitNote(note, quality, pointer.point, timingLabelFor(delta), delta);
    note.pendingFlick = false;
    note.pointerId = null;
    pointer.pendingFlick = null;
    return true;
  }

  function tryFinishAir(pointer) {
    if (!pointer.pendingAir) return false;
    const note = chart.find((item) => item.id === pointer.pendingAir);
    if (!note || note.finished || note.missed) {
      pointer.pendingAir = null;
      return false;
    }
    const lift = pointer.startPoint.y - pointer.point.y;
    if (lift < getLayout().height * 0.045) return false;
    const jt = judgeTime();
    const delta = jt - note.time;
    const quality = HIT_WINDOWS.find((hitWindow) => Math.abs(delta) * 1000 <= hitWindow.ms + 70) ?? HIT_WINDOWS[2];
    note.pendingAir = false;
    note.pointerId = null;
    pointer.pendingAir = null;
    hitNote(note, quality, pointer.point, timingLabelFor(delta), delta);
    return true;
  }

  function cancelPendingAir(pointer) {
    if (!pointer.pendingAir) return;
    const note = chart.find((item) => item.id === pointer.pendingAir);
    pointer.pendingAir = null;
    if (!note || note.finished || note.missed) return;
    note.pendingAir = false;
    note.pointerId = null;
    failNote(note);
  }

  function updateActiveHolds(songTime) {
    for (const note of chart) {
      if (!isTrail(note) || !note.started || note.finished || note.missed) continue;
      if (note.pointerId === -1) continue;
      const pointer = activePointers.get(note.pointerId);
      if (!pointer) {
        if (songTime < note.endTime - MISS_WINDOW) failNote(note);
        continue;
      }

      const layout = getLayout();
      const targetLane = holdLaneAt(note, songTime);
      const expected = pointAtLane(targetLane, layout.hitY, layout);
      const tolerance = layout.hitWidth * (note.type === "slide" ? 0.3 : 0.16);
      const offLane = Math.abs(pointer.point.x - expected.x) > tolerance;
      if (laneEffectEnabled && songTime > note.time + 0.16 && offLane) {
        laneBursts[Math.round(targetLane)] = 0.5;
      }

      if (note.type === "slide") {
        if (offLane) {
          if (!note.deviateSince) note.deviateSince = songTime;
          if (songTime - note.deviateSince > 0.22) {
            failNote(note);
            continue;
          }
        } else {
          note.deviateSince = 0;
        }
      }

      if (songTime - note.lastHoldAward > beatSeconds * 1.5 && songTime < note.endTime - 0.1) {
        note.lastHoldAward = songTime;
        addCombo(null, false);
      }

      if (songTime >= note.endTime - 0.03) {
        const endPoint = pointAtLane(note.endLane, layout.hitY, layout);
        const strayed = Math.abs(pointer.point.x - endPoint.x) > layout.hitWidth * 0.18;
        finishHold(note, endPoint, strayed ? HIT_WINDOWS[1] : HIT_WINDOWS[0]);
      }
    }
  }

  function autoPlayEnabled() {
    return Boolean(practiceOptions && practiceOptions.autoPlay);
  }

  function runAutoPlay(songTime) {
    const layout = getLayout();
    for (const note of chart) {
      if (note.missed || note.finished) continue;
      if (isTrail(note)) {
        if (!note.started && songTime >= note.time) {
          startHold(note, HIT_WINDOWS[0], -1, pointAtLane(note.lane, layout.hitY, layout));
        } else if (note.started && songTime >= note.endTime) {
          finishHold(note, pointAtLane(note.endLane, layout.hitY, layout), HIT_WINDOWS[0]);
        }
        continue;
      }
      if (songTime >= note.time) {
        hitNote(note, HIT_WINDOWS[0], pointAtLane(note.lane, layout.hitY, layout), null);
      }
    }
  }

  function missOldNotes(songTime) {
    for (const note of chart) {
      if (note.finished || note.missed) continue;
      if (isTrail(note)) {
        if (!note.started && songTime - note.time > MISS_WINDOW) failNote(note);
        if (note.started && note.pointerId !== -1 && songTime - note.endTime > MISS_WINDOW) failNote(note);
        continue;
      }
      if (songTime - note.time > MISS_WINDOW) failNote(note);
    }
  }

  function updatePracticeLoop(songTime) {
    if (!practiceOptions) return;
    if (songTime >= practiceOptions.endSeconds) {
      if (practiceOptions.loop) {
        restartPracticeSegment();
      } else {
        togglePause();
      }
    }
  }

  function restartPracticeSegment() {
    const start = practiceOptions.startSeconds;
    const end = practiceOptions.endSeconds;
    for (const note of chart) {
      const inRange = (note.time >= start && note.time < end) || (note.endTime && note.endTime > start && note.endTime <= end);
      if (!inRange) continue;
      note.hit = false;
      note.missed = false;
      note.started = false;
      note.finished = false;
      note.pointerId = null;
      note.pendingFlick = false;
      note.pendingAir = false;
      note.deviateSince = 0;
    }
    particles = [];
    activePointers = new Map();
    resetStats();
    updateHud();
    const settings = window.StarlightSettings.get();
    setClock({ atSongTime: start, playbackRate: practiceOptions.speed, delaySeconds: 0 });
    window.StarlightAudio.start({ atSongTime: start, playbackRate: practiceOptions.speed, offsetSeconds: settings.audioOffsetMs / 1000, leadIn: 0 });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    needsResize = false;
  }

  function getLayout() {
    const width = canvas.width;
    const height = canvas.height;
    const center = width / 2;
    const topY = height * 0.05;
    const hitY = height * 0.8;
    const frontY = height * 0.9;
    const topWidth = width * 0.315;
    const hitWidth = width * 0.615;
    const frontWidth = width * 0.69;
    const topLeft = center - topWidth / 2;
    const topRight = center + topWidth / 2;
    const hitLeft = center - hitWidth / 2;
    const hitRight = center + hitWidth / 2;
    const frontLeft = center - frontWidth / 2;
    const frontRight = center + frontWidth / 2;
    return {
      width, height, center, topY, hitY, frontY,
      topWidth, hitWidth, frontWidth,
      topLeft, topRight, hitLeft, hitRight, frontLeft, frontRight,
    };
  }

  function fieldLeftAt(progress, layout) {
    if (progress <= 1) return layout.topLeft + (layout.hitLeft - layout.topLeft) * Math.max(0, progress);
    return layout.hitLeft + (layout.frontLeft - layout.hitLeft) * Math.min(1, progress - 1);
  }

  function fieldWidthAt(progress, layout) {
    if (progress <= 1) return layout.topWidth + (layout.hitWidth - layout.topWidth) * Math.max(0, progress);
    return layout.hitWidth + (layout.frontWidth - layout.hitWidth) * Math.min(1, progress - 1);
  }

  function pointAtLane(lane, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    const left = fieldLeftAt(progress, layout);
    const width = fieldWidthAt(progress, layout);
    return { x: left + ((lane + 0.5) / DIVISIONS) * width, y };
  }

  function laneWidthAt(note, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    return (fieldWidthAt(progress, layout) / DIVISIONS) * note.width;
  }

  function timeToY(time, songTime, layout) {
    const progress = 1 - (time - songTime) / currentLeadTime;
    const eased = Math.max(0, Math.min(1.08, progress)) ** 1.45;
    return { y: layout.topY + (layout.hitY - layout.topY) * eased, progress: eased };
  }

  function projectNoteAt(lane, time, songTime, layout) {
    const { y, progress } = timeToY(time, songTime, layout);
    const point = pointAtLane(lane, y, layout);
    return { x: point.x, y, progress };
  }

  function holdLaneAt(note, songTime) {
    if (!note.endTime || songTime <= note.time) return note.lane;
    const ratio = Math.max(0, Math.min(1, (songTime - note.time) / (note.endTime - note.time)));
    return note.lane + (note.endLane - note.lane) * ratio;
  }

  function pointMatchesNote(point, note, layout) {
    const isAir = note.type === "air";
    const minY = isAir ? layout.topY + layout.height * 0.01 : layout.hitY - layout.height * 0.16;
    const maxY = isAir ? layout.hitY - layout.height * 0.16 : layout.frontY + layout.height * 0.12;
    if (point.y < minY || point.y > maxY) return false;
    const center = pointAtLane(note.lane, layout.hitY, layout);
    const width = laneWidthAt(note, layout.hitY, layout) + layout.hitWidth * 0.045;
    return Math.abs(point.x - center.x) <= width / 2;
  }

  function laneFromPoint(point, layout) {
    const minY = layout.hitY - layout.height * 0.16;
    const maxY = layout.frontY + layout.height * 0.12;
    if (point.y < minY || point.y > maxY) return -1;
    const p = Math.max(0, Math.min(1.08, (point.y - layout.topY) / Math.max(1, layout.hitY - layout.topY)));
    const left = fieldLeftAt(p, layout);
    const width = fieldWidthAt(p, layout);
    if (point.x < left || point.x > left + width) return -1;
    const lane = Math.floor(((point.x - left) / width) * DIVISIONS);
    return Math.max(0, Math.min(DIVISIONS - 1, lane));
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function drawBackground(layout, songTime) {
    const { width, height, topY, hitY, frontY, topLeft, topRight, hitLeft, hitRight, frontLeft, frontRight } = layout;

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#04121b");
    sky.addColorStop(0.42, "#0a2231");
    sky.addColorStop(0.82, "#07161f");
    sky.addColorStop(1, "#030c13");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = effectsHigh ? 0.2 : 0.12;
    ctx.strokeStyle = "#63e9ff";
    ctx.lineWidth = Math.max(1, width * 0.0009);
    const streakCount = effectsHigh ? 9 : 4;
    for (let i = 0; i < streakCount; i += 1) {
      const y = ((songTime * 38 + i * 83) % (height * 1.4)) - height * 0.2;
      const x = width * 0.5 + (i - streakCount / 2) * width * 0.07;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + height * 0.08, y + height * 0.26);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(topLeft, topY);
    ctx.lineTo(topRight, topY);
    ctx.lineTo(hitRight, hitY);
    ctx.lineTo(hitLeft, hitY);
    ctx.closePath();
    ctx.clip();

    const laneFill = ctx.createLinearGradient(0, topY, 0, hitY);
    laneFill.addColorStop(0, "rgba(4, 18, 26, 0.94)");
    laneFill.addColorStop(0.55, "rgba(7, 30, 42, 0.9)");
    laneFill.addColorStop(1, "rgba(10, 44, 60, 0.88)");
    ctx.fillStyle = laneFill;
    ctx.fillRect(0, topY, width, hitY - topY);

    const laneBrightness = Math.max(0.4, Math.min(1, (Number(cachedSettings.laneBrightness) || 100) / 100));
    if (laneBrightness < 1) {
      ctx.fillStyle = `rgba(2, 8, 13, ${(1 - laneBrightness) * 0.82})`;
      ctx.fillRect(0, topY, width, hitY - topY);
    }

    const topCell = layout.topWidth / DIVISIONS;
    const hitCell = layout.hitWidth / DIVISIONS;
    for (let i = 0; i <= DIVISIONS; i += 1) {
      const isEdge = i === 0 || i === DIVISIONS;
      ctx.strokeStyle = isEdge ? "rgba(110, 239, 255, 0.6)" : "rgba(120, 232, 255, 0.18)";
      ctx.lineWidth = Math.max(1, width * (isEdge ? 0.0022 : 0.0011));
      ctx.beginPath();
      ctx.moveTo(topLeft + i * topCell, topY);
      ctx.lineTo(hitLeft + i * hitCell, hitY);
      ctx.stroke();
    }

    for (let lane = 0; lane < DIVISIONS; lane += 1) {
      const burst = laneBursts[lane] || 0;
      const left = hitLeft + lane * hitCell;
      const glow = ctx.createLinearGradient(0, hitY - height * 0.2, 0, hitY);
      glow.addColorStop(0, "rgba(0, 0, 0, 0)");
      glow.addColorStop(1, hexToRgba(laneColors[lane % laneColors.length], 0.1 + burst * 0.55));
      ctx.fillStyle = glow;
      ctx.fillRect(left, hitY - height * 0.2, hitCell, height * 0.2);
    }

    const beat = beatSeconds;
    const firstBeat = Math.max(0, Math.floor(songTime / beat) - 1);
    const lastBeat = Math.ceil((songTime + currentLeadTime) / beat) + 1;
    for (let b = firstBeat; b <= lastBeat; b += 1) {
      if (b < 0) continue;
      const { y, progress } = timeToY(b * beat, songTime, layout);
      if (progress <= 0.001 || progress > 1.001) continue;
      const measure = b % 4 === 0;
      ctx.strokeStyle = measure ? "rgba(245, 223, 79, 0.4)" : "rgba(110, 239, 255, 0.12)";
      ctx.lineWidth = Math.max(1, width * (measure ? 0.0018 : 0.0009));
      const left = fieldLeftAt(progress, layout);
      const fieldWidth = fieldWidthAt(progress, layout);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + fieldWidth, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(120, 238, 255, 0.85)";
    ctx.shadowColor = "#29dff4";
    ctx.shadowBlur = effectsHigh ? width * 0.012 : 0;
    ctx.lineWidth = Math.max(2, width * 0.002);
    ctx.beginPath();
    ctx.moveTo(topLeft, topY);
    ctx.lineTo(topRight, topY);
    ctx.lineTo(hitRight, hitY);
    ctx.lineTo(frontRight, frontY);
    ctx.lineTo(frontLeft, frontY);
    ctx.lineTo(hitLeft, hitY);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const band = ctx.createLinearGradient(0, hitY - height * 0.014, 0, hitY + height * 0.014);
    band.addColorStop(0, "rgba(255, 216, 74, 0)");
    band.addColorStop(0.5, "rgba(255, 216, 74, 0.95)");
    band.addColorStop(1, "rgba(255, 216, 74, 0)");
    ctx.fillStyle = band;
    ctx.shadowColor = "#ffd84a";
    ctx.shadowBlur = effectsHigh ? width * 0.02 : 0;
    ctx.fillRect(hitLeft, hitY - height * 0.014, hitRight - hitLeft, height * 0.028);
    ctx.restore();

    ctx.save();
    const front = ctx.createLinearGradient(0, hitY, 0, frontY);
    front.addColorStop(0, "rgba(4, 20, 30, 0.9)");
    front.addColorStop(1, "rgba(2, 9, 14, 0.98)");
    ctx.fillStyle = front;
    ctx.beginPath();
    ctx.moveTo(hitLeft, hitY);
    ctx.lineTo(hitRight, hitY);
    ctx.lineTo(frontRight, frontY);
    ctx.lineTo(frontLeft, frontY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(110, 239, 255, 0.3)";
    ctx.lineWidth = Math.max(1, width * 0.0012);
    for (let i = 1; i < DIVISIONS; i += 1) {
      const xTop = hitLeft + (i / DIVISIONS) * layout.hitWidth;
      const xBottom = frontLeft + (i / DIVISIONS) * layout.frontWidth;
      ctx.beginPath();
      ctx.moveTo(xTop, hitY);
      ctx.lineTo(xBottom, frontY);
      ctx.stroke();
    }
    ctx.restore();

    for (let lane = 0; lane < DIVISIONS; lane += 1) {
      const burst = laneBursts[lane] || 0;
      const left = hitLeft + lane * hitCell;
      ctx.save();
      ctx.globalAlpha = 0.3 + burst * 0.65;
      ctx.fillStyle = laneColors[lane % laneColors.length];
      ctx.shadowColor = laneColors[lane % laneColors.length];
      ctx.shadowBlur = effectsHigh ? width * 0.01 : 0;
      ctx.fillRect(left + hitCell * 0.14, hitY + height * 0.004, hitCell * 0.72, height * 0.009);
      ctx.restore();
    }
  }

  function drawLaneCover(layout) {
    const cover = Math.max(0, Math.min(40, Number(cachedSettings.laneCover) || 0));
    if (cover <= 0) return;
    const height = (layout.hitY - layout.topY) * (cover / 100);
    const progress = height / Math.max(1, layout.hitY - layout.topY);
    const bottomLeft = fieldLeftAt(progress, layout);
    const bottomWidth = fieldWidthAt(progress, layout);
    ctx.save();
    const grad = ctx.createLinearGradient(0, layout.topY, 0, layout.topY + height);
    grad.addColorStop(0, "rgba(2, 8, 13, 0.99)");
    grad.addColorStop(0.85, "rgba(2, 8, 13, 0.97)");
    grad.addColorStop(1, "rgba(2, 8, 13, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(layout.topLeft, layout.topY);
    ctx.lineTo(layout.topRight, layout.topY);
    ctx.lineTo(bottomLeft + bottomWidth, layout.topY + height);
    ctx.lineTo(bottomLeft, layout.topY + height);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(110, 239, 255, 0.4)";
    ctx.lineWidth = Math.max(1, layout.width * 0.0012);
    ctx.beginPath();
    ctx.moveTo(bottomLeft, layout.topY + height);
    ctx.lineTo(bottomLeft + bottomWidth, layout.topY + height);
    ctx.stroke();
    ctx.restore();
  }

  function drawHoldBody(note, layout, songTime) {
    const startTime = Math.max(note.time, songTime);
    const startLane = songTime > note.time ? holdLaneAt(note, songTime) : note.lane;
    const start = projectNoteAt(startLane, startTime, songTime, layout);
    const end = projectNoteAt(note.endLane, note.endTime, songTime, layout);
    if (end.progress < 0 || start.progress > 1.1) return;
    const startWidth = laneWidthAt({ width: note.width }, start.y, layout);
    const endWidth = laneWidthAt({ width: note.width }, end.y, layout);

    const isSlideNote = note.type === "slide";
    ctx.save();
    const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    grad.addColorStop(0, isSlideNote ? "rgba(255, 168, 74, 0.85)" : "rgba(99, 255, 201, 0.85)");
    grad.addColorStop(1, isSlideNote ? "rgba(255, 232, 160, 0.62)" : "rgba(124, 232, 255, 0.62)");
    ctx.fillStyle = grad;
    ctx.shadowBlur = effectsHigh ? layout.width * 0.022 : 0;
    ctx.shadowColor = isSlideNote ? "#ffa84a" : "#63ffc9";
    ctx.beginPath();
    ctx.moveTo(start.x - startWidth / 2, start.y);
    ctx.lineTo(start.x + startWidth / 2, start.y);
    ctx.lineTo(end.x + endWidth / 2, end.y);
    ctx.lineTo(end.x - endWidth / 2, end.y);
    ctx.closePath();
    ctx.fill();

    if (isSlideNote) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 245, 220, 0.8)";
      ctx.lineWidth = Math.max(1.5, layout.width * 0.0018);
      for (let i = 1; i < 5; i += 1) {
        const t = i / 5;
        const arrowX = start.x + (end.x - start.x) * t;
        const arrowY = start.y + (end.y - start.y) * t;
        const arrowW = startWidth * 0.22;
        ctx.beginPath();
        ctx.moveTo(arrowX - arrowW, arrowY - arrowW * 0.5);
        ctx.lineTo(arrowX, arrowY + arrowW * 0.4);
        ctx.lineTo(arrowX + arrowW, arrowY - arrowW * 0.5);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawTapNote(note, layout, songTime) {
    const projected = projectNoteAt(note.lane, note.time, songTime, layout);
    if (projected.progress < 0 || projected.progress > 1.11) return;
    const noteWidth = laneWidthAt(note, projected.y, layout) * 0.94;
    const noteHeight = layout.height * (0.015 + projected.progress * 0.028);
    const color = noteColor(note);

    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(0, 8, 14, 0.9)";
    roundRect(-noteWidth / 2, -noteHeight / 2 + noteHeight * 0.45, noteWidth, noteHeight, noteHeight * 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.shadowBlur = effectsHigh ? layout.width * 0.016 : 0;
    ctx.shadowColor = color;
    const body = ctx.createLinearGradient(0, -noteHeight / 2, 0, noteHeight / 2);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.35, color);
    body.addColorStop(1, color);
    ctx.fillStyle = body;
    roundRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight, noteHeight * 0.32);
    ctx.fill();

    if (note.type === "air") {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(238, 243, 255, 0.95)";
      ctx.lineWidth = Math.max(2, layout.width * 0.0024);
      for (let i = 0; i < 2; i += 1) {
        const arrowY = -noteHeight * (0.55 + i * 0.62) - noteHeight * 0.3;
        ctx.beginPath();
        ctx.moveTo(-noteWidth * 0.26, arrowY + noteHeight * 0.3);
        ctx.lineTo(0, arrowY);
        ctx.lineTo(noteWidth * 0.26, arrowY + noteHeight * 0.3);
        ctx.stroke();
      }
    } else if (note.type === "flick") {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, layout.width * 0.0022);
      for (let i = 0; i < 2; i += 1) {
        const y = -noteHeight * (0.85 + i * 0.52);
        ctx.beginPath();
        ctx.moveTo(-noteWidth * 0.22, y + noteHeight * 0.18);
        ctx.lineTo(0, y - noteHeight * 0.12);
        ctx.lineTo(noteWidth * 0.22, y + noteHeight * 0.18);
        ctx.stroke();
      }
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      roundRect(-noteWidth * 0.32, -noteHeight * 0.15, noteWidth * 0.64, noteHeight * 0.18, noteHeight * 0.1);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawNotes(layout, songTime) {
    for (const note of chart) {
      if (note.missed || note.finished) continue;
      if (isTrail(note)) {
        if (note.endTime - songTime > currentLeadTime || songTime - note.endTime > MISS_WINDOW) continue;
        drawHoldBody(note, layout, songTime);
      }
    }

    for (const note of chart) {
      if (note.missed || note.finished) continue;
      if (isTrail(note)) {
        if (!note.started && note.time - songTime < currentLeadTime && songTime - note.time < MISS_WINDOW) {
          drawTapNote({ ...note }, layout, songTime);
        }
        if (note.endTime - songTime < currentLeadTime && songTime - note.endTime < MISS_WINDOW) {
          drawTapNote({ ...note, lane: note.endLane, time: note.endTime }, layout, songTime);
        }
        continue;
      }
      if (note.time - songTime > currentLeadTime || songTime - note.time > MISS_WINDOW) continue;
      if (note.type === "air") {
        drawTapNote({ ...note, time: note.time + currentLeadTime * 0.3 }, layout, songTime);
        continue;
      }
      drawTapNote(note, layout, songTime);
    }
  }

  function drawParticles() {
    particles = particles.filter((particle) => particle.life > 0.025);
    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.22;
      particle.life *= 0.92;
      ctx.save();
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = effectsHigh ? 10 : 0;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function loop() {
    if (!loopRunning) return;
    if (needsResize) resizeCanvas();
    const layout = getLayout();

    const songTime = rawSongTime();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shakeActive = motionEnabled && performance.now() < shakeUntil;
    ctx.save();
    if (shakeActive) {
      ctx.translate((Math.random() - 0.5) * layout.width * 0.012, (Math.random() - 0.5) * layout.height * 0.012);
    }
    drawBackground(layout, songTime);
    if (state === "playing" || state === "paused" || state === "ready") {
      drawNotes(layout, songTime);
      drawRipples();
      if (particlesEnabled) drawParticles();
      drawLaneCover(layout);
    }
    ctx.restore();

    if (missFlashUntil && performance.now() < missFlashUntil) {
      ctx.save();
      ctx.globalAlpha = 0.26 * ((missFlashUntil - performance.now()) / 220);
      ctx.fillStyle = "#ff2d3d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else if (missFlashUntil) {
      missFlashUntil = 0;
    }

    for (let i = 0; i < laneBursts.length; i += 1) laneBursts[i] *= 0.86;
    updateRipples();

    if (performance.now() > judgementTimer) judgementEl.classList.remove("is-active");

    if (state === "playing") {
      if (practiceOptions) updatePracticeLoop(songTime);
      updateActiveHolds(songTime);
      if (autoPlayEnabled()) runAutoPlay(songTime);
      missOldNotes(songTime);
      if (!practiceOptions) {
        const lastNoteTime = chart.reduce((last, note) => Math.max(last, note.endTime ?? note.time), 0);
        const allDone = chart.every((note) => note.finished || note.missed);
        if ((songTime > lastNoteTime + 1.3 && allDone) || songTime > lastNoteTime + 2.4) {
          endGame(false);
          return;
        }
      }
    }

    animationFrame = requestAnimationFrame(loop);
  }

  function ensureLoopRunning() {
    if (loopRunning) return;
    loopRunning = true;
    animationFrame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    loopRunning = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function eventToCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event) {
    if (state !== "playing") return;
    event.preventDefault();
    const point = eventToCanvasPoint(event);
    const layout = getLayout();
    const lane = laneFromPoint(point, layout);
    if (lane !== -1 && laneEffectEnabled) laneBursts[lane] = 0.85;
    spawnRipple(point.x, point.y);
    window.StarlightHaptics.trigger("tap");
    const pointer = { id: event.pointerId, startPoint: point, point, pendingFlick: null, pendingAir: null };
    activePointers.set(event.pointerId, pointer);
    canvas.setPointerCapture?.(event.pointerId);
    const candidate = findCandidate(point);
    handleCandidate(candidate, point, pointer);
  }

  function handlePointerMove(event) {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.point = eventToCanvasPoint(event);
    const lane = laneFromPoint(pointer.point, getLayout());
    if (lane !== -1 && laneEffectEnabled) laneBursts[lane] = Math.max(laneBursts[lane], 0.45);
    tryFinishAir(pointer);
    tryFinishFlick(pointer);
  }

  function releaseHoldsFor(pointerId, point) {
    const jt = judgeTime();
    for (const note of chart) {
      if (!isTrail(note) || note.pointerId !== pointerId || note.finished || note.missed) continue;
      if (jt >= note.endTime - MISS_WINDOW) {
        const remaining = Math.abs(note.endTime - jt);
        const quality = remaining * 1000 <= HIT_WINDOWS[1].ms ? HIT_WINDOWS[0] : HIT_WINDOWS[1];
        finishHold(note, point, quality);
      } else {
        failNote(note);
      }
    }
  }

  function handlePointerUp(event) {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.point = eventToCanvasPoint(event);
    tryFinishAir(pointer);
    cancelPendingAir(pointer);
    tryFinishFlick(pointer);
    releaseHoldsFor(event.pointerId, pointer.point);
    activePointers.delete(event.pointerId);
  }

  function hitKeyboardLane(lane) {
    if (state !== "playing") return;
    const pointerId = -(100 + lane);
    if (activePointers.has(pointerId)) return;
    const layout = getLayout();
    const point = pointAtLane(lane, layout.hitY, layout);
    if (laneEffectEnabled) laneBursts[lane] = Math.max(laneBursts[lane], 0.6);
    const pointer = { id: pointerId, startPoint: point, point, pendingFlick: null, pendingAir: null };
    activePointers.set(pointerId, pointer);
    const candidate = findCandidate(point);
    if (candidate?.note.type === "flick" || candidate?.note.type === "air") {
      hitNote(candidate.note, candidate.quality, point, timingLabelFor(candidate.delta), candidate.delta);
      activePointers.delete(pointerId);
      return;
    }
    handleCandidate(candidate, point, pointer);
  }

  function releaseKeyboardLane(lane) {
    const pointerId = -(100 + lane);
    const pointer = activePointers.get(pointerId);
    if (!pointer) return;
    releaseHoldsFor(pointerId, pointer.point);
    activePointers.delete(pointerId);
  }

  function showReadyOverlay(title) {
    if (readySongTitleEl) readySongTitleEl.textContent = title || "";
    readyOverlayEl?.classList.add("is-active");
  }

  function hideReadyOverlay() {
    readyOverlayEl?.classList.remove("is-active");
  }

  function runCountdown(onComplete) {
    const token = ++countdownToken;
    const steps = ["3", "2", "1", "GO"];
    let index = 0;
    if (readyCountEl) {
      readyCountEl.textContent = steps[index];
      readyCountEl.classList.remove("is-pulsing");
      void readyCountEl.offsetWidth;
      readyCountEl.classList.add("is-pulsing");
    }
    const tick = () => {
      if (token !== countdownToken) return;
      index += 1;
      if (index >= steps.length) {
        onComplete();
        return;
      }
      if (readyCountEl) {
        readyCountEl.textContent = steps[index];
        readyCountEl.classList.remove("is-pulsing");
        void readyCountEl.offsetWidth;
        readyCountEl.classList.add("is-pulsing");
      }
      window.setTimeout(tick, 650);
    };
    window.setTimeout(tick, 650);
  }

  function showPauseOverlay() {
    pauseOverlayEl?.classList.add("is-active");
    if (pauseButtonEl) {
      pauseButtonEl.textContent = ">";
      pauseButtonEl.setAttribute("aria-pressed", "true");
    }
  }

  function hidePauseOverlay() {
    pauseOverlayEl?.classList.remove("is-active");
    if (pauseButtonEl) {
      pauseButtonEl.textContent = "II";
      pauseButtonEl.setAttribute("aria-pressed", "false");
    }
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      pausedSongTime = rawSongTime();
      window.StarlightAudio.pause();
      showPauseOverlay();
      return;
    }
    if (state === "paused" && !resumeCountdownActive) resumeFromPause();
  }

  function resumeFromPause() {
    if (state !== "paused") return;
    const rate = practiceOptions ? practiceOptions.speed : 1;
    hidePauseOverlay();
    resumeCountdownActive = true;
    showReadyOverlay("RESUME");
    runCountdown(() => {
      resumeCountdownActive = false;
      setClock({ atSongTime: pausedSongTime, playbackRate: rate, delaySeconds: 0 });
      state = "playing";
      hideReadyOverlay();
      window.StarlightAudio.resume(pausedSongTime, rate);
    });
    ensureLoopRunning();
  }

  function restartFromPause() {
    hidePauseOverlay();
    retry();
  }

  function quitToTitle() {
    window.StarlightScreens.confirm("プレイを中断してタイトルに戻りますか？").then((confirmed) => {
      if (!confirmed) return;
      abort();
      window.StarlightScreens.resetTo("title");
      window.StarlightScreens.renderTitleBestScore();
    });
  }

  function abort() {
    practiceOptions = null;
    countdownToken += 1;
    resumeCountdownActive = false;
    stopLoop();
    window.StarlightAudio.stop();
    state = "idle";
    hidePauseOverlay();
    hideReadyOverlay();
  }

  function startWithCountdown(afterCountdown) {
    chart = buildChart();
    particles = [];
    ripples = [];
    activePointers = new Map();
    resumeCountdownActive = false;
    needsResize = true;
    resetStats();
    updateHud();
    judgementEl.classList.remove("is-active");
    judgementMainEl.textContent = "";
    judgementSubEl.textContent = "";
    state = "ready";
    showReadyOverlay(currentSong.chart.title);
    window.StarlightAudio.stop();
    runCountdown(() => {
      state = "playing";
      hideReadyOverlay();
      afterCountdown();
    });
    ensureLoopRunning();
  }

  function startPlayback() {
    const settings = window.StarlightSettings.get();
    currentLeadTime = getLeadTime(settings.noteSpeed);
    setClock({ atSongTime: 0, playbackRate: 1, delaySeconds: 0.45 });
    window.StarlightAudio.unlock();
    window.StarlightAudio.start({ atSongTime: 0, playbackRate: 1, offsetSeconds: settings.audioOffsetMs / 1000, leadIn: 0.45 });
  }

  function startPracticePlayback() {
    const settings = window.StarlightSettings.get();
    currentLeadTime = getLeadTime(settings.noteSpeed);
    setClock({ atSongTime: practiceOptions.startSeconds, playbackRate: practiceOptions.speed, delaySeconds: 0.45 });
    window.StarlightAudio.unlock();
    window.StarlightAudio.start({
      atSongTime: practiceOptions.startSeconds,
      playbackRate: practiceOptions.speed,
      offsetSeconds: settings.audioOffsetMs / 1000,
      leadIn: 0.45,
    });
  }

  function beginPlay(song) {
    practiceOptions = null;
    loadSong(song);
    startWithCountdown(startPlayback);
  }

  function beginPractice(song, options) {
    practiceOptions = { ...options };
    loadSong(song);
    startWithCountdown(startPracticePlayback);
  }

  function retry() {
    if (practiceOptions) {
      startWithCountdown(startPracticePlayback);
    } else {
      startWithCountdown(startPlayback);
    }
  }

  function endGame(failed) {
    state = failed ? "failed" : "cleared";
    countdownToken += 1;
    resumeCountdownActive = false;
    stopLoop();
    window.StarlightAudio.stop();
    hideReadyOverlay();
    hidePauseOverlay();
    const accuracy = computeAccuracy();
    const finalScore = computeScore();
    const rank = computeRank(finalScore);
    const judged = judgedCount();
    const fullCombo = judgementCounts.MISS === 0 && judged > 0;
    const allJustice = fullCombo && judgementCounts.JUSTICE === 0 && judgementCounts.ATTACK === 0;
    const scores = window.StarlightStorage.read("scores", {});
    const previous = scores[currentSong.id] || {};
    const previousBest = previous.bestScore || 0;
    const isNewRecord = !failed && finalScore > previousBest;
    const bestScore = isNewRecord ? finalScore : previousBest;
    const avgTimingMs = timingSamples > 0 ? timingSumMs / timingSamples : 0;
    if (!failed) {
      scores[currentSong.id] = {
        bestScore,
        bestAccuracy: Math.max(accuracy, previous.bestAccuracy || 0),
        bestRank: isNewRecord || !previous.bestRank ? rank : previous.bestRank,
        fullCombo: fullCombo || Boolean(previous.fullCombo),
        allJustice: allJustice || Boolean(previous.allJustice),
        clearedAt: Date.now(),
      };
      window.StarlightStorage.write("scores", scores);
    }
    window.StarlightScreens.showResult({
      songId: currentSong.id,
      score: finalScore,
      bestScore,
      isNewRecord,
      rank,
      accuracy,
      critical: judgementCounts.CRITICAL,
      justice: judgementCounts.JUSTICE,
      attack: judgementCounts.ATTACK,
      miss: judgementCounts.MISS,
      maxCombo,
      fullCombo,
      allJustice,
      early: timingEarly,
      late: timingLate,
      timingSamples,
      avgTimingMs,
      failed,
    });
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  pauseButtonEl?.addEventListener("click", (event) => {
    event.stopPropagation();
    window.StarlightHaptics?.trigger("ui");
    togglePause();
  });

  document.querySelector("#pauseResumeButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    resumeFromPause();
  });
  document.querySelector("#pauseRestartButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    restartFromPause();
  });
  document.querySelector("#pauseSettingsButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    window.StarlightScreens.showScreen("settings");
  });
  document.querySelector("#pauseQuitButton")?.addEventListener("click", () => {
    window.StarlightHaptics?.trigger("ui");
    quitToTitle();
  });

  function isTypingTarget(target) {
    return Boolean(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(event.target)) return;
    if (document.body.dataset.activeScreen !== "game") return;
    const lane = tapKeys.indexOf(event.key.toLowerCase());
    if (lane === -1) return;
    event.preventDefault();
    hitKeyboardLane(lane);
  });

  window.addEventListener("keyup", (event) => {
    if (isTypingTarget(event.target)) return;
    const lane = tapKeys.indexOf(event.key.toLowerCase());
    if (lane === -1) return;
    releaseKeyboardLane(lane);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || isTypingTarget(event.target)) return;
    if (state === "playing" || state === "paused") togglePause();
  });

  window.addEventListener("resize", () => {
    needsResize = true;
    if (loopRunning) resizeCanvas();
  });

  window.addEventListener("orientationchange", () => {
    needsResize = true;
  });

  applySettings(window.StarlightSettings ? window.StarlightSettings.get() : cachedSettings);
  if (window.StarlightSettings) window.StarlightSettings.onChange(applySettings);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      needsResize = true;
    }).observe(canvas);
  }

  window.StarlightGame = {
    beginPlay,
    beginPractice,
    retry,
    togglePause,
    resumeFromPause,
    abort,
  };
})();
