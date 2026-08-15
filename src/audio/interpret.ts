import type { AcousticEvent, AcousticEventType, AcousticMeasurement } from "../types";

/**
 * Phase 3 — measurement → AcousticEvent.
 * Tuned for typical mic levels (speech often −40…−20 dBFS).
 */
export class EventInterpreter {
  private prevRmsLin = 0;
  private hold: AcousticEvent | null = null;
  private holdUntil = 0;

  interpret(m: AcousticMeasurement, timestampSec: number): AcousticEvent {
    const rmsDb = m.rms ?? -80;
    const peakDb = m.peak ?? -80;
    const onset = clamp01(m.onset ?? 0);
    const zcr = clamp01(m.zeroCrossingRate ?? 0);
    const harm = clamp01(m.harmonicity ?? 0);

    const rmsLin = dbToLin(rmsDb);
    const peakLin = dbToLin(peakDb);
    // Sensitive energy: −55 dBFS ≈ 0, −20 dBFS ≈ 1
    const energy = clamp01((rmsDb + 55) / 35);
    const noisiness = clamp01(zcr * 1.4 - harm * 0.5);
    const rmsDelta = Math.max(0, rmsLin - this.prevRmsLin);
    this.prevRmsLin = rmsLin * 0.35 + this.prevRmsLin * 0.65;

    const characteristics = {
      energy,
      onset,
      noisiness,
      harmonicity: harm,
    };

    if (this.hold && timestampSec < this.holdUntil) {
      return {
        ...this.hold,
        timestamp: timestampSec,
        measurements: m,
        characteristics,
        intensity: Math.max(this.hold.intensity, energy),
      };
    }

    let type: AcousticEventType = "UNKNOWN";
    let confidence = 0.4;
    let intensity = energy;

    // True silence only when very quiet
    if (rmsDb < -48 && onset < 0.08 && energy < 0.12) {
      type = "SILENCE";
      confidence = 0.65 + clamp01((-48 - rmsDb) / 20) * 0.3;
      intensity = energy;
    } else if (onset > 0.35 && (peakLin > 0.05 || rmsDelta > 0.01 || energy > 0.25)) {
      type = "IMPACT";
      confidence = clamp01(0.5 + onset * 0.4 + energy * 0.2);
      intensity = clamp01(Math.max(energy, onset, peakLin));
    } else if (onset > 0.22 && energy > 0.15) {
      type = "TRANSIENT";
      confidence = clamp01(0.45 + onset * 0.4);
      intensity = clamp01(Math.max(energy, onset * 0.8));
    } else if (noisiness > 0.5 && harm < 0.35 && energy > 0.18) {
      type = "NOISE";
      confidence = clamp01(0.45 + noisiness * 0.4);
      intensity = energy;
    } else if (energy > 0.14) {
      type = "SUSTAIN";
      confidence = clamp01(0.45 + energy * 0.35 + harm * 0.15);
      intensity = energy;
    } else if (energy > 0.08 || onset > 0.1) {
      // Quiet but present activity — still actionable for growth
      type = "SUSTAIN";
      confidence = 0.4;
      intensity = Math.max(energy, 0.1);
    } else {
      type = "SILENCE";
      confidence = 0.55;
      intensity = energy;
    }

    const event: AcousticEvent = {
      type,
      intensity: Number(intensity.toFixed(3)),
      confidence: Number(clamp01(confidence).toFixed(3)),
      timestamp: timestampSec,
      measurements: m,
      characteristics,
    };

    if (type === "IMPACT" || type === "TRANSIENT") {
      this.hold = event;
      this.holdUntil = timestampSec + (type === "IMPACT" ? 0.28 : 0.18);
    } else {
      this.hold = null;
    }

    return event;
  }

  reset() {
    this.prevRmsLin = 0;
    this.hold = null;
    this.holdUntil = 0;
  }
}

function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
