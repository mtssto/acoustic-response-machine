import { AcousticAnalyzer } from "./audio/analysis";
import { AudioCapture } from "./audio/capture";
import { EventInterpreter } from "./audio/interpret";
import { MachineResponse } from "./audio/response";
import { ImageEnvironment } from "./environment/imageMap";
import { createGrowthSeed, GrowthEngine } from "./growth/engine";
import { MachineState } from "./machine/state";
import { MemoryBank } from "./memory/bank";
import { CanvasRenderer } from "./renderer";
import {
  countStructure,
  type AcousticEvent,
  type AcousticMeasurement,
  type StructuralEvent,
  type StructureScene,
} from "./types";

const app = document.getElementById("app");
const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!app || !canvas) throw new Error("Missing #app or #stage");

const renderer = new CanvasRenderer(canvas);
const capture = new AudioCapture();
const analyzer = new AcousticAnalyzer();
const interpreter = new EventInterpreter();
const growth = new GrowthEngine();
const machine = new MachineState();
const memory = new MemoryBank();
const environment = new ImageEnvironment();
const response = new MachineResponse();

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*";
fileInput.style.display = "none";
app.appendChild(fileInput);

let scene: StructureScene = { elements: [], connections: [], ghosts: [] };
const t0 = performance.now();
let lastNow = t0;
let frames = 0;
let fps = 60;
let fpsT = performance.now();

let measurement: AcousticMeasurement | null = null;
let event: AcousticEvent | null = null;
let structural: StructuralEvent | null = null;
let lastLoggedType: string | null = null;
let lastLoggedAction: string | null = null;
let lastLoggedMemory: string | null = null;
let f0Confidence = 0;
let spectrum: Float32Array | null = null;
let waveform: Float32Array | null = null;
let onsetHistory: Float32Array | null = null;

let followGrowth = false;
let dragging = false;
let moved = false;
let lastPtr = { x: 0, y: 0 };

const logLines: string[] = [
  "00:00:00  FOUNDATION BOOT",
  "00:00:00  ENV: DROP IMAGE OR PRESS I",
  "00:00:00  RESPONSE: KEY R TOGGLE",
  "00:00:00  CLICK TO ENABLE MIC",
];

function pushLog(msg: string, runtimeSec: number) {
  const stamp = formatTime(runtimeSec);
  logLines.push(`${stamp}  ${msg}`);
  if (logLines.length > 8) logLines.shift();
}

function placeEnvironment() {
  const root = scene.elements.find((e) => e.kind === "root");
  const cx = root?.x ?? renderer.width * 0.55;
  const cy = root?.y ?? renderer.height * 0.55;
  const size = Math.min(renderer.width, renderer.height) * 0.85;
  environment.setWorldAround(cx, cy, size);
  growth.setEnvironment(environment.active ? environment : null);
}

async function loadEnvironmentFile(file: File) {
  const t = (performance.now() - t0) / 1000;
  const root = scene.elements.find((e) => e.kind === "root");
  const cx = root?.x ?? renderer.width * 0.55;
  const cy = root?.y ?? renderer.height * 0.55;
  const size = Math.min(renderer.width, renderer.height) * 0.85;
  try {
    await environment.loadFile(file, {
      x: cx - size / 2,
      y: cy - size / 2,
      w: size,
      h: size,
    });
    growth.setEnvironment(environment);
    pushLog(`ENV LOADED ${file.name.slice(0, 18)}`, t);
  } catch {
    pushLog("ENV LOAD FAILED", t);
  }
}

function rebuild() {
  const seed = createGrowthSeed(renderer.width, renderer.height);
  scene = seed.scene;
  growth.reset(scene, seed.bounds);
  machine.reset();
  memory.reset();
  response.reset();
  const root = scene.elements.find((e) => e.kind === "root");
  if (root) {
    renderer.camera.x = root.x;
    renderer.camera.y = root.y;
    renderer.camera.zoom = 1;
  }
  if (environment.active) placeEnvironment();
  else growth.setEnvironment(null);
  followGrowth = false;
  lastLoggedMemory = null;
}

