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
  const startPanel = document.querySelector("#startPanel");
  const startButton = document.querySelector("#startButton");
  const pauseButton = document.querySelector("#pauseButton");
  const muteButton = document.querySelector("#muteButton");
  const resultModal = document.querySelector("#resultModal");
  const resultScore = document.querySelector("#resultScore");
  const resultCombo = document.querySelector("#resultCombo");
  const resultPerfect = document.querySelector("#resultPerfect");
  const resultMiss = document.querySelector("#resultMiss");
  const resultTitle = document.querySelector("#resultTitle");
  const chartLabel = document.querySelector("#chartLabel");

  const CHART_STORAGE_KEY = "starlight-beats-chart-melodiniq-v1";

  function loadChartSource() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHART_STORAGE_KEY));
      if (saved && Array.isArray(saved.notes) && Number.isFinite(Number(saved.bpm))) return saved;
    } catch {}
    return window.MELODINIQ_CHART ?? { bpm: 193, divisions: 8, audioPath: "assets/melodiniq.mp3", notes: [] };
  }

  let chartSource = loadChartSource();
  const DIVISIONS = chartSource.divisions ?? 8;
  const SONG_AUDIO_PATH = chartSource.audioPath ?? "assets/melodiniq.mp3";
  let BPM = chartSource.bpm ?? 193;
  let BEAT = 60 / BPM;
  const LEAD_TIME = 2.35;
  const MAX_LIFE = 1000;
  const HIT_WINDOWS = [
    { name: "PERFECT", ms: 100, score: 1000, color: "#7cf6ff" },
    { name: "GREAT", ms: 185, score: 760, color: "#71ff99" },
    { name: "GOOD", ms: 310, score: 460, color: "#f7df72" },
  ];
  const MISS_WINDOW = 0.38;
  const laneColors = ["#ff6a79", "#ff7a68", "#ff6e85", "#ff8765", "#ff6579", "#ff786e", "#ff718e", "#ff826b"];
  const tapKeys = ["a", "s", "d", "f", "j", "k", "l", ";"];

  let chart = [];
  let particles = [];
  let laneBursts = Array.from({ length: DIVISIONS }, () => 0);
  let activePointers = new Map();
  let state = "idle";
  let muted = false;
  let audioContext = null;
  let masterGain = null;
  let melodyTimer = null;
  let songAudio = null;
  let usingSongAudio = false;
  let audioStartTime = 0;
  let clockStartMs = 0;
  let pausedSongTime = 0;
  let pausedAudioAt = 0;
  let animationFrame = 0;
  let judgementTimer = 0;
  let comboTimer = 0;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let perfect = 0;
  let miss = 0;
  let life = MAX_LIFE;

  function buildChart() {
    return chartSource.notes.map((entry, index) => {
      return {
        id: entry.id ?? `n-${index}`,
        type: entry.type,
        lane: entry.lane,
        width: entry.width,
        endLane: entry.endLane ?? entry.lane,
        time: entry.beat * BEAT,
        endTime: entry.endBeat ? entry.endBeat * BEAT : null,
        hit: false,
        missed: false,
        started: false,
        finished: false,
        pointerId: null,
        pendingFlick: false,
      };
    });
  }

  function ensureAudio() {
    if (audioContext) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = new AudioCtor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : 0.38;
    masterGain.connect(audioContext.destination);
  }

  function ensureSongAudio() {
    if (songAudio) return;
    songAudio = new Audio();
    songAudio.preload = "none";
    songAudio.volume = muted ? 0 : 0.85;
    songAudio.addEventListener("ended", () => {
      if (state !== "playing") return;
      const elapsed = songAudio.duration || getSongTime();
      usingSongAudio = false;
      clockStartMs = performance.now() - elapsed * 1000;
    });
  }

  function playTone(frequency, time, duration, type, gainValue) {
    if (!audioContext || muted || audioContext.state === "suspended") return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(gainValue, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  function playNoise(time, duration, gainValue) {
    if (!audioContext || muted || audioContext.state === "suspended") return;
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, Math.max(1, sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(masterGain);
    source.start(time);
  }

  function scheduleMusic() {
    clearInterval(melodyTimer);
    const melody = [392, 440, 493.88, 587.33, 659.25, 587.33, 493.88, 440];
    let beatIndex = 0;

    const scheduleChunk = () => {
      if (state !== "playing" || !audioContext || audioContext.state === "suspended") return;
      const elapsed = audioContext.currentTime - audioStartTime;
      while (beatIndex * BEAT < elapsed + BEAT * 8) {
        const time = audioStartTime + beatIndex * BEAT;
        const note = melody[beatIndex % melody.length];
        playTone(note, time, BEAT * 0.3, "triangle", 0.08);
        if (beatIndex % 2 === 0) playTone(98, time, BEAT * 0.22, "sine", 0.13);
        if (beatIndex % 2 === 1) playNoise(time, 0.045, 0.035);
        beatIndex += 1;
      }
    };

    scheduleChunk();
    melodyTimer = window.setInterval(scheduleChunk, 140);
  }

  function stopSongAudio() {
    if (!songAudio) return;
    songAudio.pause();
    songAudio.currentTime = 0;
    usingSongAudio = false;
  }

  function startSongOrFallback() {
    let settled = false;
    const fallbackToGenerated = () => {
      if (settled) return;
      settled = true;
      usingSongAudio = false;
      scheduleMusic();
    };
    songAudio.onerror = fallbackToGenerated;
    songAudio.src = SONG_AUDIO_PATH;
    songAudio.currentTime = 0;
    songAudio.volume = muted ? 0 : 0.85;
    songAudio.play().then(() => {
      if (settled || state !== "playing") return;
      settled = true;
      usingSongAudio = true;
      clockStartMs = performance.now() - songAudio.currentTime * 1000;
      clearInterval(melodyTimer);
    }).catch(fallbackToGenerated);
  }

  function resetGame() {
    chart = buildChart();
    particles = [];
    activePointers = new Map();
    laneBursts = Array.from({ length: DIVISIONS }, () => 0);
    score = 0;
    combo = 0;
    maxCombo = 0;
    perfect = 0;
    miss = 0;
    life = MAX_LIFE;
    updateHud();
    showJudgement("READY", "#ffffff");
  }

  function startGame() {
    ensureAudio();
    ensureSongAudio();
    if (audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    if (resultModal.open) resultModal.close();
    resetGame();
    state = "playing";
    clockStartMs = performance.now() + 450;
    audioStartTime = audioContext ? audioContext.currentTime + 0.45 : 0;
    usingSongAudio = false;
    startSongOrFallback();
    startPanel.classList.add("is-hidden");
    pauseButton.textContent = "II";
    pauseButton.setAttribute("aria-pressed", "false");
    cancelAnimationFrame(animationFrame);
    loop();
  }

  function togglePause() {
    if (state === "idle" || state === "ended") {
      startGame();
      return;
    }

    if (state === "playing") {
      state = "paused";
      pausedSongTime = getSongTime();
      pausedAudioAt = audioContext ? audioContext.currentTime : 0;
      pauseButton.textContent = ">";
      pauseButton.setAttribute("aria-pressed", "true");
      clearInterval(melodyTimer);
      if (usingSongAudio) songAudio.pause();
      showJudgement("PAUSE", "#f7df72");
      return;
    }

    if (state === "paused") {
      const pausedAudioDuration = audioContext ? audioContext.currentTime - pausedAudioAt : 0;
      clockStartMs = performance.now() - pausedSongTime * 1000;
      audioStartTime += pausedAudioDuration;
      state = "playing";
      pauseButton.textContent = "II";
      pauseButton.setAttribute("aria-pressed", "false");
      if (usingSongAudio) {
        songAudio.play().catch(() => {
          usingSongAudio = false;
          scheduleMusic();
        });
      } else {
        scheduleMusic();
      }
    }
  }

  function endGame() {
    state = "ended";
    clearInterval(melodyTimer);
    if (usingSongAudio) songAudio.pause();
    startPanel.classList.remove("is-hidden");
    pauseButton.textContent = "II";
    pauseButton.setAttribute("aria-pressed", "false");
    resultScore.textContent = score.toLocaleString("ja-JP");
    resultCombo.textContent = String(maxCombo);
    resultPerfect.textContent = String(perfect);
    resultMiss.textContent = String(miss);
    resultTitle.textContent = life <= 0 ? "LIVE FAILED" : miss === 0 ? "FULL COMBO" : "LIVE CLEAR";
    if (!resultModal.open) resultModal.showModal();
  }

  function getSongTime() {
    if (state === "paused") return pausedSongTime;
    if (usingSongAudio && songAudio) return songAudio.currentTime;
    return (performance.now() - clockStartMs) / 1000;
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

  function getRank() {
    const rate = score / getMaxScore();
    if (rate >= 0.88) return "S";
    if (rate >= 0.72) return "A";
    if (rate >= 0.52) return "B";
    if (rate >= 0.3) return "C";
    return "D";
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(8, "0");
    comboEl.textContent = String(combo);
    rankEl.textContent = getRank();
    lifeValueEl.textContent = String(life);
    lifeBarEl.style.width = `${Math.max(0, Math.min(100, (life / MAX_LIFE) * 100))}%`;
    scoreProgressEl.style.width = `${Math.max(0, Math.min(100, (score / getMaxScore()) * 100))}%`;
    chartLabel.textContent = chartSource.title || "CUSTOM CHART";
  }

  function showJudgement(text, color) {
    judgementEl.textContent = text;
    judgementEl.style.color = color;
    judgementEl.classList.add("is-active");
    judgementTimer = performance.now() + 330;
  }

  function showCombo() {
    comboBurstEl.classList.add("is-active");
    comboTimer = performance.now() + 520;
  }

  function loseLife(amount) {
    life = Math.max(0, life - amount);
    updateHud();
    if (life <= 0 && state === "playing") {
      endGame();
    }
  }

  function addComboScore(note, quality, amount = 1) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    const typeMultiplier = note.type === "gold" ? 1.35 : note.type === "hold" ? 0.85 : note.type === "flick" ? 1.15 : 1;
    score += Math.round((quality.score + Math.min(combo, 120) * 6) * typeMultiplier * amount);
    if (quality.name === "PERFECT") perfect += 1;
    updateHud();
    showCombo();
  }

  function spawnParticles(x, y, color, count = 16) {
    const layout = getLayout();
    for (let i = 0; i < count; i += 1) {
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

  function noteColor(note) {
    if (note.type === "gold") return "#f7df72";
    if (note.type === "hold") return "#71ff99";
    if (note.type === "flick") return "#ad8cff";
    return laneColors[note.lane % laneColors.length];
  }

  function hitNote(note, quality, point) {
    note.hit = true;
    note.finished = true;
    laneBursts[note.lane] = 1;
    addComboScore(note, quality);
    showJudgement(quality.name, quality.color);
    spawnParticles(point.x, point.y, noteColor(note), note.type === "gold" ? 26 : 18);
    if (audioContext) playTone(520 + note.lane * 48, audioContext.currentTime, 0.075, "square", 0.065);
  }

  function startHold(note, quality, pointerId, point) {
    note.started = true;
    note.pointerId = pointerId;
    note.lastHoldAward = getSongTime();
    laneBursts[note.lane] = 1;
    addComboScore(note, quality, 0.7);
    showJudgement("HOLD", "#71ff99");
    spawnParticles(point.x, point.y, "#71ff99", 16);
    if (audioContext) playTone(440 + note.lane * 40, audioContext.currentTime, 0.09, "triangle", 0.07);
  }

  function finishHold(note, point, forcedQuality) {
    if (note.finished || note.missed) return;
    const quality = forcedQuality ?? HIT_WINDOWS[0];
    note.hit = true;
    note.finished = true;
    note.pointerId = null;
    laneBursts[note.endLane] = 1;
    addComboScore(note, quality);
    showJudgement(quality.name, quality.color);
    spawnParticles(point.x, point.y, "#71ff99", 24);
    if (audioContext) playTone(660 + note.endLane * 32, audioContext.currentTime, 0.11, "sine", 0.075);
  }

  function failNote(note) {
    if (note.missed || note.finished) return;
    note.missed = true;
    note.pointerId = null;
    combo = 0;
    miss += 1;
    loseLife(note.type === "hold" ? 85 : 60);
    showJudgement("MISS", "#ff7369");
    if (audioContext) playNoise(audioContext.currentTime, 0.04, 0.026);
    updateHud();
  }

  function findCandidate(point, pointerId) {
    const layout = getLayout();
    const songTime = getSongTime();
    let candidate = null;
    let candidateDelta = Infinity;

    for (const note of chart) {
      if (note.missed || note.finished || note.pendingFlick) continue;
      if (note.type === "hold" && note.started) continue;
      const delta = Math.abs(note.time - songTime);
      const quality = HIT_WINDOWS.find((hitWindow) => delta * 1000 <= hitWindow.ms);
      if (!quality) continue;
      if (!pointMatchesNote(point, note, layout)) continue;
      if (delta < candidateDelta) {
        candidate = { note, quality, delta, pointerId };
        candidateDelta = delta;
      }
    }

    return candidate;
  }

  function handleCandidate(candidate, point, pointer) {
    if (!candidate) return false;
    const { note, quality, pointerId } = candidate;

    if (note.type === "hold") {
      startHold(note, quality, pointerId, point);
      return true;
    }

    if (note.type === "flick") {
      note.pendingFlick = true;
      note.pointerId = pointerId;
      pointer.pendingFlick = note.id;
      showJudgement("FLICK", "#ff5ad6");
      laneBursts[note.lane] = 1;
      return true;
    }

    hitNote(note, quality, point);
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
    const songTime = getSongTime();
    const delta = Math.abs(note.time - songTime);
    const quality = HIT_WINDOWS.find((hitWindow) => delta * 1000 <= hitWindow.ms + 70) ?? HIT_WINDOWS[2];

    if (distance < threshold && songTime < note.time + MISS_WINDOW) return false;
    hitNote(note, quality, pointer.point);
    note.pendingFlick = false;
    note.pointerId = null;
    pointer.pendingFlick = null;
    return true;
  }

  function updateActiveHolds() {
    if (state !== "playing") return;
    const songTime = getSongTime();

    for (const note of chart) {
      if (note.type !== "hold" || !note.started || note.finished || note.missed) continue;
      const pointer = activePointers.get(note.pointerId);
      if (!pointer) {
        if (songTime < note.endTime - MISS_WINDOW) failNote(note);
        continue;
      }

      const layout = getLayout();
      const targetLane = holdLaneAt(note, songTime);
      const expected = pointAtLane(targetLane, layout.hitY, layout);
      const tolerance = layout.hitWidth * 0.16;
      if (songTime > note.time + 0.16 && Math.abs(pointer.point.x - expected.x) > tolerance) {
        laneBursts[Math.round(targetLane)] = 0.5;
      }

      if (songTime - note.lastHoldAward > BEAT * 1.5 && songTime < note.endTime - 0.1) {
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

  function missOldNotes(songTime) {
    for (const note of chart) {
      if (note.finished || note.missed) continue;

      if (note.type === "hold") {
        if (!note.started && songTime - note.time > MISS_WINDOW) failNote(note);
        if (note.started && songTime - note.endTime > MISS_WINDOW) failNote(note);
        continue;
      }

      if (note.pendingFlick && songTime - note.time > MISS_WINDOW) {
        failNote(note);
        continue;
      }

      if (!note.pendingFlick && songTime - note.time > MISS_WINDOW) {
        failNote(note);
      }
    }
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
    return {
      width,
      height,
      center,
      topY,
      hitY,
      frontY,
      topWidth,
      hitWidth,
      frontWidth,
      hitLeft,
      hitRight,
      frontLeft,
      frontRight,
    };
  }

  function pointAtLane(lane, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    const topLeft = layout.center - layout.topWidth / 2;
    const topCell = layout.topWidth / DIVISIONS;
    const hitCell = layout.hitWidth / DIVISIONS;
    const xTop = topLeft + (lane + 0.5) * topCell;
    const xHit = layout.hitLeft + (lane + 0.5) * hitCell;
    return {
      x: xTop + (xHit - xTop) * progress,
      y,
    };
  }

  function laneWidthAt(note, y, layout) {
    const progress = Math.max(0, Math.min(1, (y - layout.topY) / (layout.hitY - layout.topY)));
    const topCell = layout.topWidth / DIVISIONS;
    const hitCell = layout.hitWidth / DIVISIONS;
    return (topCell + (hitCell - topCell) * progress) * note.width;
  }

  function projectNoteAt(lane, time, songTime, layout) {
    const progress = 1 - (time - songTime) / LEAD_TIME;
    const eased = Math.max(0, Math.min(1.08, progress)) ** 1.45;
    const y = layout.topY + (layout.hitY - layout.topY) * eased;
    const point = pointAtLane(lane, y, layout);
    return {
      x: point.x,
      y,
      progress: eased,
    };
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
    ctx.clearRect(0, 0, width, height);
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
    for (let i = -5; i <= 5; i += 1) {
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
    for (let i = 0; i <= 13; i += 1) {
      const y = topY + ((songTime * 78 + i * height * 0.072) % (hitY - topY));
      ctx.strokeStyle = i % 4 === 0 ? "rgba(255, 220, 73, 0.4)" : "rgba(110, 239, 255, 0.16)";
      ctx.beginPath();
      ctx.moveTo(hitLeft, y);
      ctx.lineTo(hitRight, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#81f3ff";
    ctx.shadowBlur = width * 0.015;
    ctx.shadowColor = "#29dff4";
    ctx.lineWidth = Math.max(2, width * 0.002);
    ctx.strokeRect(hitLeft, topY, hitRight - hitLeft, hitY - topY);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(0, 8, 13, 0.96)";
    ctx.strokeStyle = "#f5df4f";
    ctx.shadowBlur = width * 0.02;
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
      ctx.shadowBlur = width * 0.025;
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
    ctx.shadowBlur = layout.width * 0.022;
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
    ctx.shadowBlur = layout.width * 0.018;
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
        if (note.endTime - songTime > LEAD_TIME || songTime - note.endTime > MISS_WINDOW) continue;
        drawHoldBody(note, layout, songTime);
      }
    }

    for (const note of chart) {
      if (note.missed || note.finished) continue;
      if (note.type === "hold") {
        if (!note.started && note.time - songTime < LEAD_TIME && songTime - note.time < MISS_WINDOW) {
          drawTapNote({ ...note, type: "hold" }, layout, songTime);
        }
        if (note.endTime - songTime < LEAD_TIME && songTime - note.endTime < MISS_WINDOW) {
          drawTapNote({ ...note, lane: note.endLane, time: note.endTime, type: "hold" }, layout, songTime);
        }
        continue;
      }
      if (note.time - songTime > LEAD_TIME || songTime - note.time > MISS_WINDOW) continue;
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
      ctx.shadowBlur = 10;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawIdle(layout) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#14141e";
    ctx.lineWidth = Math.max(1, layout.width * 0.003);
    ctx.beginPath();
    ctx.ellipse(layout.center, layout.height * 0.43, layout.width * 0.045, layout.height * 0.032, -0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(25,25,32,0.62)";
    ctx.font = `900 ${Math.round(layout.width * 0.018)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("STAGE", layout.center, layout.height * 0.5);
    ctx.restore();
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
    resizeCanvas();
    const layout = getLayout();
    const songTime = getSongTime();

    drawBackground(layout, songTime);
    if (state === "idle") drawIdle(layout);
    if (state === "playing" || state === "paused" || state === "ended") {
      drawNotes(layout, songTime);
      drawParticles();
    }

    for (let i = 0; i < laneBursts.length; i += 1) {
      laneBursts[i] *= 0.86;
    }

    if (performance.now() > judgementTimer) {
      judgementEl.classList.remove("is-active");
    }

    if (performance.now() > comboTimer) {
      comboBurstEl.classList.remove("is-active");
    }

    if (state === "playing") {
      updateActiveHolds();
      missOldNotes(songTime);
      const lastNoteTime = chart.reduce((last, note) => Math.max(last, note.endTime ?? note.time), 0);
      const allDone = chart.every((note) => note.finished || note.missed);
      if ((songTime > lastNoteTime + 1.3 && allDone) || songTime > lastNoteTime + 2.2) {
        endGame();
      }
    }

    animationFrame = requestAnimationFrame(loop);
  }

  function eventToCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event) {
    event.preventDefault();
    if (state === "idle" || state === "ended") {
      startGame();
      return;
    }
    if (state !== "playing") return;

    const point = eventToCanvasPoint(event);
    const layout = getLayout();
    const lane = laneFromPoint(point, layout);
    if (lane !== -1) laneBursts[lane] = 0.85;

    const pointer = {
      id: event.pointerId,
      startPoint: point,
      point,
      pendingFlick: null,
    };
    activePointers.set(event.pointerId, pointer);
    canvas.setPointerCapture?.(event.pointerId);
    const candidate = findCandidate(point, event.pointerId);
    handleCandidate(candidate, point, pointer);
  }

  function handlePointerMove(event) {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.point = eventToCanvasPoint(event);
    const lane = laneFromPoint(pointer.point, getLayout());
    if (lane !== -1) laneBursts[lane] = Math.max(laneBursts[lane], 0.45);
    tryFinishFlick(pointer);
  }

  function handlePointerUp(event) {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    pointer.point = eventToCanvasPoint(event);
    tryFinishFlick(pointer);

    for (const note of chart) {
      if (note.type !== "hold" || note.pointerId !== event.pointerId || note.finished || note.missed) continue;
      const songTime = getSongTime();
      if (songTime >= note.endTime - MISS_WINDOW) {
        finishHold(note, pointer.point, HIT_WINDOWS[1]);
      } else {
        failNote(note);
      }
    }

    activePointers.delete(event.pointerId);
  }

  function hitKeyboardLane(lane) {
    if (state === "idle" || state === "ended") {
      startGame();
      return;
    }
    if (state !== "playing") return;

    const layout = getLayout();
    const point = pointAtLane(lane, layout.hitY, layout);
    const candidate = findCandidate(point, -1);
    if (candidate?.note.type === "flick") {
      hitNote(candidate.note, candidate.quality, point);
      return;
    }
    handleCandidate(candidate, point, { id: -1, startPoint: point, point, pendingFlick: null });
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  startButton.addEventListener("click", (event) => {
    event.stopPropagation();
    startGame();
  });

  pauseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePause();
  });

  muteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    muted = !muted;
    muteButton.textContent = muted ? "SOUND OFF" : "SOUND ON";
    muteButton.setAttribute("aria-pressed", String(muted));
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.38;
    if (songAudio) songAudio.volume = muted ? 0 : 0.85;
  });

  window.addEventListener("keydown", (event) => {
    const lane = tapKeys.indexOf(event.key.toLowerCase());
    if (lane === -1) return;
    event.preventDefault();
    hitKeyboardLane(lane);
  });

  window.addEventListener("resize", resizeCanvas);

  window.addEventListener("starlight-chart-change", (event) => {
    const nextChart = event.detail;
    if (!nextChart || !Array.isArray(nextChart.notes) || !Number.isFinite(Number(nextChart.bpm))) return;
    clearInterval(melodyTimer);
    stopSongAudio();
    chartSource = nextChart;
    BPM = Number(nextChart.bpm);
    BEAT = 60 / BPM;
    state = "idle";
    if (resultModal.open) resultModal.close();
    startPanel.classList.remove("is-hidden");
    resetGame();
    updateHud();
  });

  window.addEventListener("starlight-editor-mode", (event) => {
    if (event.detail?.editing && state === "playing") togglePause();
  });

  resetGame();
  loop();
})();
