import type { AcousticEventType, StructuralAction } from "../types";

/** 5D acoustic embedding used for clustering (explainable, not a neural net). */
export type Embedding = [number, number, number, number, number];

export interface ClusterModel {
  id: string;
  centroid: Embedding;
  count: number;
  /** Action vote counts — reinforcement by repetition. */
  actionVotes: Partial<Record<StructuralAction, number>>;
  branchSum: number;
  reward: number;
  dominantType: AcousticEventType;
  typeVotes: Partial<Record<AcousticEventType, number>>;
}

/**
 * Online clustering + lightweight reinforcement.
 * Solves: map acoustic families → shared learned structural preference.
 */
export class PatternLearner {
  clusters: ClusterModel[] = [];
  private seq = 0;
  readonly maxClusters = 6;
  /** Max distance (1 - similarity proxy) to join existing cluster. */
  readonly joinThreshold = 0.32;

  reset() {
    this.clusters = [];
    this.seq = 0;
  }

  embed(f: {
    energy: number;
    onset: number;
    noisiness: number;
    harmonicity: number;
    centroidN: number;
  }): Embedding {
    return [f.energy, f.onset, f.noisiness, f.harmonicity, f.centroidN];
  }

  distance(a: Embedding, b: Embedding): number {
    let s = 0;
    for (let i = 0; i < 5; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s / 5);
  }

  /** Assign embedding to nearest cluster or spawn one. */
  assign(emb: Embedding, type: AcousticEventType): ClusterModel {
    let best: ClusterModel | null = null;
    let bestD = Infinity;
    for (const c of this.clusters) {
      const d = this.distance(emb, c.centroid);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }

    if (best && bestD <= this.joinThreshold) {
      this.updateCentroid(best, emb);
      best.count += 1;
      best.typeVotes[type] = (best.typeVotes[type] ?? 0) + 1;
      best.dominantType = dominantKey(best.typeVotes) as AcousticEventType;
      return best;
    }

    if (this.clusters.length >= this.maxClusters && best) {
      // Force into nearest when at capacity
      this.updateCentroid(best, emb);
      best.count += 1;
      best.typeVotes[type] = (best.typeVotes[type] ?? 0) + 1;
      best.dominantType = dominantKey(best.typeVotes) as AcousticEventType;
      return best;
    }

    this.seq += 1;
    const created: ClusterModel = {
      id: `C-${String(this.seq).padStart(2, "0")}`,
      centroid: [...emb] as Embedding,
      count: 1,
      actionVotes: {},
      branchSum: 0,
      reward: 0,
      dominantType: type,
      typeVotes: { [type]: 1 },
    };
    this.clusters.push(created);
    return created;
  }

  /** Reinforce cluster when a structural action followed this acoustic family. */
  reinforce(
    cluster: ClusterModel,
    action: StructuralAction,
    branchProbability: number,
    positive: boolean
  ) {
    if (action === "IDLE" || action === "DECAY") return;
    cluster.actionVotes[action] = (cluster.actionVotes[action] ?? 0) + 1;
    cluster.branchSum += branchProbability;
    cluster.reward += positive ? 0.15 : -0.05;
    cluster.reward = Math.max(-1, Math.min(1, cluster.reward));
  }

  preferredAction(cluster: ClusterModel): StructuralAction | null {
    const key = dominantKey(cluster.actionVotes);
    if (!key || key === "IDLE" || key === "DECAY") return null;
    return key as StructuralAction;
  }

  avgBranch(cluster: ClusterModel): number {
    return cluster.count > 0 ? cluster.branchSum / Math.max(cluster.count, 1) : 0;
  }

  /** Similarity 0–1 from embedding distance. */
  similarityTo(emb: Embedding, cluster: ClusterModel): number {
    const d = this.distance(emb, cluster.centroid);
    return Math.max(0, 1 - d / 0.6);
  }

  bestCluster(emb: Embedding): { cluster: ClusterModel; similarity: number } | null {
    if (!this.clusters.length) return null;
    let best = this.clusters[0];
    let bestS = this.similarityTo(emb, best);
    for (let i = 1; i < this.clusters.length; i++) {
      const s = this.similarityTo(emb, this.clusters[i]);
      if (s > bestS) {
        bestS = s;
        best = this.clusters[i];
      }
    }
    return { cluster: best, similarity: bestS };
  }

  list(): ClusterModel[] {
    return [...this.clusters].sort((a, b) => b.count - a.count);
  }

  private updateCentroid(c: ClusterModel, emb: Embedding) {
    const n = c.count;
    for (let i = 0; i < 5; i++) {
      c.centroid[i] = (c.centroid[i] * n + emb[i]) / (n + 1);
    }
  }
}

function dominantKey(
  votes: Partial<Record<string, number>>
): string | null {
  let best: string | null = null;
  let n = -1;
  for (const [k, v] of Object.entries(votes)) {
    if ((v ?? 0) > n) {
      n = v ?? 0;
      best = k;
    }
  }
  return best;
}
