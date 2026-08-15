# Architecture

Pipeline (target):

```
AUDIO CAPTURE → ANALYSIS → AcousticEvent → Interpretation
  → StructuralEvent → Growth → Structure → Renderer
```

## Layers

| Layer | Role | Status |
|-------|------|--------|
| AcousticMeasurement | Raw audio features | Phase 2 |
| AcousticEvent | Interpreted events | Phase 3 |
| StructuralEvent | Visual growth actions | Phase 4 |
| StructureScene | SquareNode, Junction, Marker, Module, Connection, Root | Phase 1–4 |
| Renderer | Grid + technical primitives + HUD | Phase 1–4 |
| AudioCapture / AcousticAnalyzer | Mic + metrics | Phase 2 |
| EventInterpreter | measurement → event | Phase 3 |
| GrowthEngine | event → structure mutation | Phase 4 |

## Files

- `src/types.ts` — contracts + counts
- `src/structure.ts` — bottom-rooted foundation scene
- `src/renderer.ts` — primitives + instrument chrome
- `src/audio/capture.ts` — microphone + AnalyserNode
- `src/audio/analysis.ts` — AcousticMeasurement computation
- `src/audio/interpret.ts` — AcousticEvent interpretation
- `src/growth/engine.ts` — StructuralEvent + growth/decay
- `src/main.ts` — boot + loop

See `docs/GROWTH_RULES.md` for mapping hypotheses.

Module `F:` / `E:` values are structural simulation placeholders, not acoustic Hz/energy.
