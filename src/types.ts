/** Raw acoustic features from audio analysis. Phase 2+. */
export interface AcousticMeasurement {
  rms: number | null;
  peak: number | null;
  fundamentalFrequency: number | null;
  spectralCentroid: number | null;
  spectralBandwidth: number | null;
  spectralRolloff: number | null;
  zeroCrossingRate: number | null;
  harmonicity: number | null;
  onset: number | null;
  duration: number | null;
}

export type AcousticEventType =
  | "IMPACT"
  | "SUSTAIN"
  | "TRANSIENT"
  | "SILENCE"
  | "NOISE"
  | "PULSE"
  | "UNKNOWN";

export interface AcousticEvent {
  type: AcousticEventType;
  intensity: number;
  confidence: number;
  timestamp: number;
  measurements: AcousticMeasurement;
  /** Interpretable cues used for classification (not raw audio). */
  characteristics: {
    energy: number;
    onset: number;
    noisiness: number;
    harmonicity: number;
  };
}

export type StructuralAction =
  | "CREATE_NODE"
  | "GROW_EDGE"
  | "BRANCH"
  | "DECAY"
  | "IDLE";

export interface StructuralEvent {
  action: StructuralAction;
  energy: number;
  direction: number;
  branchProbability: number;
  lifetime: number;
}

export type ElementKind = "root" | "square" | "junction" | "marker" | "module";

export interface StructuralElement {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  size: number;
  w?: number;
  h?: number;
  label?: string;
  /** Marker index shown inside diamond (structural id, not acoustic). */
  index?: number;
  /** Structural placeholders for module callouts (not acoustic). */
  fit?: number;
  energy?: number;
  lines?: string[];
  accent?: boolean;
  /** Seed / immortal nodes — decay must not remove. */
  protected?: boolean;
  /** Continuous trunk path driven by sustained sound. */
  spine?: boolean;
  /** Seconds budget before decay can remove (root omitted). */
  lifetime?: number;
  age?: number;
}

export type ConnectionStyle = "straight" | "ortho" | "curve";

export interface Connection {
  id: string;
  from: string;
  to: string;
  style: ConnectionStyle;
  bias?: number;
  signal?: boolean;
  spine?: boolean;
}

export interface StructureScene {
  elements: StructuralElement[];
  connections: Connection[];
  /** Faint decorative fragments (structural only). */
  ghosts: Array<{ x: number; y: number; s: number }>;
}

export interface StructureCounts {
  nodes: number;
  edges: number;
  branches: number;
  modules: number;
  markers: number;
  growth: number;
  decay: number;
  stability: number;
  density: number;
  balance: number;
}

export function countStructure(
  scene: StructureScene,
  meters?: { growth: number; decay: number }
): StructureCounts {
  let modules = 0;
  let markers = 0;
  let junctions = 0;
  let points = 0;
  let energySum = 0;
  for (const e of scene.elements) {
    energySum += e.energy ?? 0.5;
    if (e.kind === "module") modules += 1;
    else if (e.kind === "marker") markers += 1;
    else if (e.kind === "junction") junctions += 1;
    else points += 1;
  }
  const nodes = points + junctions + markers + modules;
  const edges = scene.connections.length;
  const branches = scene.connections.filter((c) => c.signal).length;
  const n = Math.max(nodes, 1);
  const growth =
    meters?.growth ?? Number((energySum / n).toFixed(2));
  const decay = meters?.decay ?? 0;
  return {
    nodes,
    edges,
    branches,
    modules,
    markers,
    growth: Number(growth.toFixed(2)),
    decay: Number(decay.toFixed(2)),
    stability: Number(
      (1 - Math.min(branches / 80, 0.35) - decay * 0.2).toFixed(2)
    ),
    density: Number(Math.min(nodes / 120, 1).toFixed(2)),
    balance: Number((0.5 + (0.5 - Math.abs(0.5 - growth)) * 0.2).toFixed(2)),
  };
}
