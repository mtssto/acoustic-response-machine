# Learning (Phase 8)

Concrete problem: **acoustic families should share a learned structural preference**, beyond single nearest-trace recall.

## Approach (no LLM, no heavy ML libs)

| Piece | Role |
|-------|------|
| Embedding | 5D vector: energy, onset, noisiness, harmonicity, centroidN |
| Online clustering | Assign to nearest centroid or spawn (max 6 clusters) |
| Reinforcement | Action vote counts + reward when family repeats an action |
| Recall blend | Instance similarity (Phase 6) + cluster prototype |

## Effect on growth

- Prefer cluster's dominant `StructuralAction` when cluster similarity is strong
- Branch/length bias from cluster averages + reward
- `Pattern ID` = active cluster (`C-01` …)

## What this is not

- Not neural embeddings
- Not an LLM
- Not offline batch training

Explainable and incremental on top of Phase 6 memory.
