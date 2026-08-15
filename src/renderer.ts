import type { EnvOverlaySeg } from "./environment/imageMap";
import type { GrowthDebug } from "./growth/engine";
import type { MachineVitals } from "./machine/state";
import type { MemoryTrace } from "./memory/bank";
import type {
  AcousticEvent,
  AcousticMeasurement,
  Connection,
  StructuralElement,
  StructuralEvent,
  StructureCounts,
  StructureScene,
} from "./types";
import type { AudioStatus } from "./audio/capture";

const C = {
  grid: "rgba(90, 110, 120, 0.06)",
  line: "rgba(120, 170, 175, 0.45)",
  lineHot: "rgba(90, 210, 180, 0.9)",
  stroke: "rgba(150, 200, 205, 0.75)",
  strokeHot: "rgba(80, 220, 190, 1)",
  fill: "rgba(6, 10, 12, 0.85)",
  text: "rgba(170, 195, 200, 0.88)",
  textDim: "rgba(110, 135, 140, 0.75)",
  accent: "#5fe0b8",
  panel: "rgba(130, 155, 160, 0.55)",
  danger: "rgba(200, 120, 100, 0.7)",
};

export interface HudFrame {
  counts: StructureCounts;
  runtimeSec: number;
  fps: number;
  audioStatus: AudioStatus;
  audioError: string | null;
  measurement: AcousticMeasurement | null;
  event: AcousticEvent | null;
  structural: StructuralEvent | null;
  machine: MachineVitals | null;
  growthDebug: GrowthDebug | null;
  memoryTraces: MemoryTrace[];
  memoryMatchId: string | null;
  memorySimilarity: number;
  envOverlay: EnvOverlaySeg[];
  envName: string | null;
  f0Confidence: number;
  spectrum: Float32Array | null;
  waveform: Float32Array | null;
  onsetHistory: Float32Array | null;
  logLines: string[];
  hint: string | null;
}

