(() => {
  "use strict";

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.querySelector("#score");
  const scoreProgressEl = document.querySelector("#scoreProgress");
  const comboEl = document.querySelector("#combo");
  const comboBurstEl = document.querySelector("#comboBurst");
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
    { name: "PERFECT", ms: 100, score: 1000, color: "#7cf6ff" },
    { name: "GREAT", ms: 185, score: 760, color: "#71ff99" },
    { name: "GOOD", ms: 310, score: 460, color: "#f7df72" },
  ];
  const MISS_WINDOW = 0.38;
  const MAX_LIFE = 1000;
  const BASE_LEAD_TIME = 2.35;
  const BASE_SPEED = 2.5;
  const laneColors = ["#ff6a79", "#ff7a68", "#ff6e85", "#ff8765", "#ff6579", "#ff786e", "#ff718e", "#ff826b"];
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
  let judgementCounts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  let score = 0;
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
  let comboTimer = 0;
  let missFlashUntil = 0;
  let shakeUntil = 0;

  function getLeadTime(speed) {
    return BASE_LEAD_TIME * (BASE_SPEED / Math.max(0.5, speed));
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
    score = 0;
    combo = 0;
    maxCombo = 0;
    life = MAX_LIFE;
    judgementCounts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
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

  function getMaxScore() {
    return Math.max(
      chart.reduce((sum, note) => {
        const multiplier = note.type === "gold" ? 1.35 : note.type === "hold" ? 1.7 : note.type === "flick" ? 1.15 : 1;
        return sum + (HIT_WINDOWS[0].score + 120) * multiplier;
      }, 0),
      1,
    );
  }

  function computeAccuracy() {
    const totalNotes = judgementCounts.PERFECT + judgementCounts.GREAT + judgementCounts.GOOD + judgementCounts.MISS;
    if (totalNotes === 0) return 100;
    const weighted = judgementCounts.PERFECT * 1 + judgementCounts.GREAT * 0.7 + judgementCounts.GOOD * 0.4;
    return (weighted / totalNotes) * 100;
  }

  function computeRank(accuracy) {
    if (accuracy >= 99.5 && judgementCounts.MISS === 0) return "SSS";
    if (accuracy >= 97) return "SS";
    if (accuracy >= 94) return "S";
    if (accuracy >= 88) return "A";
    if (accuracy >= 78) return "B";
    if (accuracy >= 60) return "C";
    return "D";
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(8, "0");
    comboEl.textContent = String(combo);
    rankEl.textContent = computeRank(computeAccuracy());
    lifeValueEl.textContent = practiceOptions ? "---" : String(life);
    lifeBarEl.style.width = practiceOptions ? "100%" : `${Math.max(0, Math.min(100, (life / MAX_LIFE) * 100))}%`;
    scoreProgressEl.style.width = `${Math.max(0, Math.min(100, (score / getMaxScore()) * 100))}%`;
  }

  function showJudgement(text, color, timingLabel) {
    judgementMainEl.textContent = text;
    judgementMainEl.style.color = color;
    judgementSubEl.textContent = timingLabel || "";
    judgementEl.classList.add("is-active");
    judgementTimer = performance.now() + 380;
  }

  function showCombo() {
    comboBurstEl.classList.add("is-active");
    comboTimer = performance.now() + 520;
  }

  function loseLife(amount) {
    if (practiceOptions) {
      updateHud();
      return;
    }
    life = Math.max(0, life - amount);
    updateHud();
    if (life <= 0 && state === "playing") endGame(true);
  }

  function addComboScore(note, quality, amount = 1) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    const typeMultiplier = note.type === "gold" ? 1.35 : note.type === "hold" ? 0.85 : note.type === "flick" ? 1.15 : 1;
    score += Math.round((quality.score + Math.min(combo, 120) * 6) * typeMultiplier * amount);
    updateHud();
    showCombo();
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
    if (note.type === "gold") return "#f7df72";
    if (note.type === "hold") return "#71ff99";
    if (note.type === "flick") return "#ad8cff";
    return laneColors[note.lane % laneColors.length];
  }

  function hitNote(note, quality, point, timingLabel) {
    note.hit = true;
    note.finished = true;
    if (laneEffectEnabled) laneBursts[note.lane] = 1;
    judgementCounts[quality.name] += 1;
    addComboScore(note, quality);
    showJudgement(quality.name, quality.color, timingLabel);
    if (particlesEnabled) spawnParticles(point.x, point.y, noteColor(note), note.type === "gold" ? 26 : 18);
    if (judgementVoiceEnabled) window.StarlightAudio.playHitTone(note.type === "gold" ? "gold" : note.type === "flick" ? "flick" : "tap");
    window.StarlightHaptics.trigger(quality.name === "PERFECT" ? "perfect" : "tap");
  }

  function startHold(note, quality, pointerId, point) {
    note.started = true;
    note.pointerId = pointerId;
    note.lastHoldAward = rawSongTime();
    if (laneEffectEnabled) laneBursts[note.lane] = 1;
    addComboScore(note, quality, 0.7);
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
    judgementCounts[quality.name] += 1;
    addComboScore(note, quality);
    showJudgement(quality.name, quality.color, null);
    if (particlesEnabled) spawnParticles(point.x, point.y, "#71ff99", 24);
    if (judgementVoiceEnabled) window.StarlightAudio.playHitTone("holdEnd");
    window.StarlightHaptics.trigger(quality.name === "PERFECT" ? "perfect" : "tap");
  }

  function failNote(note) {
    if (note.missed || note.finished) return;
    note.missed = true;
    note.pointerId = null;
    combo = 0;
    judgementCounts.MISS += 1;
    loseLife(note.type === "hold" ? 85 : 60);
    showJudgement("MISS", "#ff7369", null);
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
      if (note.missed || note.finished || note.pendingFlick) continue;
      if (note.type === "hold" && note.started) continue;
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

    if (note.type === "hold") {
      startHold(note, quality, pointer.id, point);
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

    hitNote(note, quality, point, timingLabelFor(delta));
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
    hitNote(note, quality, pointer.point, timingLabelFor(delta));
    note.pendingFlick = false;
    note.pointerId = null;
    pointer.pendingFlick = null;
    return true;
  }

  function updateActiveHolds(songTime) {
    for (const note of chart) {
      if (note.type !== "hold" || !note.started || note.finished || note.missed) continue;
      if (note.pointerId === -1) continue;
      const pointer = activePointers.get(note.pointerId);
      if (!pointer) {
        if (songTime < note.endTime - MISS_WINDOW) failNote(note);
        continue;
      }

      const layout = getLayout();
      const targetLane = holdLaneAt(note, songTime);
      const expected = pointAtLane(targetLane, layout.hitY, layout);
      const tolerance = layout.hitWidth * 0.16;
      if (laneEffectEnabled && songTime > note.time + 0.16 && Math.abs(pointer.point.x - expected.x) > tolerance) {
        laneBursts[Math.round(targetLane)] = 0.5;
      }

      if (songTime - note.lastHoldAward > beatSeconds * 1.5 && songTime < note.endTime - 0.1) {
        note.lastHoldAward = songTime;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
        score += 180;
        showCombo();
        updateHud();
      }

      if (songTime >= note.endTime - 0.03) {
        const endPoint = pointAtLane(note.endLane, layout.hitY, layout);
        finishHold(note, endPoint, HIT_WINDOWS[0]);
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
      if (note.type === "hold") {
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
      if (note.type === "hold") {
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
  }

  function getLayout() {
    const width = canvas.width;
    const height = canvas.height;
    const center = width / 2;
    const topY = height * 0.055;
    const hitY = height * 0.79;
    const frontY = height * 0.87;
    const topWidth = width * 0.54;
    const hitWidth = width * 0.54;
    const frontWidth = width * 0.58;
    const hitLeft = center - hitWidth / 2;
    const hitRight = center + hitWidth / 2;
    const frontLeft = center - frontWidth / 2;
    const frontRight = center + frontWidth / 2;
    return { width, height, center, topY, hitY, frontY, topWidth, hitWidth, frontWidth, hitLeft, hitRight, frontLeft, frontRight };
  }

  function pointAtLane(lane, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    const topLeft = layout.center - layout.topWidth / 2;
    const topCell = layout.topWidth / DIVISIONS;
    const hitCell = layout.hitWidth / DIVISIONS;
    const xTop = topLeft + (lane + 0.5) * topCell;
    const xHit = layout.hitLeft + (lane + 0.5) * hitCell;
    return { x: xTop + (xHit - xTop) * progress, y };
  }

  function laneWidthAt(note, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    const topCell = layout.topWidth / DIVISIONS;
    const hitCell = layout.hitWidth / DIVISIONS;
    return (topCell + (hitCell - topCell) * progress) * note.width;
  }

  function projectNoteAt(lane, time, songTime, layout) {
    const progress = 1 - (time - songTime) / currentLeadTime;
    const eased = Math.max(0, Math.min(1.08, progress)) ** 1.45;
    const y = layout.topY + (layout.hitY - layout.topY) * eased;
    const point = pointAtLane(lane, y, layout);
    return { x: point.x, y, progress: eased };
  }

  function holdLaneAt(note, songTime) {
    if (!note.endTime || songTime <= note.time) return note.lane;
    const ratio = Math.max(0, Math.min(1, (songTime - note.time) / (note.endTime - note.time)));
    return note.lane + (note.endLane - note.lane) * ratio;
  }

  function pointMatchesNote(point, note, layout) {
    const minY = layout.hitY - layout.height * 0.16;
    const maxY = layout.frontY + layout.height * 0.12;
    if (point.y < minY || point.y > maxY) return false;
    const center = pointAtLane(note.lane, layout.hitY, layout);
    const width = laneWidthAt(note, layout.hitY, layout) + layout.hitWidth * 0.045;
    return Math.abs(point.x - center.x) <= width / 2;
  }

  function laneFromPoint(point, layout) {
    const minY = layout.hitY - layout.height * 0.16;
    const maxY = layout.frontY + layout.height * 0.12;
    if (point.y < minY || point.y > maxY) return -1;
    const p = Math.max(0, Math.min(1, (point.y - layout.hitY) / Math.max(1, layout.frontY - layout.hitY)));
    const left = layout.hitLeft + (layout.frontLeft - layout.hitLeft) * p;
    const width = layout.hitWidth + (layout.frontWidth - layout.hitWidth) * p;
    const lane = Math.floor(((point.x - left) / width) * DIVISIONS);
    return Math.max(0, Math.min(DIVISIONS - 1, lane));
  }

  function drawBackground(layout, songTime) {
    const { width, height, topY, hitY, frontY, hitLeft, hitRight, frontLeft, frontRight } = layout;
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#06131d");
    bg.addColorStop(0.5, "#102b3a");
    bg.addColorStop(1, "#07141c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#2ad7ed";
    ctx.lineWidth = Math.max(1, width * 0.001);
    const streakCount = effectsHigh ? 5 : 3;
    for (let i = -streakCount; i <= streakCount; i += 1) {
      const x = width / 2 + i * width * 0.095 + Math.sin(songTime + i) * width * 0.01;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height * 0.15, height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(1, 10, 16, 0.78)";
    ctx.fillRect(hitLeft, topY, hitRight - hitLeft, hitY - topY);
    ctx.save();
    ctx.strokeStyle = "rgba(110, 239, 255, 0.34)";
    ctx.lineWidth = Math.max(1, width * 0.0012);
    for (let i = 0; i <= DIVISIONS; i += 1) {
      const x = hitLeft + (i / DIVISIONS) * layout.hitWidth;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, hitY);
      ctx.stroke();
    }
    const gridLineCount = effectsHigh ? 13 : 6;
    for (let i = 0; i <= gridLineCount; i += 1) {
      const y = topY + ((songTime * 78 + i * ((hitY - topY) / (gridLineCount + 1))) % (hitY - topY));
      ctx.strokeStyle = i % 4 === 0 ? "rgba(255, 220, 73, 0.4)" : "rgba(110, 239, 255, 0.16)";
      ctx.beginPath();
      ctx.moveTo(hitLeft, y);
      ctx.lineTo(hitRight, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#81f3ff";
    ctx.shadowBlur = effectsHigh ? width * 0.015 : 0;
    ctx.shadowColor = "#29dff4";
    ctx.lineWidth = Math.max(2, width * 0.002);
    ctx.strokeRect(hitLeft, topY, hitRight - hitLeft, hitY - topY);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(0, 8, 13, 0.96)";
    ctx.strokeStyle = "#f5df4f";
    ctx.shadowBlur = effectsHigh ? width * 0.02 : 0;
    ctx.shadowColor = "#f5df4f";
    ctx.lineWidth = Math.max(3, width * 0.004);
    ctx.fillRect(frontLeft, hitY, frontRight - frontLeft, frontY - hitY);
    ctx.strokeRect(frontLeft, hitY, frontRight - frontLeft, frontY - hitY);
    ctx.restore();

    ctx.strokeStyle = "rgba(130, 239, 255, 0.56)";
    ctx.lineWidth = Math.max(1, width * 0.0012);
    for (let i = 1; i < DIVISIONS * 2; i += 1) {
      const x = frontLeft + (i / (DIVISIONS * 2)) * (frontRight - frontLeft);
      ctx.beginPath();
      ctx.moveTo(x, hitY);
      ctx.lineTo(x, frontY);
      ctx.stroke();
    }

    for (let lane = 0; lane < DIVISIONS; lane += 1) {
      const burst = laneBursts[lane];
      if (burst <= 0.02) continue;
      const laneLeft = hitLeft + (lane / DIVISIONS) * layout.hitWidth;
      const laneWidth = layout.hitWidth / DIVISIONS;
      ctx.save();
      ctx.globalAlpha = burst * 0.55;
      ctx.fillStyle = "#46e8ff";
      ctx.shadowBlur = effectsHigh ? width * 0.025 : 0;
      ctx.shadowColor = "#46e8ff";
      ctx.fillRect(laneLeft, hitY - height * 0.012, laneWidth, frontY - hitY + height * 0.025);
      ctx.restore();
    }
  }

  function drawHoldBody(note, layout, songTime) {
    const startTime = Math.max(note.time, songTime);
    const startLane = songTime > note.time ? holdLaneAt(note, songTime) : note.lane;
    const start = projectNoteAt(startLane, startTime, songTime, layout);
    const end = projectNoteAt(note.endLane, note.endTime, songTime, layout);
    if (end.progress < 0 || start.progress > 1.1) return;
    const startWidth = laneWidthAt({ width: note.width }, start.y, layout);
    const endWidth = laneWidthAt({ width: note.width }, end.y, layout);

    ctx.save();
    const grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    grad.addColorStop(0, "rgba(113,255,153,0.78)");
    grad.addColorStop(1, "rgba(124,246,255,0.58)");
    ctx.fillStyle = grad;
    ctx.shadowBlur = effectsHigh ? layout.width * 0.022 : 0;
    ctx.shadowColor = "#71ff99";
    ctx.beginPath();
    ctx.moveTo(start.x - startWidth / 2, start.y);
    ctx.lineTo(start.x + startWidth / 2, start.y);
    ctx.lineTo(end.x + endWidth / 2, end.y);
    ctx.lineTo(end.x - endWidth / 2, end.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTapNote(note, layout, songTime) {
    const projected = projectNoteAt(note.lane, note.time, songTime, layout);
    if (projected.progress < 0 || projected.progress > 1.11) return;
    const noteWidth = laneWidthAt(note, projected.y, layout) * 0.92;
    const noteHeight = layout.height * (0.018 + projected.progress * 0.026);
    const color = noteColor(note);

    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.shadowBlur = effectsHigh ? layout.width * 0.018 : 0;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    roundRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight, noteHeight * 0.35);
    ctx.fill();

    if (note.type === "flick") {
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
      if (note.type === "hold") {
        if (note.endTime - songTime > currentLeadTime || songTime - note.endTime > MISS_WINDOW) continue;
        drawHoldBody(note, layout, songTime);
      }
    }

    for (const note of chart) {
      if (note.missed || note.finished) continue;
      if (note.type === "hold") {
        if (!note.started && note.time - songTime < currentLeadTime && songTime - note.time < MISS_WINDOW) {
          drawTapNote({ ...note, type: "hold" }, layout, songTime);
        }
        if (note.endTime - songTime < currentLeadTime && songTime - note.endTime < MISS_WINDOW) {
          drawTapNote({ ...note, lane: note.endLane, time: note.endTime, type: "hold" }, layout, songTime);
        }
        continue;
      }
      if (note.time - songTime > currentLeadTime || songTime - note.time > MISS_WINDOW) continue;
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
    resizeCanvas();
    const layout = getLayout();
    const settings = window.StarlightSettings.get();
    currentLeadTime = getLeadTime(settings.noteSpeed);
    inputOffsetSeconds = settings.inputOffsetMs / 1000;
    effectsHigh = settings.effects !== "LOW";
    particlesEnabled = settings.particles;
    motionEnabled = settings.motion;
    laneEffectEnabled = settings.laneEffect;
    judgementVoiceEnabled = settings.judgementVoice;

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
    if (performance.now() > comboTimer) comboBurstEl.classList.remove("is-active");

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
    const pointer = { id: event.pointerId, startPoint: point, point, pendingFlick: null };
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
    tryFinishFlick(pointer);
  }

  function handlePointerUp(event) {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.point = eventToCanvasPoint(event);
    tryFinishFlick(pointer);
    const jt = judgeTime();
    for (const note of chart) {
      if (note.type !== "hold" || note.pointerId !== event.pointerId || note.finished || note.missed) continue;
      if (jt >= note.endTime - MISS_WINDOW) {
        finishHold(note, pointer.point, HIT_WINDOWS[1]);
      } else {
        failNote(note);
      }
    }
    activePointers.delete(event.pointerId);
  }

  function hitKeyboardLane(lane) {
    if (state !== "playing") return;
    const layout = getLayout();
    const point = pointAtLane(lane, layout.hitY, layout);
    const candidate = findCandidate(point);
    if (candidate?.note.type === "flick") {
      hitNote(candidate.note, candidate.quality, point, timingLabelFor(candidate.delta));
      return;
    }
    const pointer = { id: -2, startPoint: point, point, pendingFlick: null };
    handleCandidate(candidate, point, pointer);
  }

  function showReadyOverlay(title) {
    if (readySongTitleEl) readySongTitleEl.textContent = title || "";
    readyOverlayEl?.classList.add("is-active");
  }

  function hideReadyOverlay() {
    readyOverlayEl?.classList.remove("is-active");
  }

  function runCountdown(onComplete) {
    const steps = ["3", "2", "1", "GO"];
    let index = 0;
    if (readyCountEl) {
      readyCountEl.textContent = steps[index];
      readyCountEl.classList.remove("is-pulsing");
      void readyCountEl.offsetWidth;
      readyCountEl.classList.add("is-pulsing");
    }
    const tick = () => {
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
    } else if (state === "paused") {
      resumeFromPause();
    }
  }

  function resumeFromPause() {
    if (state !== "paused") return;
    hidePauseOverlay();
    const rate = practiceOptions ? practiceOptions.speed : 1;
    setClock({ atSongTime: pausedSongTime, playbackRate: rate, delaySeconds: 0 });
    state = "playing";
    window.StarlightAudio.resume(pausedSongTime, rate);
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
    resetStats();
    updateHud();
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
    stopLoop();
    window.StarlightAudio.stop();
    const accuracy = computeAccuracy();
    const rank = computeRank(accuracy);
    const totalJudged = judgementCounts.PERFECT + judgementCounts.GREAT + judgementCounts.GOOD + judgementCounts.MISS;
    const fullCombo = judgementCounts.MISS === 0 && totalJudged > 0;
    const scores = window.StarlightStorage.read("scores", {});
    const previous = scores[currentSong.id] || {};
    const previousBest = previous.bestScore || 0;
    const isNewRecord = !failed && score > previousBest;
    const bestScore = isNewRecord ? score : previousBest;
    if (!failed) {
      scores[currentSong.id] = {
        bestScore,
        bestAccuracy: Math.max(accuracy, previous.bestAccuracy || 0),
        bestRank: rank,
        fullCombo: fullCombo || Boolean(previous.fullCombo),
        clearedAt: Date.now(),
      };
      window.StarlightStorage.write("scores", scores);
    }
    window.StarlightScreens.showResult({
      songId: currentSong.id,
      score,
      bestScore,
      isNewRecord,
      rank,
      accuracy,
      perfect: judgementCounts.PERFECT,
      great: judgementCounts.GREAT,
      good: judgementCounts.GOOD,
      miss: judgementCounts.MISS,
      maxCombo,
      fullCombo,
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

  window.addEventListener("keydown", (event) => {
    const lane = tapKeys.indexOf(event.key.toLowerCase());
    if (lane === -1) return;
    event.preventDefault();
    hitKeyboardLane(lane);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (state === "playing" || state === "paused")) togglePause();
  });

  window.addEventListener("resize", () => {
    if (loopRunning) resizeCanvas();
  });

  window.StarlightGame = {
    beginPlay,
    beginPractice,
    retry,
    togglePause,
    resumeFromPause,
    abort,
  };
})();
