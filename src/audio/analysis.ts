import type { AcousticMeasurement } from "../types";

export interface AnalysisResult {
  measurement: AcousticMeasurement;
  /** 0–1 confidence for fundamentalFrequency estimate. */
  f0Confidence: number;
  /** Normalized 0–1 spectrum bins for display. */
  spectrum: Float32Array;
  /** Time-domain samples −1..1 for waveform display. */
  waveform: Float32Array;
  /** Recent onset strengths for event strip. */
  onsetHistory: Float32Array;
}

const F0_MIN = 70;
const F0_MAX = 500;
const ROLLOFF = 0.85;

export class AcousticAnalyzer {
  private prevMag: Float32Array | null = null;
  private onsetHistory = new Float32Array(64);
  private onsetWrite = 0;
  private fluxSmooth = 0;

  analyze(
    time: Float32Array,
    freqDb: Float32Array,
    sampleRate: number
  ): AnalysisResult {
    const n = time.length;
    let sumSq = 0;
    let peak = 0;
    let zc = 0;
    for (let i = 0; i < n; i++) {
      const x = time[i];
      sumSq += x * x;
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (i > 0 && ((time[i - 1] >= 0 && x < 0) || (time[i - 1] < 0 && x >= 0))) {
        zc += 1;
      }
    }
    const rms = Math.sqrt(sumSq / n);
    const rmsDb = ampToDb(rms);
    const peakDb = ampToDb(peak);
    const zcr = zc / Math.max(n - 1, 1);

    const bins = freqDb.length;
    const mag = new Float32Array(bins);
    let maxMag = 1e-12;
    for (let i = 0; i < bins; i++) {
      const linear = Math.pow(10, freqDb[i] / 20);
      mag[i] = linear;
      if (linear > maxMag) maxMag = linear;
    }

    const nyquist = sampleRate / 2;
    const hzPerBin = nyquist / Math.max(bins - 1, 1);

    let sumM = 0;
    let sumFM = 0;
    for (let i = 1; i < bins; i++) {
      const m = mag[i];
      const f = i * hzPerBin;
      sumM += m;
      sumFM += f * m;
    }

    let centroid: number | null = null;
    let bandwidth: number | null = null;
    let rolloff: number | null = null;

    if (sumM > 1e-9) {
      centroid = sumFM / sumM;
      let sumVar = 0;
      for (let i = 1; i < bins; i++) {
        const f = i * hzPerBin;
        const d = f - centroid;
        sumVar += d * d * mag[i];
      }
      bandwidth = Math.sqrt(sumVar / sumM);

      const target = ROLLOFF * sumM;
      let acc = 0;
      rolloff = nyquist;
      for (let i = 1; i < bins; i++) {
        acc += mag[i];
        if (acc >= target) {
          rolloff = i * hzPerBin;
          break;
        }
      }
    }

    // Spectral flux (temporal flux / onset strength)
    let flux = 0;
    if (this.prevMag && this.prevMag.length === mag.length) {
      for (let i = 1; i < bins; i++) {
        const d = mag[i] - this.prevMag[i];
        if (d > 0) flux += d;
      }
      flux /= bins;
    }
    this.prevMag = mag.slice();
    this.fluxSmooth = this.fluxSmooth * 0.7 + flux * 0.3;
    const onset = Math.min(1, this.fluxSmooth * 8);
    this.onsetHistory[this.onsetWrite % this.onsetHistory.length] = onset;
    this.onsetWrite += 1;

    // Autocorrelation F0 (low confidence when noisy / silent)
    const { f0, confidence } = estimateF0(time, sampleRate, rms);

    // Harmonicity proxy: inverse spectral flatness (geometric/arithmetic mean)
    let harmonicity: number | null = null;
    if (sumM > 1e-9 && rms > 0.01) {
      let logSum = 0;
      let usable = 0;
      for (let i = 1; i < bins; i++) {
        if (mag[i] > 1e-12) {
          logSum += Math.log(mag[i]);
          usable += 1;
        }
      }
      if (usable > 8) {
        const geo = Math.exp(logSum / usable);
        const arith = sumM / usable;
        const flatness = geo / Math.max(arith, 1e-12);
        harmonicity = Number(Math.max(0, Math.min(1, 1 - flatness)).toFixed(3));
      }
    }

    const spectrum = new Float32Array(bins);
    for (let i = 0; i < bins; i++) spectrum[i] = mag[i] / maxMag;

    const silent = rms < 0.003;

    const measurement: AcousticMeasurement = {
      rms: silent ? rmsDb : rmsDb,
      peak: peakDb,
      fundamentalFrequency: confidence >= 0.45 && !silent ? f0 : null,
      spectralCentroid: silent ? null : centroid,
      spectralBandwidth: silent ? null : bandwidth,
      spectralRolloff: silent ? null : rolloff,
      zeroCrossingRate: zcr,
      harmonicity: silent ? null : harmonicity,
      onset,
      duration: null,
    };

    return {
      measurement,
      f0Confidence: silent ? 0 : confidence,
      spectrum,
      waveform: time.slice(),
      onsetHistory: this.onsetHistory.slice(),
    };
  }
}

function ampToDb(amp: number): number {
  return 20 * Math.log10(Math.max(amp, 1e-8));
}

function estimateF0(
  time: Float32Array,
  sampleRate: number,
  rms: number
): { f0: number; confidence: number } {
  if (rms < 0.015) return { f0: 0, confidence: 0 };

  const minLag = Math.floor(sampleRate / F0_MAX);
  const maxLag = Math.min(Math.floor(sampleRate / F0_MIN), time.length - 1);
  if (maxLag <= minLag + 2) return { f0: 0, confidence: 0 };

  let bestLag = minLag;
  let bestCorr = -1;
  let second = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let normA = 0;
    let normB = 0;
    const count = time.length - lag;
    for (let i = 0; i < count; i++) {
      const a = time[i];
      const b = time[i + lag];
      corr += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB) + 1e-12;
    const r = corr / denom;
    if (r > bestCorr) {
      second = bestCorr;
      bestCorr = r;
      bestLag = lag;
    } else if (r > second) {
      second = r;
    }
  }

  const f0 = sampleRate / bestLag;
  const confidence = Math.max(
    0,
    Math.min(1, (bestCorr - 0.2) * 1.4 * (bestCorr - second + 0.05))
  );
  return { f0, confidence };
}
