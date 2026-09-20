(() => {
  "use strict";

  const notes = [];
  let noteId = 0;
  const TOTAL_MEASURES = 153;

  function beat(measure, position = 0) {
    return 4 + (measure - 1) * 4 + position;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function push(type, lane, width, measure, position, endMeasure, endPosition, endLane) {
    notes.push({
      id: `melodiniq-${noteId}`,
      type,
      lane,
      width,
      beat: beat(measure, position),
      endBeat: endMeasure ? beat(endMeasure, endPosition) : null,
      endLane: endLane ?? lane,
    });
    noteId += 1;
  }

  function tap(lane, measure, position, width = 1) {
    const w = clamp(width, 1, 8);
    push("tap", clamp(lane, 0, 8 - w), w, measure, position);
  }

  function gold(lane, measure, position, width = 2) {
    const w = clamp(width, 1, 8);
    push("gold", clamp(lane, 0, 8 - w), w, measure, position);
  }

  function flick(lane, measure, position, width = 1) {
    const w = clamp(width, 1, 8);
    push("flick", clamp(lane, 0, 8 - w), w, measure, position);
  }

  function hold(lane, width, measure, position, endMeasure, endPosition, endLane) {
    const w = clamp(width, 1, 8);
    const l = clamp(lane, 0, 8 - w);
    const el = clamp(endLane ?? lane, 0, 8 - w);
    push("hold", l, w, measure, position, endMeasure, endPosition, el);
  }

  function stairsUp(measure) {
    const start = measure % 5;
    for (let i = 0; i < 4; i += 1) tap(start + i, measure, i);
  }

  function stairsDown(measure) {
    const start = 3 + (measure % 4);
    for (let i = 0; i < 4; i += 1) tap(start - i, measure, i);
  }

  function anchorGate(measure) {
    const left = 1 + (measure % 2);
    const right = 5 + (measure % 2);
    tap(left, measure, 0);
    tap(right, measure, 1);
    flick(left + 1, measure, 2.5);
    tap(right - 1, measure, 3);
  }

  function spreadOut(measure) {
    const a = measure % 3;
    const b = 5 + (measure % 3);
    gold(a, measure, 0);
    tap(b, measure, 1);
    tap(a + 1, measure, 2);
    flick(b, measure, 3);
  }

  function splitLanes(measure) {
    tap(1, measure, 0);
    tap(6, measure, 0.5);
    gold(2, measure, 1.5);
    gold(5, measure, 2.5);
    flick(3, measure, 3.25);
  }

  function railZigzag(measure) {
    const lane = measure % 2 === 0 ? 1 : 4;
    gold(lane, measure, 0);
    tap(lane + 2, measure, 1);
    gold(lane, measure, 2);
    tap(lane + 3, measure, 3);
  }

  function denseBurst(measure) {
    const base = measure % 4;
    tap(base, measure, 0);
    tap(base + 2, measure, 0.5);
    gold(base + 1, measure, 1);
    tap(base + 3, measure, 1.5);
    flick(base + 2, measure, 2.25);
    tap(base, measure, 3);
  }

  function mirrorGate(measure) {
    gold(1, measure, 0);
    gold(5, measure, 0);
    tap(2, measure, 1.25);
    tap(5, measure, 1.75);
    flick(3, measure, 2.5);
    tap(1, measure, 3.25);
    tap(6, measure, 3.25);
  }

  function wallGate(measure) {
    gold(0, measure, 0);
    gold(3, measure, 0);
    gold(5, measure, 0);
    tap(7, measure, 0);
  }

  function vConverge(measure) {
    hold(0, 2, measure, 0, measure, 3, 3);
    hold(6, 2, measure, 0, measure, 3, 3);
  }

  function xCross(measure) {
    hold(0, 1, measure, 0, measure, 3.5, 7);
    hold(7, 1, measure, 0, measure, 3.5, 0);
    tap(3, measure, 1.5);
    tap(4, measure, 1.5);
  }

  function waveHold(measure) {
    const lane = measure % 4;
    hold(lane, 1, measure, 0, measure, 1.5, lane + 3);
    hold(lane + 3, 1, measure, 1.5, measure + 1, 1, lane);
  }

  function arcStairs(measure) {
    const dir = measure % 2 === 0 ? 1 : -1;
    const start = dir === 1 ? 0 : 5;
    for (let i = 0; i < 4; i += 1) gold(start + dir * i, measure, i * 0.7);
    hold(start, 3, measure, 0, measure, 3.5, start + dir * 3);
  }

  function chevronBurst(measure) {
    flick(2, measure, 0);
    flick(5, measure, 0);
    tap(3, measure, 1);
    tap(4, measure, 1);
    gold(1, measure, 2);
    gold(5, measure, 2);
    flick(3, measure, 3.5);
    flick(4, measure, 3.5);
  }

  function sparseTaps(measure) {
    const lane = measure % 6;
    tap(lane, measure, 0);
    tap(7 - lane, measure, 2);
  }

  function fiveKeyHold(measure) {
    hold(1, 5, measure, 0, measure + 2, 3, 1);
  }

  function zigzagWide(measure) {
    hold(0, 3, measure, 0, measure, 1, 4);
    hold(4, 3, measure, 1, measure, 2, 0);
    hold(0, 4, measure, 2, measure, 3.5, 3);
  }

  function chaosBurst(measure) {
    for (let i = 0; i < 8; i += 1) {
      const lane = i % 2 === 0 ? Math.floor(i / 2) : 7 - Math.floor(i / 2);
      tap(lane, measure, i * 0.5);
    }
    flick(3, measure, 3.75);
    flick(4, measure, 3.75);
  }

  function finalGate(measure) {
    for (let lane = 0; lane < 8; lane += 1) tap(lane, measure, 0);
    hold(0, 8, measure, 1, measure, 3.5, 0);
  }

  const cycle = [
    stairsUp, anchorGate, vConverge, denseBurst, mirrorGate, railZigzag,
    xCross, spreadOut, arcStairs, splitLanes, chevronBurst, sparseTaps,
    waveHold, wallGate, stairsDown,
  ];

  const skip = new Set([122, 123, 153]);
  const forced = new Map([
    [121, fiveKeyHold],
    [131, xCross],
    [138, chaosBurst],
    [139, chaosBurst],
    [140, chaosBurst],
    [143, zigzagWide],
    [153, finalGate],
  ]);

  for (let measure = 1; measure <= TOTAL_MEASURES; measure += 1) {
    if (skip.has(measure) && !forced.has(measure)) continue;
    const pattern = forced.get(measure) ?? cycle[(measure - 1) % cycle.length];
    pattern(measure);
  }

  window.MELODINIQ_CHART = {
    id: "melodiniq-ultima",
    title: "MELODINIQ",
    artist: "onoken a.k.a. owl＊tree",
    difficulty: "ULTIMA",
    level: "14+",
    bpm: 193,
    audioPath: "assets/melodiniq.mp3",
    divisions: 8,
    notes,
  };
})();
