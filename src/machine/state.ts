import type {
  AcousticEvent,
  AcousticEventType,
  StructuralAction,
  StructuralEvent,
  StructureCounts,
} from "../types";

/**
 * Continuous machine vitals (Phase 5).
 * Derived from acoustic + structural behavior — not random.
 * memoryInfluence is a lightweight recurrence signal (full memory = Phase 6).
 */
export interface MachineVitals {
  energy: number;
  stability: number;
  growth: number;
  density: number;
  memoryInfluence: number;
  patternId: string;
  currentEvent: AcousticEventType | "NONE";
  currentAction: StructuralAction;
  structuralNodes: number;
  structuralEdges: number;
  focus: "LOW" | "MID" | "HIGH";
  behavior: string;
  mode: string;
}

export class MachineState {
  vitals: MachineVitals = {
    energy: 0,
    stability: 1,
    growth: 0,
    density: 0,
    memoryInfluence: 0,
    patternId: "—",
    currentEvent: "NONE",
    currentAction: "IDLE",
    structuralNodes: 0,
    structuralEdges: 0,
    focus: "LOW",
    behavior: "STANDBY",
    mode: "MACHINE",
  };

  private energy = 0;
  private stability = 1;
  private growth = 0;
  private density = 0;
  private memoryInfluence = 0;
  private lastType: AcousticEventType | "NONE" = "NONE";
  private typeStreak = 0;
  private recentTypes: AcousticEventType[] = [];

  reset() {
    this.energy = 0;
    this.stability = 1;
    this.growth = 0;
    this.density = 0;
    this.memoryInfluence = 0;
    this.lastType = "NONE";
    this.typeStreak = 0;
    this.recentTypes = [];
    this.vitals = {
      energy: 0,
      stability: 1,
      growth: 0,
      density: 0,
      memoryInfluence: 0,
      patternId: "—",
      currentEvent: "NONE",
      currentAction: "IDLE",
      structuralNodes: 0,
      structuralEdges: 0,
      focus: "LOW",
      behavior: "STANDBY",
      mode: "MACHINE",
    };
  }

  update(
    dt: number,
    ev: AcousticEvent | null,
    st: StructuralEvent | null,
    counts: StructureCounts,
    memoryInfluenceExternal?: number,
    patternIdExternal?: string | null
  ): MachineVitals {
    const targetEnergy = ev
      ? clamp01(
          ev.characteristics.energy * 0.7 +
            ev.intensity * 0.2 +
            (ev.characteristics.onset ?? 0) * 0.25
        )
      : 0;

    // Continuous smoothing — machine "holds" state between events
    const attack = ev && ev.type !== "SILENCE" ? 4.5 : 1.2;
    const release = ev?.type === "SILENCE" || !ev ? 0.7 : 1.5;
    const rate = targetEnergy >= this.energy ? attack : release;
    this.energy += (targetEnergy - this.energy) * Math.min(1, rate * dt);

    const growthTarget = clamp01(
      counts.growth * 0.55 +
        (st && st.action !== "IDLE" && st.action !== "DECAY" ? 0.35 : 0) +
        (st?.action === "BRANCH" ? 0.15 : 0)
    );
    this.growth += (growthTarget - this.growth) * Math.min(1, 2.2 * dt);

    const densityTarget = clamp01(counts.density);
    this.density += (densityTarget - this.density) * Math.min(1, 1.4 * dt);

    // Stability rises with quiet coherence, falls with noise/onset/decay
    let stabilityTarget = 0.55 + counts.stability * 0.35;
    if (ev?.type === "SILENCE") stabilityTarget += 0.15;
    if (ev?.type === "NOISE") stabilityTarget -= 0.25;
    if (ev && ev.characteristics.onset > 0.5) stabilityTarget -= 0.2;
    if (st?.action === "DECAY") stabilityTarget -= 0.15;
    if (ev && ev.characteristics.harmonicity > 0.55) stabilityTarget += 0.1;
    this.stability +=
      (clamp01(stabilityTarget) - this.stability) * Math.min(1, 1.8 * dt);

    // Phase 6: prefer real similarity influence when provided
    if (memoryInfluenceExternal != null) {
      this.memoryInfluence +=
        (clamp01(memoryInfluenceExternal) - this.memoryInfluence) *
        Math.min(1, 3 * dt);
    } else if (ev && ev.type !== "SILENCE") {
      if (ev.type === this.lastType) this.typeStreak += dt;
      else {
        this.typeStreak = dt;
        this.lastType = ev.type;
      }
      this.recentTypes.push(ev.type);
      if (this.recentTypes.length > 24) this.recentTypes.shift();
      const matches = this.recentTypes.filter((t) => t === ev.type).length;
      const memTarget = clamp01(
        matches / this.recentTypes.length + Math.min(this.typeStreak / 4, 0.35)
      );
      this.memoryInfluence +=
        (memTarget - this.memoryInfluence) * Math.min(1, 2 * dt);
    } else {
      this.typeStreak = 0;
      this.lastType = "NONE";
      this.memoryInfluence += (0 - this.memoryInfluence) * Math.min(1, 0.6 * dt);
    }

    const focus: MachineVitals["focus"] =
      this.energy > 0.62 ? "HIGH" : this.energy > 0.28 ? "MID" : "LOW";

    this.vitals = {
      energy: round3(this.energy),
      stability: round3(this.stability),
      growth: round3(this.growth),
      density: round3(this.density),
      memoryInfluence: round3(this.memoryInfluence),
      patternId: patternIdExternal && patternIdExternal.length ? patternIdExternal : "—",
      currentEvent: ev?.type ?? "NONE",
      currentAction: st?.action ?? "IDLE",
      structuralNodes: counts.nodes,
      structuralEdges: counts.edges,
      focus,
      behavior: behavior(ev, st, this.energy, this.stability),
      mode: patternIdExternal ? "LEARNING" : "MACHINE",
    };
    return this.vitals;
  }
}

function behavior(
  ev: AcousticEvent | null,
  st: StructuralEvent | null,
  energy: number,
  stability: number
): string {
  if (!ev || ev.type === "SILENCE") return stability > 0.7 ? "REST" : "IDLE";
  if (st?.action === "BRANCH") return "EXPLORATORY";
  if (st?.action === "CREATE_NODE" || st?.action === "GROW_EDGE")
    return energy > 0.55 ? "GENERATIVE" : "EXTEND";
  if (st?.action === "DECAY") return "RELEASE";
  if (ev.type === "IMPACT") return "STRIKE";
  if (ev.type === "NOISE") return "DIFFUSE";
  if (ev.type === "SUSTAIN") return "HOLD";
  return "LISTEN";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round3(v: number): number {
  return Number(v.toFixed(3));
}
