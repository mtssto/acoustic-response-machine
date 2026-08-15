import type {
  AcousticEvent,
  AcousticEventType,
  StructuralAction,
  StructuralEvent,
} from "../types";

/** Compact stored event — explainable features only (no ML embeddings). */
export interface MemoryTrace {
  id: string;
  type: AcousticEventType;
  energy: number;
  onset: number;
  noisiness: number;
  harmonicity: number;
  /** Spectral centroid normalized 0–1 (artistic scale). */
  centroidN: number;
  action: StructuralAction;
  branchProbability: number;
  uses: number;
  lastSeen: number;
}

export interface MemoryMatch {
  trace: MemoryTrace | null;
  similarity: number;
  influence: number;
}

export interface MemoryBias {
  /** 0–1 how much recalled behavior should steer growth. */
  influence: number;
  preferredAction: StructuralAction | null;
  branchBoost: number;
  lengthScale: number;
  matchId: string | null;
  similarity: number;
}

/**
 * Phase 6 — explainable similarity memory.
 * Same acoustic pattern → related structural bias (not identical clone).
 */
export class MemoryBank {
  traces: MemoryTrace[] = [];
  lastMatch: MemoryMatch = { trace: null, similarity: 0, influence: 0 };
  private seq = 0x07a0;

  reset() {
    this.traces = [];
    this.seq = 0x07a0;
    this.lastMatch = { trace: null, similarity: 0, influence: 0 };
  }

  /** Compare current event to bank; return growth bias. */
  recall(ev: AcousticEvent): MemoryBias {
    if (ev.type === "SILENCE" || this.traces.length === 0) {
      this.lastMatch = { trace: null, similarity: 0, influence: 0 };
      return {
        influence: 0,
        preferredAction: null,
        branchBoost: 0,
        lengthScale: 1,
        matchId: null,
        similarity: 0,
      };
    }

    const probe = featuresFromEvent(ev);
    let best: MemoryTrace | null = null;
    let bestSim = 0;

    for (const t of this.traces) {
      const sim = similarity(probe, t);
      if (sim > bestSim) {
        bestSim = sim;
        best = t;
      }
    }

    const influence = bestSim >= 0.62 ? clamp01((bestSim - 0.55) / 0.35) : 0;
    this.lastMatch = {
      trace: best,
      similarity: Number(bestSim.toFixed(3)),
      influence: Number(influence.toFixed(3)),
    };

    if (!best || influence <= 0) {
      return {
        influence: 0,
        preferredAction: null,
        branchBoost: 0,
        lengthScale: 1,
        matchId: null,
        similarity: bestSim,
      };
    }

    best.uses += 1;
    best.lastSeen = ev.timestamp;

    return {
      influence,
      preferredAction: best.action === "IDLE" || best.action === "DECAY" ? null : best.action,
      branchBoost: best.branchProbability * influence * 0.45,
      lengthScale: 1 + influence * 0.35,
      matchId: best.id,
      similarity: bestSim,
    };
  }

  /** Store compact trace after a real structural action. */
  remember(ev: AcousticEvent, st: StructuralEvent) {
    if (ev.type === "SILENCE" || ev.type === "UNKNOWN") return;
    if (st.action === "IDLE" || st.action === "DECAY") return;

    const probe = featuresFromEvent(ev);
    // Merge into nearest similar trace instead of exploding the bank
    let nearest: MemoryTrace | null = null;
    let nearestSim = 0;
    for (const t of this.traces) {
      const sim = similarity(probe, t);
      if (sim > nearestSim) {
        nearestSim = sim;
        nearest = t;
      }
    }

    if (nearest && nearestSim >= 0.78) {
      nearest.energy = lerp(nearest.energy, probe.energy, 0.25);
      nearest.onset = lerp(nearest.onset, probe.onset, 0.25);
      nearest.noisiness = lerp(nearest.noisiness, probe.noisiness, 0.25);
      nearest.harmonicity = lerp(nearest.harmonicity, probe.harmonicity, 0.25);
      nearest.centroidN = lerp(nearest.centroidN, probe.centroidN, 0.25);
      nearest.action = st.action;
      nearest.branchProbability = lerp(
        nearest.branchProbability,
        st.branchProbability,
        0.3
      );
      nearest.uses += 1;
      nearest.lastSeen = ev.timestamp;
      nearest.type = ev.type;
      return;
    }

    this.seq += 1;
    this.traces.unshift({
      id: `#${this.seq.toString(16).toUpperCase()}`,
      type: ev.type,
      energy: probe.energy,
      onset: probe.onset,
      noisiness: probe.noisiness,
      harmonicity: probe.harmonicity,
      centroidN: probe.centroidN,
      action: st.action,
      branchProbability: st.branchProbability,
      uses: 1,
      lastSeen: ev.timestamp,
    });

    if (this.traces.length > 12) this.traces.length = 12;
  }

  list(): MemoryTrace[] {
    return this.traces.slice(0, 6);
  }
}

interface Feat {
  type: AcousticEventType;
  energy: number;
  onset: number;
  noisiness: number;
  harmonicity: number;
  centroidN: number;
}

function featuresFromEvent(ev: AcousticEvent): Feat {
  const c = ev.measurements.spectralCentroid;
  return {
    type: ev.type,
    energy: ev.characteristics.energy,
    onset: ev.characteristics.onset,
    noisiness: ev.characteristics.noisiness,
    harmonicity: ev.characteristics.harmonicity,
    centroidN: clamp01(((c ?? 800) - 200) / 4500),
  };
}

/** Explainable weighted similarity in [0,1]. */
function similarity(a: Feat, b: MemoryTrace): number {
  const typeBoost = a.type === b.type ? 0.28 : a.type === "UNKNOWN" ? 0.05 : 0;
  const dEnergy = 1 - Math.abs(a.energy - b.energy);
  const dOnset = 1 - Math.abs(a.onset - b.onset);
  const dNoise = 1 - Math.abs(a.noisiness - b.noisiness);
  const dHarm = 1 - Math.abs(a.harmonicity - b.harmonicity);
  const dCent = 1 - Math.abs(a.centroidN - b.centroidN);
  const feat =
    dEnergy * 0.28 +
    dOnset * 0.26 +
    dNoise * 0.14 +
    dHarm * 0.14 +
    dCent * 0.18;
  return clamp01(typeBoost + feat * (1 - 0.28));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
