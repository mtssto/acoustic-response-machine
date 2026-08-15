import { AcousticAnalyzer } from "./audio/analysis";
import { AudioCapture } from "./audio/capture";
import { EventInterpreter } from "./audio/interpret";
import { createGrowthSeed, GrowthEngine } from "./growth/engine";
import { MachineState } from "./machine/state";
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
  "00:00:00  MACHINE STATE ONLINE",
  "00:00:00  AUDIO OFFLINE",
  "00:00:00  CLICK TO ENABLE MIC",
];

function pushLog(msg: string, runtimeSec: number) {
  const stamp = formatTime(runtimeSec);
  logLines.push(`${stamp}  ${msg}`);
  if (logLines.length > 8) logLines.shift();
}

function rebuild() {
  const seed = createGrowthSeed(renderer.width, renderer.height);
  scene = seed.scene;
  growth.reset(scene, seed.bounds);
  machine.reset();
  const root = scene.elements.find((e) => e.kind === "root");
  if (root) {
    renderer.camera.x = root.x;
    renderer.camera.y = root.y;
    renderer.camera.zoom = 1;
  }
  followGrowth = false;
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
    if (capture.status === "LIVE") pushLog("AUDIO LIVE — EVENT GROWTH", t2);
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
  if (raw) {
    const result = analyzer.analyze(raw.time, raw.freqDb, raw.sampleRate);
    measurement = result.measurement;
    f0Confidence = result.f0Confidence;
    spectrum = result.spectrum;
    waveform = result.waveform;
    onsetHistory = result.onsetHistory;
    event = interpreter.interpret(measurement, t);
    structural = growth.step(scene, event, dt);

    if (event.type !== lastLoggedType) {
      pushLog(`EVENT: ${event.type} (${event.confidence.toFixed(2)})`, t);
      lastLoggedType = event.type;
    }
    if (structural.action !== lastLoggedAction && structural.action !== "IDLE") {
      pushLog(`ACTION: ${structural.action}`, t);
      lastLoggedAction = structural.action;
    }
  } else {
    structural = growth.step(scene, null, dt);
  }

  const counts = countStructure(scene, growth.getMeters());
  const vitals = machine.update(dt, event, structural, counts);

  if (followGrowth && !dragging) {
    const focus = growth.getFocusPoint();
    renderer.camera.x += (focus.x - renderer.camera.x) * 0.05;
    renderer.camera.y += (focus.y - renderer.camera.y) * 0.05;
  }

  renderer.clear();
  renderer.drawGrid();
  renderer.drawScene(scene, t);
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
    f0Confidence,
    spectrum,
    waveform,
    onsetHistory,
    logLines,
    hint:
      capture.status === "OFFLINE" || capture.status === "ERROR"
        ? "CLICK MIC · DRAG PAN · WHEEL ZOOM · DBLCLICK FOLLOW"
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
