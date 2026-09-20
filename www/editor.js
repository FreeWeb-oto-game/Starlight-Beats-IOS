(() => {
  "use strict";

  const seedChart = structuredClone(
    window.MELODINIQ_CHART
      ? { title: "CUSTOM CHART", bpm: window.MELODINIQ_CHART.bpm, level: "??", divisions: 8, audioPath: window.MELODINIQ_CHART.audioPath, notes: [] }
      : { title: "CUSTOM CHART", bpm: 193, level: "??", divisions: 8, audioPath: "assets/melodiniq.mp3", notes: [] },
  );

  const titleInput = document.querySelector("#chartTitleInput");
  const bpmInput = document.querySelector("#chartBpmInput");
  const levelInput = document.querySelector("#chartLevelInput");
  const measureInput = document.querySelector("#measureInput");
  const noteStepInput = document.querySelector("#noteStepInput");
  const noteLaneInput = document.querySelector("#noteLaneInput");
  const noteWidthInput = document.querySelector("#noteWidthInput");
  const noteTypeInput = document.querySelector("#noteTypeInput");
  const noteEndMeasureInput = document.querySelector("#noteEndMeasureInput");
  const noteEndStepInput = document.querySelector("#noteEndStepInput");
  const noteEndLaneInput = document.querySelector("#noteEndLaneInput");
  const chartGrid = document.querySelector("#chartGrid");
  const noteList = document.querySelector("#noteList");
  const noteCount = document.querySelector("#noteCount");
  const measureNoteCount = document.querySelector("#measureNoteCount");
  const measureLabel = document.querySelector("#measureLabel");
  const saveState = document.querySelector("#chartSaveState");
  const addNoteButton = document.querySelector("#addNoteButton");
  const exportButton = document.querySelector("#exportChartButton");
  const importInput = document.querySelector("#importChartInput");
  const resetButton = document.querySelector("#resetChartButton");
  const undoButton = document.querySelector("#undoButton");
  const redoButton = document.querySelector("#redoButton");

  function isChart(value) {
    return Boolean(value && Array.isArray(value.notes) && Number.isFinite(Number(value.bpm)));
  }

  function readStoredChart() {
    const stored = window.StarlightStorage.read("charts", {}).custom;
    return isChart(stored) ? stored : structuredClone(seedChart);
  }

  let chart = readStoredChart();
  let undoStack = [];
  let redoStack = [];

  function snapshot() {
    return JSON.stringify(chart);
  }

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    refreshHistoryButtons();
  }

  function refreshHistoryButtons() {
    if (undoButton) undoButton.disabled = undoStack.length === 0;
    if (redoButton) redoButton.disabled = redoStack.length === 0;
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshot());
    chart = JSON.parse(undoStack.pop());
    persistChart();
    render();
    refreshHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot());
    chart = JSON.parse(redoStack.pop());
    persistChart();
    render();
    refreshHistoryButtons();
  }

  function currentMeasure() {
    return Math.max(1, Math.round(Number(measureInput.value) || 1));
  }

  function noteMeasure(note) {
    return Math.floor((note.beat - 4) / 4) + 1;
  }

  function noteStep(note) {
    return Math.round((((note.beat - 4) % 4 + 4) % 4) * 4);
  }

  function endMeasure(note) {
    return note.endBeat ? Math.floor((note.endBeat - 4) / 4) + 1 : currentMeasure();
  }

  function endStep(note) {
    return note.endBeat ? Math.round((((note.endBeat - 4) % 4 + 4) % 4) * 4) : 0;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
  }

  function normalizeChart(source) {
    const title = String(source.title || "CUSTOM CHART").slice(0, 42);
    const bpm = clamp(source.bpm, 60, 300);
    const level = String(source.level || "??").slice(0, 6);
    const notes = source.notes
      .filter((note) => note && Number.isFinite(Number(note.beat)))
      .map((note, index) => {
        const lane = clamp(note.lane, 0, 7);
        const width = clamp(note.width, 1, 8 - lane);
        const type = ["tap", "gold", "flick", "hold"].includes(note.type) ? note.type : "tap";
        const endBeat = type === "hold" ? Math.max(Number(note.endBeat) || Number(note.beat) + 1, Number(note.beat) + 0.25) : null;
        return {
          id: String(note.id || `custom-${index}-${Date.now()}`),
          type,
          lane,
          width,
          beat: Math.max(4, Math.round(Number(note.beat) * 4) / 4),
          endBeat,
          endLane: type === "hold" ? clamp(note.endLane ?? lane, 0, 7) : lane,
        };
      })
      .sort((a, b) => a.beat - b.beat || a.lane - b.lane);
    return { id: "custom", title, bpm, level, divisions: 8, audioPath: seedChart.audioPath, notes };
  }

  function persistChart() {
    chart = normalizeChart(chart);
    const store = window.StarlightStorage.read("charts", {});
    store.custom = chart;
    window.StarlightStorage.write("charts", store);
    if (saveState) saveState.textContent = "SAVED";
  }

  function setEditorValues() {
    titleInput.value = chart.title;
    bpmInput.value = chart.bpm;
    if (levelInput) levelInput.value = chart.level || "??";
  }

  function selectedNotes() {
    return chart.notes.filter((note) => noteMeasure(note) === currentMeasure());
  }

  function renderGrid() {
    const measure = currentMeasure();
    chartGrid.replaceChildren();
    measureLabel.textContent = `MEASURE ${String(measure).padStart(3, "0")}`;
    for (let step = 15; step >= 0; step -= 1) {
      for (let lane = 0; lane < 8; lane += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "chart-cell";
        cell.dataset.step = String(step);
        cell.dataset.lane = String(lane);
        cell.setAttribute("aria-label", `Step ${step}, lane ${lane + 1}`);
        chartGrid.append(cell);
      }
    }

    for (const note of selectedNotes()) {
      const marker = document.createElement("span");
      const step = noteStep(note);
      marker.className = `grid-note grid-note--${note.type}`;
      marker.style.gridColumn = `${note.lane + 1} / span ${note.width}`;
      marker.style.gridRow = `${16 - step} / span 1`;
      marker.title = `${note.type.toUpperCase()} lane ${note.lane + 1}`;
      chartGrid.append(marker);
    }
  }

  function renderList() {
    const notes = selectedNotes().sort((a, b) => a.beat - b.beat || a.lane - b.lane);
    noteList.replaceChildren();
    noteCount.textContent = `${chart.notes.length} NOTES`;
    measureNoteCount.textContent = String(notes.length).padStart(2, "0");
    if (!notes.length) {
      const empty = document.createElement("p");
      empty.className = "note-empty";
      empty.textContent = "NO NOTES";
      noteList.append(empty);
      return;
    }
    for (const note of notes) {
      const row = document.createElement("div");
      row.className = "note-row";
      const label = document.createElement("span");
      const end = note.type === "hold" ? ` → M${endMeasure(note)}:${String(endStep(note)).padStart(2, "0")}` : "";
      label.textContent = `${String(noteStep(note)).padStart(2, "0")}  L${note.lane + 1}  ${note.type.toUpperCase()}${end}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "DELETE";
      remove.dataset.noteId = note.id;
      row.append(label, remove);
      noteList.append(row);
    }
  }

  function render() {
    setEditorValues();
    renderGrid();
    renderList();
    refreshHistoryButtons();
  }

  function addNote(values = {}) {
    pushHistory();
    const measure = clamp(values.measure ?? currentMeasure(), 1, 999);
    const step = clamp(values.step ?? noteStepInput.value, 0, 15);
    const lane = clamp(values.lane ?? Number(noteLaneInput.value) - 1, 0, 7);
    const width = clamp(values.width ?? noteWidthInput.value, 1, 8 - lane);
    const type = values.type ?? noteTypeInput.value;
    const endMeasureValue = clamp(values.endMeasure ?? noteEndMeasureInput.value, measure, 999);
    const endStepValue = clamp(values.endStep ?? noteEndStepInput.value, 0, 15);
    const endLane = clamp(values.endLane ?? Number(noteEndLaneInput.value) - 1, 0, 7);
    const beat = 4 + (measure - 1) * 4 + step / 4;
    const endBeat = type === "hold" ? Math.max(beat + 0.25, 4 + (endMeasureValue - 1) * 4 + endStepValue / 4) : null;
    chart.notes.push({
      id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      lane,
      width,
      beat,
      endBeat,
      endLane: type === "hold" ? endLane : lane,
    });
    persistChart();
    render();
  }

  function syncMeta() {
    pushHistory();
    chart.title = titleInput.value.trim() || "CUSTOM CHART";
    chart.bpm = clamp(bpmInput.value, 60, 300);
    chart.level = (levelInput?.value || "??").trim().slice(0, 6) || "??";
    persistChart();
    render();
  }

  titleInput.addEventListener("change", syncMeta);
  bpmInput.addEventListener("change", syncMeta);
  levelInput?.addEventListener("change", syncMeta);
  measureInput.addEventListener("input", render);
  addNoteButton.addEventListener("click", () => addNote());

  chartGrid.addEventListener("click", (event) => {
    const cell = event.target.closest(".chart-cell");
    if (!cell) return;
    noteStepInput.value = cell.dataset.step;
    noteLaneInput.value = String(Number(cell.dataset.lane) + 1);
    noteTypeInput.value = "tap";
    addNote({ step: cell.dataset.step, lane: cell.dataset.lane, type: "tap", width: 1 });
  });

  noteList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-note-id]");
    if (!button) return;
    pushHistory();
    chart.notes = chart.notes.filter((note) => note.id !== button.dataset.noteId);
    persistChart();
    render();
  });

  exportButton.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(normalizeChart(chart), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chart.title.replace(/[^a-z0-9_-]+/gi, "-") || "chart"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const imported = normalizeChart(JSON.parse(String(reader.result)));
        if (!isChart(imported)) throw new Error("Invalid chart");
        pushHistory();
        chart = imported;
        measureInput.value = "1";
        persistChart();
        render();
      } catch {
        if (saveState) saveState.textContent = "INVALID FILE";
      }
    });
    reader.readAsText(file);
    importInput.value = "";
  });

  resetButton.addEventListener("click", async () => {
    const confirmed = await window.StarlightScreens?.confirm("譜面を初期状態に戻しますか？");
    if (!confirmed) return;
    pushHistory();
    chart = structuredClone(seedChart);
    measureInput.value = "1";
    persistChart();
    render();
  });

  undoButton?.addEventListener("click", undo);
  redoButton?.addEventListener("click", redo);

  window.addEventListener("starlight-editor-open", () => {
    chart = readStoredChart();
    undoStack = [];
    redoStack = [];
    render();
  });

  render();
})();
