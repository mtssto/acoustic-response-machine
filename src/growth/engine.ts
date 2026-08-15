import type { ImageEnvironment } from "../environment/imageMap";
import type {
  AcousticEvent,
  Connection,
  StructuralAction,
  StructuralElement,
  StructuralEvent,
  StructureScene,
} from "../types";

export interface GrowthBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Active growth frontier endpoint. */
interface Endpoint {
  id: string;
  x: number;
  y: number;
  /** Previous segment direction (radians). */
  angle: number;
  age: number;
  energy: number;
}

export interface GrowthDebug {
  endpointId: string;
  angleDeg: number;
  length: number;
  branchProbability: number;
  selectedEndpoint: string;
  event: string;
  energy: number;
  centroid: number | null;
  onset: number;
  frontier: number;
}

/**
 * Event-driven organic growth.
 * Artistic mappings (not physical laws):
 * - ENERGY/RMS → length, presence, branch chance
 * - CENTROID → angular variation / turn rate
 * - ONSET → strongest trigger for new segments/branches
 * - HARMONICITY → coherence (less turn when high)
 * - NOISE/ZCR → irregularity
 */
export class GrowthEngine {
  lastStructural: StructuralEvent = {
    action: "IDLE",
    energy: 0,
    direction: 0,
    branchProbability: 0,
    lifetime: 0,
  };

  debug: GrowthDebug = {
    endpointId: "—",
    angleDeg: 0,
    length: 0,
    branchProbability: 0,
    selectedEndpoint: "—",
    event: "NONE",
    energy: 0,
    centroid: null,
    onset: 0,
    frontier: 0,
  };

  private frontier: Endpoint[] = [];
  private seq = 0;
  private markerSeq = 10;
  private cooldown = 0;
  private sustainBudget = 0;
  private decayMeter = 0;
  private growthMeter = 0;
  private tick = 0;
  private lastFocus = { x: 0, y: 0 };
  private env: ImageEnvironment | null = null;
  bounds: GrowthBounds = { left: 0, right: 1, top: 0, bottom: 1 };

  setEnvironment(env: ImageEnvironment | null) {
    this.env = env;
  }

  reset(scene: StructureScene, bounds: GrowthBounds) {
    this.bounds = { ...bounds };
    this.seq = 0;
    this.markerSeq = 10;
    this.cooldown = 0;
    this.sustainBudget = 0;
    this.decayMeter = 0;
    this.growthMeter = 0;
    this.tick = 0;
    this.frontier = [];

    for (const e of scene.elements) {
      const n = parseInt(e.id.replace(/\D/g, ""), 10);
      if (!Number.isNaN(n) && n > this.seq) this.seq = n;
    }

    const root = scene.elements.find((e) => e.kind === "root");
    if (root) {
      // Several seeds at different initial angles — no preferred UP axis
      const seeds = [-2.4, -1.2, 0.2, 1.5, 2.8];
      for (let i = 0; i < seeds.length; i++) {
        this.frontier.push({
          id: root.id,
          x: root.x,
          y: root.y,
          angle: seeds[i],
          age: 0,
          energy: 0.5,
        });
      }
      this.lastFocus = { x: root.x, y: root.y };
    }
    this.debug.frontier = this.frontier.length;
  }

  getMeters() {
    return {
      growth: Number(Math.min(1, this.growthMeter).toFixed(2)),
      decay: Number(Math.min(1, this.decayMeter).toFixed(2)),
    };
  }

  getFocusPoint(): { x: number; y: number } {
    return this.lastFocus;
  }

  step(
    scene: StructureScene,
    ev: AcousticEvent | null,
    dt: number,
    memory?: {
      influence: number;
      preferredAction: StructuralAction | null;
      branchBoost: number;
      lengthScale: number;
    } | null
  ): StructuralEvent {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const ep of this.frontier) ep.age += dt;

    if (!ev || ev.type === "SILENCE") {
      this.sustainBudget = Math.max(0, this.sustainBudget - dt * 0.4);
      this.debug.event = ev?.type ?? "NONE";
      this.debug.energy = ev?.characteristics.energy ?? 0;
      this.debug.onset = ev?.characteristics.onset ?? 0;
      this.debug.centroid = ev?.measurements.spectralCentroid ?? null;
      this.debug.frontier = this.frontier.length;
      if (ev?.type === "SILENCE" && this.cooldown <= 0) {
        this.softDecay(scene);
        this.cooldown = 1.4;
        this.lastStructural = {
          action: "DECAY",
          energy: 0,
          direction: 0,
          branchProbability: 0,
          lifetime: 0,
        };
        return this.lastStructural;
      }
      this.lastStructural = {
        action: "IDLE",
        energy: 0,
        direction: 0,
        branchProbability: 0,
        lifetime: 0,
      };
      return this.lastStructural;
    }

