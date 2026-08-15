/**
 * Phase 7 — image as spatial environment (not a background plate).
 * Analyzes edges / contrast / local direction; growth samples this field.
 */

export interface EnvSample {
  /** Edge strength 0–1 at sample point. */
  edge: number;
  /** Edge tangent direction (unit). */
  dirX: number;
  dirY: number;
  /** Nearby high-contrast interest 0–1. */
  interest: number;
}

export interface EnvOverlaySeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  a: number;
}

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ImageEnvironment {
  active = false;
  name = "";
  /** Analysis grid size. */
  cols = 0;
  rows = 0;
  private edge: Float32Array = new Float32Array(0);
  private dirX: Float32Array = new Float32Array(0);
  private dirY: Float32Array = new Float32Array(0);
  private interest: Float32Array = new Float32Array(0);
  interests: Array<{ x: number; y: number; s: number }> = [];
  overlay: EnvOverlaySeg[] = [];
  world: WorldRect = { x: 0, y: 0, w: 1, h: 1 };

  clear() {
    this.active = false;
    this.name = "";
    this.cols = 0;
    this.rows = 0;
    this.edge = new Float32Array(0);
    this.dirX = new Float32Array(0);
    this.dirY = new Float32Array(0);
    this.interest = new Float32Array(0);
    this.interests = [];
    this.overlay = [];
  }

  async loadFile(file: File, world: WorldRect): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      await this.loadUrl(url, file.name, world);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadUrl(url: string, name: string, world: WorldRect): Promise<void> {
    const img = await loadImage(url);
    this.name = name;
    this.world = { ...world };
    this.analyze(img);
    this.active = true;
  }

  /** Place environment around a world focus (e.g. root). */
  setWorldAround(cx: number, cy: number, size: number) {
    this.world = {
      x: cx - size / 2,
      y: cy - size / 2,
      w: size,
      h: size,
    };
    this.remapInterests();
    this.rebuildOverlay();
  }

  private remapInterests() {
    if (this.cols < 2) return;
    const pts: Array<{ x: number; y: number; s: number }> = [];
    for (let y = 2; y < this.rows - 2; y += 2) {
      for (let x = 2; x < this.cols - 2; x += 2) {
        const i = y * this.cols + x;
        const e = this.interest[i];
        if (e < 0.35) continue;
        pts.push({
          x: this.world.x + (x / (this.cols - 1)) * this.world.w,
          y: this.world.y + (y / (this.rows - 1)) * this.world.h,
          s: e,
        });
      }
    }
    pts.sort((a, b) => b.s - a.s);
    this.interests = pts.slice(0, 48);
  }

  sample(wx: number, wy: number): EnvSample | null {
    if (!this.active || this.cols < 2) return null;
    const { x, y, w, h } = this.world;
    const u = (wx - x) / w;
    const v = (wy - y) / h;
    if (u < 0 || v < 0 || u > 1 || v > 1) {
      return { edge: 0, dirX: 1, dirY: 0, interest: 0 };
    }
    const gx = u * (this.cols - 1);
    const gy = v * (this.rows - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(this.cols - 1, x0 + 1);
    const y1 = Math.min(this.rows - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const bil = (arr: Float32Array) => {
      const a = arr[y0 * this.cols + x0];
      const b = arr[y0 * this.cols + x1];
      const c = arr[y1 * this.cols + x0];
      const d = arr[y1 * this.cols + x1];
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    };

    let dx = bil(this.dirX);
    let dy = bil(this.dirY);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    return {
      edge: clamp01(bil(this.edge)),
      dirX: dx,
      dirY: dy,
      interest: clamp01(bil(this.interest)),
    };
  }

  nearestInterest(wx: number, wy: number): { x: number; y: number; s: number } | null {
    if (!this.interests.length) return null;
    let best = this.interests[0];
    let bestD = Infinity;
    for (const p of this.interests) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD < this.world.w * 0.35 ? best : null;
  }

  private analyze(img: HTMLImageElement) {
    const maxDim = 160;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(24, Math.floor(img.width * scale));
    const h = Math.max(24, Math.floor(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for image analysis");
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    }

    this.cols = w;
    this.rows = h;
    this.edge = new Float32Array(w * h);
    this.dirX = new Float32Array(w * h);
    this.dirY = new Float32Array(w * h);
    this.interest = new Float32Array(w * h);

    let maxE = 1e-6;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        // Sobel
        const gx =
          -gray[i - w - 1] +
          gray[i - w + 1] -
          2 * gray[i - 1] +
          2 * gray[i + 1] -
          gray[i + w - 1] +
          gray[i + w + 1];
        const gy =
          -gray[i - w - 1] -
          2 * gray[i - w] -
          gray[i - w + 1] +
          gray[i + w - 1] +
          2 * gray[i + w] +
          gray[i + w + 1];
        const mag = Math.hypot(gx, gy);
        this.edge[i] = mag;
        if (mag > maxE) maxE = mag;
        // Tangent perpendicular to gradient = follow contour
        const gl = Math.hypot(gx, gy) || 1;
        this.dirX[i] = -gy / gl;
        this.dirY[i] = gx / gl;
      }
    }

    for (let i = 0; i < this.edge.length; i++) this.edge[i] /= maxE;

    // High-contrast interest: local edge peaks
    this.interests = [];
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const i = y * w + x;
        const e = this.edge[i];
        if (e < 0.35) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (this.edge[(y + dy) * w + (x + dx)] > e) {
              peak = false;
              break;
            }
          }
        }
        if (!peak) continue;
        this.interest[i] = e;
        const wx = this.world.x + (x / (w - 1)) * this.world.w;
        const wy = this.world.y + (y / (h - 1)) * this.world.h;
        this.interests.push({ x: wx, y: wy, s: e });
      }
    }

    this.interests.sort((a, b) => b.s - a.s);
    if (this.interests.length > 48) this.interests.length = 48;
    this.rebuildOverlay();
  }

  private rebuildOverlay() {
    this.overlay = [];
    if (!this.active || this.cols < 2) return;
    const step = 4;
    for (let y = 2; y < this.rows - 2; y += step) {
      for (let x = 2; x < this.cols - 2; x += step) {
        const i = y * this.cols + x;
        const e = this.edge[i];
        if (e < 0.28) continue;
        const wx = this.world.x + (x / (this.cols - 1)) * this.world.w;
        const wy = this.world.y + (y / (this.rows - 1)) * this.world.h;
        const len = 4 + e * 10;
        const dx = this.dirX[i] * len;
        const dy = this.dirY[i] * len;
        this.overlay.push({
          x0: wx - dx,
          y0: wy - dy,
          x1: wx + dx,
          y1: wy + dy,
          a: 0.12 + e * 0.35,
        });
      }
    }
    if (this.overlay.length > 900) this.overlay.length = 900;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