export interface CameraState {
  /** World point at screen center. */
  x: number;
  y: number;
  zoom: number;
}

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  camera: CameraState = { x: 0, y: 0, zoom: 1 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.floor(cssWidth * dpr);
    this.canvas.height = Math.floor(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.fillStyle = "#050607";
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private beginWorld() {
    const { ctx, width, height, camera } = this;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  private endWorld() {
    this.ctx.restore();
  }

  drawGrid(spacing = 36) {
    const { ctx, camera } = this;
    this.beginWorld();
    const viewW = this.width / camera.zoom;
    const viewH = this.height / camera.zoom;
    const x0 = Math.floor((camera.x - viewW / 2) / spacing) * spacing;
    const y0 = Math.floor((camera.y - viewH / 2) / spacing) * spacing;
    const x1 = camera.x + viewW / 2 + spacing;
    const y1 = camera.y + viewH / 2 + spacing;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += spacing) {
      ctx.moveTo(x + 0.5, y0);
      ctx.lineTo(x + 0.5, y1);
    }
    for (let y = y0; y <= y1; y += spacing) {
      ctx.moveTo(x0, y + 0.5);
      ctx.lineTo(x1, y + 0.5);
    }
    ctx.stroke();
    this.endWorld();
  }

  drawScene(scene: StructureScene, t: number, envOverlay: EnvOverlaySeg[] = []) {
    const { ctx } = this;
    this.beginWorld();

    // Environment edge field (constraints map — not photographic background)
    if (envOverlay.length) {
      ctx.save();
      for (const s of envOverlay) {
        ctx.strokeStyle = `rgba(90, 160, 170, ${s.a})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = "rgba(90, 160, 150, 0.08)";
    for (const g of scene.ghosts) {
      ctx.fillRect(g.x, g.y, g.s, g.s);
    }

    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    for (const c of scene.connections) this.drawConnection(c, byId, t);
    for (const e of scene.elements) this.drawElement(e, t);
    this.endWorld();
  }

  drawInstrument(hud: HudFrame) {
    this.drawTitle(hud);
    this.drawLeftPanels(hud);
    this.drawRightScale();
    this.drawBottomAnalyzers(hud);
    if (hud.hint) this.drawHint(hud.hint);
    this.drawMapHelp(hud.envName);
  }

  private drawMapHelp(envName: string | null) {
    const { ctx, width, height } = this;
    ctx.save();
    ctx.fillStyle = C.textDim;
    ctx.font = "9px Courier New, monospace";
    ctx.textAlign = "right";
    ctx.fillText(
      "DRAG PAN  ·  WHEEL ZOOM  ·  CLICK MIC  ·  DROP IMAGE / KEY I",
      width - 48,
      height * 0.74
    );
    if (envName) {
      ctx.fillStyle = C.accent;
      ctx.fillText(`ENV  ${envName.slice(0, 28)}`, width - 48, height * 0.74 - 14);
    }
    ctx.textAlign = "left";
    ctx.restore();
  }

  private drawHint(text: string) {
    const { ctx, width, height } = this;
    ctx.save();
    ctx.fillStyle = "rgba(95, 224, 184, 0.85)";
    ctx.font = "12px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, width * 0.55, height * 0.42);
    ctx.textAlign = "left";
    ctx.restore();
  }

  private drawTitle(hud: HudFrame) {
    const { ctx, width } = this;
    ctx.save();
    ctx.fillStyle = C.text;
    ctx.font = "11px Courier New, monospace";
    ctx.fillText(
      "ACOUSTIC RESPONSE MACHINE  —  SYSTEM SIMULATION  v0.7.0  [ENVIRONMENT]",
      18,
      22
    );
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "right";
    const rt = formatTime(hud.runtimeSec);
    ctx.fillText(
      `RUN TIME  ${rt}    FPS  ${hud.fps.toFixed(1)}    CPU  —`,
      width - 18,
      22
    );
    ctx.textAlign = "left";
    ctx.restore();
  }

  private drawLeftPanels(hud: HudFrame) {
    const c = hud.counts;
    const m = hud.measurement;
    const live = hud.audioStatus === "LIVE";
    const x = 16;
    let y = 44;
    const w = Math.min(220, this.width * 0.23);

    y = this.panel(
      x,
      y,
      w,
      [
        "AUDIO INPUT",
        `STATUS     ${hud.audioStatus}`,
        `SOURCE     ${live ? "MICROPHONE" : "—"}`,
        `TIME       ${live ? formatTime(hud.runtimeSec) : "—"}`,
        hud.audioError ? `ERROR      ${hud.audioError.slice(0, 18)}` : "CLICK CANVAS TO ENABLE MIC",
      ],
      live
    );

    const f0 =
      m?.fundamentalFrequency != null
        ? hud.f0Confidence >= 0.65
          ? `${m.fundamentalFrequency.toFixed(2)} Hz`
          : `${m.fundamentalFrequency.toFixed(1)} Hz ~`
        : hud.f0Confidence > 0 && hud.f0Confidence < 0.45
          ? "LOW CONFIDENCE"
          : "UNAVAILABLE";

    y = this.panel(
      x,
      y + 8,
      w,
      [
        "ACOUSTIC MEASUREMENTS",
        `Fundamental    ${f0}`,
        `RMS            ${fmtDb(m?.rms ?? null)}`,
        `Peak           ${fmtDb(m?.peak ?? null)}`,
        `Spectral Cent. ${fmtHz(m?.spectralCentroid ?? null)}`,
        `Bandwidth      ${fmtHz(m?.spectralBandwidth ?? null)}`,
        `Rolloff        ${fmtHz(m?.spectralRolloff ?? null)}`,
        `Harmonicity    ${fmtUnit(m?.harmonicity ?? null)}`,
        `ZCR            ${fmtUnit(m?.zeroCrossingRate ?? null)}`,
        `Onset          ${fmtUnit(m?.onset ?? null)}`,
        `Temporal Flux  ${fmtUnit(m?.onset ?? null)}`,
      ],
      live
    );

    y = this.panel(
      x,
      y + 8,
      w,
      [
        "STRUCTURAL STATE",
        `Nodes          ${pad(c.nodes)}`,
        `Edges          ${pad(c.edges)}`,
        `Branches       ${pad(c.branches)}`,
        `Growth         ${c.growth.toFixed(2)}`,
        `Decay          ${c.decay.toFixed(2)}`,
        `Stability      ${c.stability.toFixed(2)}`,
        `Density        ${c.density.toFixed(2)}`,
        `Balance        ${c.balance.toFixed(2)}`,
      ],
      false
    );

    const ev = hud.event;
    const st = hud.structural;
    const gd = hud.growthDebug;
    const mv = hud.machine;
    y = this.panel(
      x,
      y + 8,
      w,
      [
        "MACHINE STATE",
        `Event          ${mv?.currentEvent ?? ev?.type ?? "NONE"}`,
        `Action         ${mv?.currentAction ?? st?.action ?? "IDLE"}`,
        `Behavior       ${mv?.behavior ?? "STANDBY"}`,
        `Mode           ${mv?.mode ?? "MACHINE"}`,
        `Energy         ${mv ? mv.energy.toFixed(2) : "0.00"}`,
        `Stability      ${mv ? mv.stability.toFixed(2) : "0.00"}`,
        `Growth         ${mv ? mv.growth.toFixed(2) : "0.00"}`,
        `Density        ${mv ? mv.density.toFixed(2) : "0.00"}`,
        `Memory Infl.   ${mv ? mv.memoryInfluence.toFixed(2) : "0.00"}`,
        `Focus          ${mv?.focus ?? "LOW"}`,
      ],
      false
    );

    this.panel(
      x,
      y + 8,
      w,
      [
        "GROWTH DEBUG",
        `Endpoint       ${gd?.selectedEndpoint ?? "—"}`,
        `Angle          ${gd ? `${gd.angleDeg.toFixed(1)}°` : "—"}`,
        `Length         ${gd ? gd.length.toFixed(1) : "—"}`,
        `Branch P       ${gd ? gd.branchProbability.toFixed(3) : "—"}`,
        `Frontier       ${gd ? String(gd.frontier) : "—"}`,
        `Onset          ${gd ? gd.onset.toFixed(3) : "—"}`,
        ...hud.logLines.slice(-3),
      ],
      false
    );
  }

  private panel(
    x: number,
    y: number,
    w: number,
    lines: string[],
    audioLive: boolean
  ): number {
    const { ctx } = this;
    const h = 16 + lines.length * 13;
    ctx.save();
    ctx.strokeStyle = "rgba(100, 140, 145, 0.35)";
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = C.text;
    ctx.font = "10px Courier New, monospace";
    ctx.fillText(lines[0], x + 8, y + 14);
    ctx.font = "10px Courier New, monospace";
    for (let i = 1; i < lines.length; i++) {
      const isOffline =
        lines[i].includes("UNAVAILABLE") ||
        lines[i].includes("OFFLINE") ||
        lines[i].includes("NONE") ||
        lines[i].includes("IDLE") ||
        lines[i].includes("LOW CONFIDENCE");
      ctx.fillStyle = isOffline ? "rgba(120, 130, 130, 0.65)" : C.textDim;
      if (
        (lines[0] === "STRUCTURAL STATE" || lines[0] === "ACOUSTIC MEASUREMENTS") &&
        i >= 1 &&
        !isOffline
      ) {
        ctx.fillStyle = C.text;
      }
      ctx.fillText(lines[i], x + 8, y + 14 + i * 13);
    }
    if (lines[0] === "AUDIO INPUT") {
      ctx.fillStyle = audioLive ? C.accent : C.danger;
      ctx.fillRect(x + w - 54, y + 6, 6, 6);
      ctx.fillStyle = audioLive ? C.accent : C.textDim;
      ctx.fillText(audioLive ? "LIVE" : "OFF", x + w - 42, y + 14);
    }
    ctx.restore();
    return y + h;
  }

  private drawRightScale() {
    const { ctx, width, height } = this;
    const x = width - 36;
    const top = 48;
    const bot = height * 0.72;
    ctx.save();
    ctx.strokeStyle = "rgba(100, 140, 150, 0.4)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, bot);
    ctx.stroke();
    ctx.font = "9px Courier New, monospace";
    ctx.fillStyle = C.textDim;
    ctx.textAlign = "right";
    const marks = [300, 200, 100, 0, -100, -200, -300];
    for (const m of marks) {
      const t = (300 - m) / 600;
      const yy = top + t * (bot - top);
      ctx.beginPath();
      ctx.moveTo(x - 4, yy + 0.5);
      ctx.lineTo(x + 4, yy + 0.5);
      ctx.stroke();
      ctx.fillText((m >= 0 ? "+" : "") + String(m).padStart(3, "0"), x - 8, yy + 3);
    }
    // zero marker
    const zy = top + 0.5 * (bot - top);
    ctx.fillStyle = C.accent;
    ctx.fillRect(x - 2, zy - 2, 8, 4);
    ctx.textAlign = "left";
    ctx.restore();
  }

  private drawBottomAnalyzers(hud: HudFrame) {
    const { ctx, width, height } = this;
    const y = height * 0.76;
    const h = height * 0.2;
    const gap = 8;
    const labels = [
      "SPECTRUM ANALYZER",
      "WAVEFORM",
      "EVENT DETECTOR",
      "MEMORY BANK",
      "PATTERN PREVIEW",
    ];
    const live = hud.audioStatus === "LIVE";
    const total = labels.length;
    const w = (width - 32 - gap * (total - 1)) / total;
    ctx.save();
    for (let i = 0; i < total; i++) {
      const x = 16 + i * (w + gap);
      ctx.strokeStyle = "rgba(100, 140, 145, 0.35)";
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.fillStyle = C.textDim;
      ctx.font = "9px Courier New, monospace";
      ctx.fillText(labels[i], x + 8, y + 14);
      const status =
        i < 3
          ? live
            ? "LIVE"
            : "OFFLINE"
          : i === 3
            ? (hud.memoryTraces?.length ?? 0) > 0
              ? "ACTIVE"
              : "EMPTY"
            : "OFFLINE";
      ctx.fillStyle =
        status === "LIVE" || status === "ACTIVE"
          ? C.accent
          : "rgba(100, 120, 120, 0.45)";
      ctx.fillText(status, x + 8, y + 30);

      if (i === 0) this.drawSpectrum(x + 8, y + 40, w - 16, h - 52, hud.spectrum);
      else if (i === 1) this.drawWave(x + 8, y + 40, w - 16, h - 52, hud.waveform);
      else if (i === 2) this.drawOnsets(x + 8, y + 40, w - 16, h - 52, hud.onsetHistory);
      else if (i === 3) this.drawMemoryBank(x + 8, y + 40, w - 16, h - 48, hud);
      else {
        this.stubPattern(x + 8, y + 40, w - 16, h - 52);
      }
    }
    ctx.restore();
  }

  private drawMemoryBank(
    x: number,
    y: number,
    _w: number,
    _h: number,
    hud: HudFrame
  ) {
    const { ctx } = this;
    const traces = hud.memoryTraces ?? [];
    if (traces.length === 0) {
      ctx.fillStyle = C.textDim;
      ctx.font = "9px Courier New, monospace";
      ctx.fillText("WAITING PATTERN MEMORY", x, y + 8);
      return;
    }
    ctx.font = "9px Courier New, monospace";
    let yy = y;
    for (let i = 0; i < Math.min(traces.length, 5); i++) {
      const t = traces[i];
      const hit = t.id === hud.memoryMatchId;
      ctx.fillStyle = hit ? C.accent : C.textDim;
      const sim =
        hit && hud.memorySimilarity > 0
          ? hud.memorySimilarity.toFixed(2)
          : "—";
      ctx.fillText(
        `${t.id}  ${t.type.slice(0, 4)}  SIM ${sim}  USES ${String(t.uses).padStart(2)}`,
        x,
        yy + 8
      );
      yy += 14;
    }
  }

  private drawSpectrum(
    x: number,
    y: number,
    w: number,
    h: number,
    spectrum: Float32Array | null
  ) {
    const { ctx } = this;
    const n = 48;
    const bw = w / n;
    if (!spectrum || spectrum.length < 2) {
      ctx.strokeStyle = "rgba(80, 120, 120, 0.25)";
      for (let i = 0; i < n; i++) {
        ctx.strokeRect(x + i * bw, y + h - 2, Math.max(bw - 1, 1), 2);
      }
    } else {
      ctx.fillStyle = "rgba(90, 210, 180, 0.75)";
      for (let i = 0; i < n; i++) {
        const idx = Math.floor((i / n) * (spectrum.length * 0.7));
        const v = spectrum[idx] ?? 0;
        const bh = Math.max(1, v * h);
        ctx.fillRect(x + i * bw, y + h - bh, Math.max(bw - 1, 1), bh);
      }
    }
    ctx.fillStyle = C.textDim;
    ctx.font = "8px Courier New, monospace";
    ctx.fillText("20Hz", x, y + h + 10);
    ctx.fillText("20k", x + w - 16, y + h + 10);
  }

  private drawWave(
    x: number,
    y: number,
    w: number,
    h: number,
    wave: Float32Array | null
  ) {
    const { ctx } = this;
    ctx.strokeStyle = wave ? C.accent : "rgba(80, 140, 130, 0.25)";
    ctx.beginPath();
    if (!wave || wave.length < 2) {
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
    } else {
      const step = Math.max(1, Math.floor(wave.length / w));
      for (let px = 0; px < w; px++) {
        const i = Math.min(wave.length - 1, px * step);
        const yy = y + h / 2 - wave[i] * (h * 0.45);
        if (px === 0) ctx.moveTo(x + px, yy);
        else ctx.lineTo(x + px, yy);
      }
    }
    ctx.stroke();
  }

  private drawOnsets(
    x: number,
    y: number,
    w: number,
    h: number,
    hist: Float32Array | null
  ) {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(80, 140, 130, 0.25)";
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.7);
    ctx.lineTo(x + w, y + h * 0.7);
    ctx.stroke();
    if (!hist) return;
    ctx.strokeStyle = C.accent;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const px = x + (i / Math.max(hist.length - 1, 1)) * w;
      const py = y + h - hist[i] * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  private stubPattern(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(80, 140, 130, 0.3)";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + h * 0.85);
    ctx.lineTo(x + w * 0.5, y + h * 0.55);
    ctx.lineTo(x + w * 0.3, y + h * 0.35);
    ctx.moveTo(x + w * 0.5, y + h * 0.55);
    ctx.lineTo(x + w * 0.7, y + h * 0.3);
    ctx.stroke();
    ctx.strokeRect(x + w * 0.45, y + h * 0.8, 8, 8);
  }

  private drawConnection(
    c: Connection,
    byId: Map<string, StructuralElement>,
    t: number
  ) {
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (!a || !b) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.spine ? C.lineHot : c.signal ? C.lineHot : C.line;
    ctx.globalAlpha = c.spine ? 0.95 : c.signal ? 0.75 : 0.5;
    ctx.lineWidth = c.spine ? 2.2 : c.signal ? 1.35 : 0.9;
    ctx.beginPath();
    if (c.style === "ortho") {
      const bias = c.bias ?? 0.5;
      const mx = a.x + (b.x - a.x) * bias;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mx, a.y);
      ctx.lineTo(mx, b.y);
      ctx.lineTo(b.x, b.y);
    } else if (c.style === "curve") {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, b.x, b.y);
    } else {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    if (c.signal) {
      const u = (t * 0.28 + (c.id.length % 5) * 0.1) % 1;
      const px = a.x + (b.x - a.x) * u;
      const py = a.y + (b.y - a.y) * u;
      ctx.fillStyle = C.accent;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    ctx.restore();
  }

  private drawElement(e: StructuralElement, t: number) {
    switch (e.kind) {
      case "root":
        this.drawRoot(e);
        break;
      case "square":
        this.drawSquare(e);
        break;
      case "junction":
        this.drawJunction(e);
        break;
      case "marker":
        this.drawMarker(e);
        break;
      case "module":
        this.drawModule(e, t);
        break;
    }
  }

  private drawSquare(e: StructuralElement) {
    const { ctx } = this;
    const s = e.size;
    ctx.save();
    ctx.fillStyle = C.fill;
    ctx.strokeStyle = C.stroke;
    ctx.lineWidth = 1;
    ctx.fillRect(e.x - s, e.y - s, s * 2, s * 2);
    ctx.strokeRect(e.x - s + 0.5, e.y - s + 0.5, s * 2, s * 2);
    ctx.restore();
  }

  private drawJunction(e: StructuralElement) {
    const { ctx } = this;
    const s = e.size;
    ctx.save();
    ctx.fillStyle = C.fill;
    ctx.strokeStyle = C.strokeHot;
    ctx.lineWidth = 1.1;
    ctx.fillRect(e.x - s, e.y - s, s * 2, s * 2);
    ctx.strokeRect(e.x - s + 0.5, e.y - s + 0.5, s * 2, s * 2);
    ctx.strokeStyle = "rgba(120, 180, 175, 0.45)";
    ctx.beginPath();
    ctx.moveTo(e.x - s + 2, e.y);
    ctx.lineTo(e.x + s - 2, e.y);
    ctx.moveTo(e.x, e.y - s + 2);
    ctx.lineTo(e.x, e.y + s - 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawMarker(e: StructuralElement) {
    const { ctx } = this;
    const s = e.size;
    ctx.save();
    ctx.fillStyle = C.fill;
    ctx.strokeStyle = C.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - s);
    ctx.lineTo(e.x + s, e.y);
    ctx.lineTo(e.x, e.y + s);
    ctx.lineTo(e.x - s, e.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (e.index != null) {
      ctx.fillStyle = C.text;
      ctx.font = "8px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(e.index).padStart(2, "0"), e.x, e.y + 0.5);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  private drawRoot(e: StructuralElement) {
    const { ctx } = this;
    const w = 88;
    const h = 28;
    const x = e.x - w / 2;
    const y = e.y - h / 2;
    ctx.save();
    ctx.fillStyle = C.fill;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.4;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = C.accent;
    ctx.font = "10px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText(e.label ?? "N-00 ROOT", e.x, e.y + 3);
    ctx.textAlign = "left";
    ctx.restore();
  }

  private drawModule(e: StructuralElement, t: number) {
    const { ctx } = this;
    const w = e.w ?? 72;
    const h = e.h ?? 44;
    const x = e.x - w / 2;
    const y = e.y - h / 2;
    const hot = e.accent && Math.sin(t * 1.2) > 0.55;

    ctx.save();
    ctx.fillStyle = C.fill;
    ctx.strokeStyle = hot ? C.accent : "rgba(90, 160, 200, 0.85)";
    ctx.lineWidth = hot ? 1.4 : 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    ctx.fillStyle = C.text;
    ctx.font = "10px Courier New, monospace";
    ctx.fillText(e.label ?? e.id, x + 7, y + 14);
    ctx.fillStyle = C.textDim;
    ctx.font = "9px Courier New, monospace";
    // Structural placeholders (SIM) — not acoustic Hz
    ctx.fillText(`F:${String(e.fit ?? 0).padStart(3, "0")}`, x + 7, y + 27);
    ctx.fillText(`E:${(e.energy ?? 0).toFixed(2)}`, x + 7, y + 38);
    ctx.restore();
  }
}

function pad(n: number): string {
  return String(n).padStart(4, " ");
}

function formatTime(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtDb(v: number | null): string {
  if (v == null) return "UNAVAILABLE";
  return `${v.toFixed(1)} dBFS`;
}

function fmtHz(v: number | null): string {
  if (v == null) return "UNAVAILABLE";
  if (v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
  return `${v.toFixed(1)} Hz`;
}

function fmtUnit(v: number | null): string {
  if (v == null) return "UNAVAILABLE";
  return v.toFixed(3);
}