    const energy = ev.characteristics.energy;
    const onset = ev.characteristics.onset;
    const harm = ev.characteristics.harmonicity;
    const noise = ev.characteristics.noisiness;
    const centroid = ev.measurements.spectralCentroid;
    const centroidN = clamp01(((centroid ?? 800) - 200) / 4500);

    // Event gate — not every frame
    let fire = false;
    let strength = energy;

    if (ev.type === "IMPACT" || (onset > 0.38 && energy > 0.12)) {
      fire = this.cooldown <= 0;
      strength = Math.max(energy, onset);
    } else if (ev.type === "TRANSIENT") {
      fire = this.cooldown <= 0 && onset > 0.2;
      strength = Math.max(energy, onset * 0.9);
    } else if (ev.type === "NOISE") {
      this.sustainBudget += energy * dt * 1.2;
      fire = this.cooldown <= 0 && this.sustainBudget > 0.22;
      if (fire) this.sustainBudget -= 0.22;
      strength = energy;
    } else if (ev.type === "SUSTAIN" || ev.type === "UNKNOWN") {
      // Accumulate; weak sound → rare small extensions
      const rate = 0.35 + energy * 1.4;
      this.sustainBudget += energy * dt * rate;
      const cost = 0.28 - energy * 0.1;
      fire = this.cooldown <= 0 && this.sustainBudget >= cost;
      if (fire) this.sustainBudget -= cost;
      strength = energy;
    }

    this.debug.event = ev.type;
    this.debug.energy = energy;
    this.debug.onset = onset;
    this.debug.centroid = centroid ?? null;
    this.debug.frontier = this.frontier.length;

    if (!fire || this.frontier.length === 0) {
      this.lastStructural = {
        action: "IDLE",
        energy,
        direction: 0,
        branchProbability: 0,
        lifetime: 0,
      };
      return this.lastStructural;
    }

    if (scene.elements.length >= 360) {
      this.lastStructural = {
        action: "IDLE",
        energy,
        direction: 0,
        branchProbability: 0,
        lifetime: 0,
      };
      return this.lastStructural;
    }

    const mem = memory ?? null;
    const memInf = mem?.influence ?? 0;

    const branchP = clamp01(
      0.04 +
        energy * 0.28 +
        onset * 0.38 +
        centroidN * 0.14 +
        noise * 0.12 -
        harm * 0.08 +
        (rnd(this.tick) - 0.5) * 0.1 +
        (mem?.branchBoost ?? 0)
    );

    const ep = this.pickEndpoint(strength, onset);
    const turnMax =
      0.35 +
      centroidN * 1.1 +
      (1 - harm) * 0.55 +
      noise * 0.45 +
      (ev.type === "IMPACT" || ev.type === "TRANSIENT" ? 0.5 : 0) -
      memInf * 0.15; // remembered patterns → slightly more coherent turns
    const turn = (rnd(this.tick + 3) - 0.5) * 2 * Math.max(0.2, turnMax);
    let angle = ep.angle + turn;

    // Phase 7: bias toward image edge tangents / interest points
    if (this.env?.active) {
      const sample = this.env.sample(ep.x, ep.y);
      if (sample && sample.edge > 0.18) {
        let edgeAng = Math.atan2(sample.dirY, sample.dirX);
        // Pick tangent orientation closer to current heading
        const alt = edgeAng + Math.PI;
        if (angleDiff(angle, alt) < angleDiff(angle, edgeAng)) edgeAng = alt;
        const blend = 0.3 + sample.edge * 0.45;
        angle = lerpAngle(angle, edgeAng, blend);
      }
      const poi = this.env.nearestInterest(ep.x, ep.y);
      if (poi && sample && sample.interest > 0.2) {
        const toPoi = Math.atan2(poi.y - ep.y, poi.x - ep.x);
        angle = lerpAngle(angle, toPoi, 0.15 + sample.interest * 0.2);
      }
    }

    let length =
      (10 +
        strength * 48 +
        onset * 22 +
        (1 - centroidN) * 8 +
        rnd(this.tick + 5) * 10) *
      (mem?.lengthScale ?? 1);

    if (this.env?.active) {
      const s2 = this.env.sample(ep.x, ep.y);
      if (s2) {
        // Strong edges → slightly longer traces along structure
        length *= 0.85 + s2.edge * 0.45;
      }
    }

    let action: StructuralAction =
      (ev.type === "IMPACT" || ev.type === "TRANSIENT") && rnd(this.tick + 7) < branchP
        ? "BRANCH"
        : rnd(this.tick + 8) < branchP
          ? "BRANCH"
          : strength > 0.45
            ? "CREATE_NODE"
            : "GROW_EDGE";