function toggleMic() {
  const t = (performance.now() - t0) / 1000;
  if (capture.status === "LIVE") {
    void capture.stop().then(() => {
      measurement = null;
      event = null;
      structural = null;
      lastLoggedType = null;
      lastLoggedAction = null;
      spectrum = null;
      waveform = null;
      onsetHistory = null;
      f0Confidence = 0;
      interpreter.reset();
      rebuild();
      pushLog("AUDIO OFFLINE — STRUCTURE RESET", t);
    });
    return;
  }
  pushLog("MIC REQUEST", t);
  void capture.start().then(() => {
    const t2 = (performance.now() - t0) / 1000;
    if (capture.status === "LIVE") pushLog("AUDIO LIVE — RESPONSE READY", t2);
    else pushLog(`AUDIO ERROR`, t2);
  });
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;

  frames += 1;
  if (now - fpsT >= 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
  }

  const t = (now - t0) / 1000;
  const raw = capture.read();
  let memBias = {
    influence: 0,
    preferredAction: null as import("./types").StructuralAction | null,
    branchBoost: 0,
    lengthScale: 1,
    matchId: null as string | null,
    clusterId: null as string | null,
    similarity: 0,
  };

  if (raw) {
    const result = analyzer.analyze(raw.time, raw.freqDb, raw.sampleRate);
    measurement = result.measurement;
    f0Confidence = result.f0Confidence;
    spectrum = result.spectrum;
    waveform = result.waveform;
    onsetHistory = result.onsetHistory;
    event = interpreter.interpret(measurement, t);
    memBias = memory.recall(event);
    structural = growth.step(scene, event, dt, memBias);

    if (structural.action !== "IDLE" && structural.action !== "DECAY") {
      memory.remember(event, structural);
    }

    if (event.type !== lastLoggedType) {
      pushLog(`EVENT: ${event.type} (${event.confidence.toFixed(2)})`, t);
      lastLoggedType = event.type;
    }
    if (structural.action !== lastLoggedAction && structural.action !== "IDLE") {
      pushLog(`ACTION: ${structural.action}`, t);
      lastLoggedAction = structural.action;
    }
    if (
      (memBias.clusterId || memBias.matchId) &&
      memBias.influence > 0.35 &&
      (memBias.clusterId ?? memBias.matchId) !== lastLoggedMemory
    ) {
      pushLog(
        `LEARN ${(memBias.clusterId ?? memBias.matchId)!} SIM ${memBias.similarity.toFixed(2)}`,
        t
      );
      lastLoggedMemory = memBias.clusterId ?? memBias.matchId;
    }
  } else {
    structural = growth.step(scene, null, dt, null);
  }

  const counts = countStructure(scene, growth.getMeters());
  const vitals = machine.update(
    dt,
    event,
    structural,
    counts,
    memBias.influence,
    memBias.clusterId
  );

  response.tick(dt);
  if (raw && response.maybeRespond(event, structural, scene, vitals)) {
    const p = response.lastParams;
    pushLog(
      `RESPONSE ${p ? `${p.frequency.toFixed(0)}Hz` : ""}`,
      t
    );
  }

  if (followGrowth && !dragging) {
    const focus = growth.getFocusPoint();
    renderer.camera.x += (focus.x - renderer.camera.x) * 0.05;
    renderer.camera.y += (focus.y - renderer.camera.y) * 0.05;
  }

  renderer.clear();
  renderer.drawGrid();
  renderer.drawScene(scene, t, environment.active ? environment.overlay : []);
  renderer.drawInstrument({
    counts,
    runtimeSec: t,
    fps,
    audioStatus: capture.status,
    audioError: capture.error,
    measurement,
    event,
    structural,
    machine: vitals,
    growthDebug: growth.debug,
    memoryTraces: memory.list(),
    memoryMatchId: memory.lastMatch.trace?.id ?? null,
    memoryClusterId: memory.lastMatch.cluster?.id ?? memBias.clusterId,
    memorySimilarity: memory.lastMatch.similarity,
    clusters: memory.clusters(),
    envOverlay: environment.active ? environment.overlay : [],
    envName: environment.active ? environment.name : null,
    responseEnabled: response.enabled,
    responseSpeaking: response.speaking,
    responseParams: response.lastParams,
    f0Confidence,
    spectrum,
    waveform,
    onsetHistory,
    logLines,
    hint:
      capture.status === "OFFLINE" || capture.status === "ERROR"
        ? "CLICK MIC · DROP IMAGE / I · DRAG PAN · WHEEL ZOOM"
        : capture.status === "REQUESTING"
          ? "REQUESTING MICROPHONE…"
          : null,
  });
}

function onResize() {
  renderer.resize(window.innerWidth, window.innerHeight);
  rebuild();
}

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  moved = false;
  followGrowth = false;
  lastPtr = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPtr.x;
  const dy = e.clientY - lastPtr.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
  const z = renderer.camera.zoom;
  renderer.camera.x -= dx / z;
  renderer.camera.y -= dy / z;
  lastPtr = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointerup", (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
  if (!moved) toggleMic();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    followGrowth = false;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    renderer.camera.zoom = Math.max(0.35, Math.min(2.8, renderer.camera.zoom * factor));
  },
  { passive: false }
);

canvas.addEventListener("dblclick", (e) => {
  e.preventDefault();
  followGrowth = true;
  pushLog("FOLLOW GROWTH", (performance.now() - t0) / 1000);
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadEnvironmentFile(f);
  fileInput.value = "";
});

window.addEventListener("keydown", (e) => {
  if (e.key === "i" || e.key === "I") {
    e.preventDefault();
    fileInput.click();
  }
  if (e.key === "Escape" && environment.active) {
    environment.clear();
    growth.setEnvironment(null);
    pushLog("ENV CLEARED", (performance.now() - t0) / 1000);
  }
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("image/")) void loadEnvironmentFile(f);
});

window.addEventListener("resize", onResize);
onResize();

function loop(now: number) {
  frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function formatTime(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
