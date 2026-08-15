# Audio Model

Computed in Phase 2 from microphone input (Web Audio AnalyserNode).

| Metric | Meaning | Notes |
|--------|---------|-------|
| RMS | Average signal energy | dBFS |
| Peak | Maximum amplitude | dBFS |
| Fundamental frequency | Autocorrelation F0 | `UNAVAILABLE` / `LOW CONFIDENCE` / `~` if weak |
| Spectral centroid | Spectral center of mass | Hz / kHz |
| Spectral bandwidth | Energy spread around centroid | Hz / kHz |
| Spectral rolloff | 85% cumulative energy cutoff | Hz / kHz |
| Zero crossing rate | Zero-crossing rate | 0–1 |
| Onset | Half-wave spectral flux | 0–1 |
| Temporal Flux | Same flux used for onset (Phase 2) | 0–1 |
| Harmonicity | 1 − spectral flatness | approx.; null when silent |
| Duration | Temporal persistence | not computed yet |

Structural `F:` / `E:` on modules remain simulation placeholders, not acoustic values.