    // Recalled behavior biases action when similarity is strong
    if (mem?.preferredAction && memInf > 0.45 && rnd(this.tick + 9) < memInf) {
      action = mem.preferredAction;
    }

    this.lastStructural = {
      action,
      energy: strength,
      direction: angle,
      branchProbability: branchP,
      lifetime: 10 + strength * 16,
    };

    this.debug.selectedEndpoint = ep.id;
    this.debug.endpointId = ep.id;
    this.debug.angleDeg = Number(((angle * 180) / Math.PI).toFixed(1));
    this.debug.length = Number(length.toFixed(1));
    this.debug.branchProbability = Number(branchP.toFixed(3));

    this.extend(scene, ep, angle, length, strength, branchP, action);
    this.tick += 1;
    this.growthMeter = Math.min(1, this.growthMeter + 0.04 * strength);
    this.decayMeter = Math.max(0, this.decayMeter - 0.03);
    this.cooldown =
      ev.type === "IMPACT" || ev.type === "TRANSIENT"
        ? 0.1
        : 0.16 + (1 - strength) * 0.12;

    return this.lastStructural;
  }

  private pickEndpoint(strength: number, onset: number): Endpoint {
    let best = this.frontier[0];
    let bestScore = -1e9;
    for (let i = 0; i < this.frontier.length; i++) {
      const ep = this.frontier[i];
      let envBoost = 0;
      if (this.env?.active) {
        const s = this.env.sample(ep.x, ep.y);
        if (s) envBoost = s.edge * 0.7 + s.interest * 0.5;
      }
      const score =
        ep.energy * 0.9 +
        strength * 0.3 +
        onset * 0.2 -
        ep.age * 0.08 +
        envBoost +
        rnd(this.tick * 17 + i) * (0.55 + onset * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = ep;
      }
    }
    return best;
  }

  private extend(
    scene: StructureScene,
    ep: Endpoint,
    angle: number,
    length: number,
    strength: number,
    branchP: number,
    action: StructuralAction
  ) {
    const x = ep.x + Math.cos(angle) * length;
    const y = ep.y + Math.sin(angle) * length;
    this.expand(x, y);

    const el = this.makeNode(x, y, strength, false);
    scene.elements.push(el);
    scene.connections.push({
      id: `E-${scene.connections.length + 1}`,
      from: ep.id,
      to: el.id,
      style: rnd(this.tick + 11) > 0.72 ? "curve" : "straight",
      signal: strength > 0.4 || action === "CREATE_NODE",
    });

    // Update frontier: replace chosen endpoint with new tip
    const idx = this.frontier.indexOf(ep);
    const neu: Endpoint = {
      id: el.id,
      x,
      y,
      angle,
      age: 0,
      energy: strength,
    };
    if (idx >= 0) this.frontier[idx] = neu;
    else this.frontier.push(neu);
    this.lastFocus = { x, y };

    // Irregular branch (not symmetric Y-split)
    if (action === "BRANCH" || rnd(this.tick + 13) < branchP) {
      const side = rnd(this.tick + 14) > 0.5 ? 1 : -1;
      const bang =
        angle +
        side * (0.7 + rnd(this.tick + 15) * 1.1) +
        (rnd(this.tick + 16) - 0.5) * 0.4;
      const blen = length * (0.55 + rnd(this.tick + 17) * 0.45);
      const bx = ep.x + Math.cos(bang) * blen;
      const by = ep.y + Math.sin(bang) * blen;
      this.expand(bx, by);
      const br = this.makeNode(bx, by, strength * 0.85, false);
      scene.elements.push(br);
      scene.connections.push({
        id: `E-${scene.connections.length + 1}`,
        from: ep.id,
        to: br.id,
        style: "straight",
        signal: true,
      });
      this.frontier.push({
        id: br.id,
        x: bx,
        y: by,
        angle: bang,
        age: 0,
        energy: strength * 0.85,
      });
    }

    // Rare network loop to a nearby existing node
    if (rnd(this.tick + 19) < 0.07) {
      this.tryLoop(scene, el);
    }

    // Occasional module
    if (rnd(this.tick + 21) < 0.09) {
      const side = rnd(this.tick + 22) > 0.5 ? 1 : -1;
      const mx = x + side * (40 + rnd(this.tick + 23) * 24);
      const my = y + (rnd(this.tick + 24) - 0.5) * 30;
      this.expand(mx, my);
      const mid = `M-${el.id}`;
      scene.elements.push({
        id: mid,
        kind: "module",
        x: mx,
        y: my,
        size: 0,
        w: 72,
        h: 44,
        label: el.id,
        fit: Math.round(80 + rnd(this.tick + 25) * 280),
        energy: Number(strength.toFixed(2)),
        lifetime: 12 + strength * 10,
        age: 0,
      });
      scene.connections.push({
        id: `E-${scene.connections.length + 1}`,
        from: el.id,
        to: mid,
        style: "straight",
        signal: false,
      });
    }

    if (this.frontier.length > 18) {
      this.frontier.sort((a, b) => b.energy - a.energy - a.age * 0.05);
      this.frontier.length = 18;
    }
  }

  private tryLoop(scene: StructureScene, el: StructuralElement) {
    let best: StructuralElement | null = null;
    let bestD = 90;
    for (const o of scene.elements) {
      if (o.id === el.id || o.kind === "module" || o.kind === "root") continue;
      const d = Math.hypot(o.x - el.x, o.y - el.y);
      if (d > 28 && d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    const exists = scene.connections.some(
      (c) =>
        (c.from === el.id && c.to === best!.id) ||
        (c.from === best!.id && c.to === el.id)
    );
    if (exists) return;
    scene.connections.push({
      id: `E-${scene.connections.length + 1}`,
      from: el.id,
      to: best.id,
      style: "curve",
      signal: false,
    });
  }

  private makeNode(
    x: number,
    y: number,
    strength: number,
    protect: boolean
  ): StructuralElement {
    const r = rnd(this.tick + this.seq);
    if (r > 0.78) {
      this.markerSeq += 1;
      return {
        id: this.nextId(),
        kind: "marker",
        x,
        y,
        size: 6.5 + strength,
        index: this.markerSeq,
        energy: strength,
        lifetime: protect ? undefined : 12 + strength * 14,
        age: 0,
        protected: protect,
      };
    }
    if (r > 0.42) {
      return {
        id: this.nextId(),
        kind: "junction",
        x,
        y,
        size: 4 + strength * 2.5,
        energy: strength,
        lifetime: protect ? undefined : 12 + strength * 14,
        age: 0,
        protected: protect,
      };
    }
    return {
      id: this.nextId(),
      kind: "square",
      x,
      y,
      size: 2 + strength * 2.2,
      energy: strength,
      lifetime: protect ? undefined : 12 + strength * 14,
      age: 0,
      protected: protect,
    };
  }

  private softDecay(scene: StructureScene) {
    const MIN = 1;
    for (const e of scene.elements) {
      if (e.kind === "root" || e.protected) continue;
      if (e.lifetime != null) e.age = (e.age ?? 0) + 0.2;
    }
    const doomed = scene.elements
      .filter((e) => e.kind !== "root" && !e.protected && e.lifetime != null)
      .filter((e) => (e.age ?? 0) > (e.lifetime ?? 12))
      .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    if (!doomed.length || scene.elements.length <= MIN) {
      this.decayMeter = Math.min(1, this.decayMeter + 0.02);
      return;
    }
    const v = doomed[0];
    scene.elements = scene.elements.filter((e) => e.id !== v.id);
    scene.connections = scene.connections.filter(
      (c) => c.from !== v.id && c.to !== v.id
    );
    this.frontier = this.frontier.filter((f) => f.id !== v.id);
    scene.ghosts.push({ x: v.x, y: v.y, s: 2 });
    if (scene.ghosts.length > 40) scene.ghosts.shift();
    this.decayMeter = Math.min(1, this.decayMeter + 0.04);
    if (this.frontier.length === 0) {
      const root = scene.elements.find((e) => e.kind === "root");
      if (root) {
        this.frontier.push({
          id: root.id,
          x: root.x,
          y: root.y,
          angle: rnd(this.tick) * Math.PI * 2 - Math.PI,
          age: 0,
          energy: 0.4,
        });
      }
    }
  }

  private expand(x: number, y: number) {
    const pad = 100;
    this.bounds.left = Math.min(this.bounds.left, x - pad);
    this.bounds.right = Math.max(this.bounds.right, x + pad);
    this.bounds.top = Math.min(this.bounds.top, y - pad);
    this.bounds.bottom = Math.max(this.bounds.bottom, y + pad);
  }

  private nextId(): string {
    this.seq += 1;
    return `N-${String(this.seq).padStart(2, "0")}`;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Deterministic pseudo-random in [0,1) from integer seed — repeatable behavior, non-identical detail. */
function rnd(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Origin only — no trunk arms. */
export function createGrowthSeed(
  width: number,
  height: number
): { scene: StructureScene; bounds: GrowthBounds } {
  const cx = width * 0.55;
  const cy = height * 0.55;
  return {
    scene: {
      elements: [
        {
          id: "N-00",
          kind: "root",
          x: cx,
          y: cy,
          size: 6,
          label: "N-00 ROOT",
          energy: 1,
          accent: true,
          protected: true,
        },
      ],
      connections: [],
      ghosts: [],
    },
    bounds: {
      left: cx - 400,
      right: cx + 400,
      top: cy - 400,
      bottom: cy + 400,
    },
  };
}
