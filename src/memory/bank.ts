import { PatternLearner, type ClusterModel } from "../learning/cluster";
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
  centroidN: number;
  action: StructuralAction;
  branchProbability: number;
  uses: number;
  lastSeen: number;
  clusterId: string | null;
}

export interface MemoryMatch {
  trace: MemoryTrace | null;
  cluster: ClusterModel | null;
  similarity: number;
  influence: number;
}

export interface MemoryBias {
  influence: number;
  preferredAction: StructuralAction | null;
  branchBoost: number;
  lengthScale: number;
  matchId: string | null;
  clusterId: string | null;
  similarity: number;
}

/**
 * Phase 6 memory + Phase 8 learning:
 * traces for instance recall; clusters for family-level learned behavior.
 */
export class MemoryBank {
  traces: MemoryTrace[] = [];
  learner = new PatternLearner();
  lastMatch: MemoryMatch = {
    trace: null,
    cluster: null,
    similarity: 0,
    influence: 0,
  };
  private seq = 0x07a0;

  reset() {
    this.traces = [];
    this.learner.reset();
    this.seq = 0x07a0;
    this.lastMatch = {
      trace: null,
      cluster: null,
      similarity: 0,
      influence: 0,
    };
  }

  recall(ev: AcousticEvent): MemoryBias {
    if (ev.type === "SILENCE" || this.traces.length === 0) {
      this.lastMatch = {
        trace: null,
        cluster: null,
        similarity: 0,
        influence: 0,
      };
      return emptyBias();
    }

    const probe = featuresFromEvent(ev);
    const emb = this.learner.embed(probe);

    let best: MemoryTrace | null = null;
    let bestSim = 0;
    for (const t of this.traces) {
      const sim = similarity(probe, t);
      if (sim > bestSim) {
        bestSim = sim;
        best = t;
      }
    }

    const clusterHit = this.learner.bestCluster(emb);
    const clusterSim = clusterHit?.similarity ?? 0;
    const cluster = clusterHit && clusterSim >= 0.55 ? clusterHit.cluster : null;

    // Blend instance match + cluster prototype
    const instInf = bestSim >= 0.62 ? clamp01((bestSim - 0.55) / 0.35) : 0;
    const clusInf = cluster ? clamp01((clusterSim - 0.5) / 0.4) : 0;
    const influence = clamp01(Math.max(instInf, clusInf * 0.85) + clusInf * 0.15);

    this.lastMatch = {
      trace: best,
      cluster,
      similarity: Number(Math.max(bestSim, clusterSim).toFixed(3)),
      influence: Number(influence.toFixed(3)),
    };

    if (influence <= 0) {
      return {
        ...emptyBias(),
        similarity: Math.max(bestSim, clusterSim),
      };
    }

    if (best) {
      best.uses += 1;
      best.lastSeen = ev.timestamp;
    }

    const clusterAction = cluster ? this.learner.preferredAction(cluster) : null;
    const preferred =
      clusInf >= instInf && clusterAction
        ? clusterAction
        : best && best.action !== "IDLE" && best.action !== "DECAY"
          ? best.action
          : clusterAction;

    const branchBase =
      cluster && clusInf > 0
        ? this.learner.avgBranch(cluster)
        : best?.branchProbability ?? 0;

    const rewardBoost = cluster ? Math.max(0, cluster.reward) * 0.2 : 0;

    return {
      influence,
      preferredAction: preferred,
      branchBoost: branchBase * influence * 0.45 + rewardBoost,
      lengthScale: 1 + influence * 0.35 + rewardBoost,
      matchId: best?.id ?? null,
      clusterId: cluster?.id ?? null,
      similarity: Math.max(bestSim, clusterSim),
    };
  }

  remember(ev: AcousticEvent, st: StructuralEvent) {
    if (ev.type === "SILENCE" || ev.type === "UNKNOWN") return;
    if (st.action === "IDLE" || st.action === "DECAY") return;

    const probe = featuresFromEvent(ev);
    const emb = this.learner.embed(probe);
    const cluster = this.learner.assign(emb, ev.type);

    // Positive reinforcement when action repeats within cluster
    const prevVotes = cluster.actionVotes[st.action] ?? 0;
    const positive = prevVotes > 0 || st.action === "BRANCH" || st.action === "CREATE_NODE";
    this.learner.reinforce(cluster, st.action, st.branchProbability, positive);

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
      nearest.clusterId = cluster.id;
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
      clusterId: cluster.id,
    });

    if (this.traces.length > 12) this.traces.length = 12;
  }

  list(): MemoryTrace[] {
    return this.traces.slice(0, 6);
  }

  clusters(): ClusterModel[] {
    return this.learner.list();
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

function emptyBias(): MemoryBias {
  return {
    influence: 0,
    preferredAction: null,
    branchBoost: 0,
    lengthScale: 1,
    matchId: null,
    clusterId: null,
    similarity: 0,
  };
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
