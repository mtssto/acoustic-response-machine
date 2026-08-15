import type { AcousticEvent, StructuralEvent, StructureScene } from "../types";
import type { MachineVitals } from "../machine/state";

/**
 * Structure → synth parameters (artistic mapping, not acoustic inverse).
 * Call-response bursts with cooldown to limit mic feedback.
 */
export interface ResponseParams {
  frequency: number;
  duration: number;
  harmonicity: number;
  texture: number;
  pan: number;
  amplitude: number;
  attack: number;
  release: number;
  partials: number;
}

export class MachineResponse {
  enabled = true;
  speaking = false;
  lastParams: ResponseParams | null = null;
  private ctx: AudioContext | null = null;
  private cooldown = 0;
  private master: GainNode | null = null;

  reset() {
    this.cooldown = 0;
    this.speaking = false;
    this.lastParams = null;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.speaking = false;
  }

  tick(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /**
   * Decide whether to speak. Returns true if a response was scheduled.
   */
  maybeRespond(
    ev: AcousticEvent | null,
    st: StructuralEvent | null,
    scene: StructureScene,
    vitals: MachineVitals
  ): boolean {
    if (!this.enabled || this.cooldown > 0 || this.speaking) return false;
    if (!ev || ev.type === "SILENCE") return false;

    const trigger =
      ev.type === "IMPACT" ||
      ev.type === "TRANSIENT" ||
      (st?.action === "BRANCH" && ev.characteristics.onset > 0.25) ||
      (st?.action === "CREATE_NODE" && ev.characteristics.energy > 0.35) ||
      (vitals.memoryInfluence > 0.55 && ev.characteristics.energy > 0.2);

    if (!trigger) return false;

    const params = this.derive(scene, vitals, st, ev);
    this.lastParams = params;
    this.play(params);
    this.cooldown = 1.15 + (1 - vitals.energy) * 0.5;
    return true;
  }

  derive(
    scene: StructureScene,
    vitals: MachineVitals,
    st: StructuralEvent | null,
    ev: AcousticEvent
  ): ResponseParams {
    const nodes = Math.max(1, scene.elements.length);
    const junctions = scene.elements.filter((e) => e.kind === "junction").length;
    const markers = scene.elements.filter((e) => e.kind === "marker").length;

    // Frequency from density + action energy (not mic F0 copy)
    const base =
      90 +
      vitals.density * 180 +
      (junctions / nodes) * 120 +
      (st?.energy ?? ev.characteristics.energy) * 160;
    const freq = clamp(base, 70, 520);

    const harmonicity = clamp(
      0.25 + vitals.stability * 0.45 + (1 - ev.characteristics.noisiness) * 0.3,
      0.1,
      0.95
    );
    const texture = clamp(
      ev.characteristics.noisiness * 0.5 + (1 - vitals.stability) * 0.35,
      0,
      0.7
    );
    const pan2 = clamp(Math.sin(st?.direction ?? 0) * 0.55, -0.65, 0.65);

    const duration =
      0.12 +
      vitals.growth * 0.18 +
      (st?.action === "BRANCH" ? 0.12 : 0) +
      markers * 0.002;
    const amplitude = clamp(0.035 + vitals.energy * 0.045, 0.03, 0.09);
    const partials = 1 + Math.floor(harmonicity * 4);

    return {
      frequency: Number(freq.toFixed(2)),
      duration: Number(clamp(duration, 0.1, 0.45).toFixed(3)),
      harmonicity: Number(harmonicity.toFixed(3)),
      texture: Number(texture.toFixed(3)),
      pan: Number(pan2.toFixed(3)),
      amplitude: Number(amplitude.toFixed(3)),
      attack: 0.008 + (1 - ev.characteristics.onset) * 0.04,
      release: 0.08 + vitals.stability * 0.12,
      partials,
    };
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  play(p: ResponseParams) {
    const ctx = this.ensureCtx();
    const t0 = ctx.currentTime;
    const master = this.master!;
    this.speaking = true;

    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    pan.connect(master);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(p.amplitude, t0 + p.attack);
    env.gain.exponentialRampToValueAtTime(
      0.0008,
      t0 + p.duration + p.release
    );
    env.connect(pan);

    // Harmonic partials
    for (let i = 1; i <= p.partials; i++) {
      const osc = ctx.createOscillator();
      osc.type = p.harmonicity > 0.55 ? "sine" : i === 1 ? "triangle" : "sine";
      osc.frequency.value = p.frequency * i * (1 + (i - 1) * 0.002);
      const g = ctx.createGain();
      g.gain.value = (1 / i) * p.harmonicity;
      osc.connect(g);
      g.connect(env);
      osc.start(t0);
      osc.stop(t0 + p.duration + p.release + 0.02);
    }

    // Noise texture layer
    if (p.texture > 0.05) {
      const len = Math.floor(ctx.sampleRate * (p.duration + p.release));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.value = p.texture * 0.12;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = p.frequency * 2;
      bp.Q.value = 2;
      src.connect(bp);
      bp.connect(ng);
      ng.connect(env);
      src.start(t0);
      src.stop(t0 + p.duration + p.release);
    }

    window.setTimeout(() => {
      this.speaking = false;
    }, (p.duration + p.release) * 1000 + 30);
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
