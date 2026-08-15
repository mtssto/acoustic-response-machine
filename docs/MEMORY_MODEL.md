# Memory Model (Phase 6)

Explainable similarity — no ML embeddings.

## Trace (compact)

| Field | Source |
|-------|--------|
| type | AcousticEvent.type |
| energy / onset / noisiness / harmonicity | characteristics |
| centroidN | spectral centroid normalized |
| action / branchProbability | StructuralEvent that followed |
| uses | recall/store count |

## Similarity

Weighted feature distance + type boost ∈ [0,1].

Match if similarity ≥ 0.62 → `influence` steers growth:
- branchBoost
- lengthScale
- preferredAction (probabilistic)

Near-duplicate traces (sim ≥ 0.78) merge instead of duplicating.

## Effect

Repeated acoustic patterns bias the Growth Engine toward related past structural responses — related, not identical.
