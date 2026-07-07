import * as Tone from 'tone';
import {
  bandEnergy,
  createOnsetState,
  dbToLinear,
  envelopeStep,
  logBandEdges,
  onsetStep,
  spectralFlux,
  type OnsetState,
} from './features';

/** Finite, in-range guard for analyser reads (silence reads as 0, not -Infinity). */
function safe01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

const FEATURE_BANDS = 8;
const BAND_ATTACK_SEC = 0.02;
const BAND_RELEASE_SEC = 0.25;
const FLUX_ATTACK_SEC = 0.01;
const FLUX_RELEASE_SEC = 0.15;

/**
 * FFT bins (Tone.FFT `size`; the underlying AnalyserNode fftSize is 2×this — 512,
 * the floor of the project's documented 512–1024 budget). At 64 bins a bin was
 * ~375 Hz wide at 48 kHz, so everything below 375 Hz — the whole sub-bass — was
 * invisible to the feature bands. 256 bins (~94 Hz) give band1/band2 real bass to
 * react to for one 512-point transform per frame.
 */
const FFT_BINS = 256;
/** Top of the analysed range as a fraction of the bins (~18 kHz), as before. */
const FFT_TOP = 0.75;

/**
 * Signal-output measurements for the modulation matrix. The legacy trio —
 * master/bass RMS and the coarse fft.low/mid/high bands — is unchanged so every
 * existing route keeps working. V2 adds the FEATURE layer on the same FFT tap:
 * eight log-spaced bands with asymmetric envelope followers, spectral flux, and
 * an adaptive onset detector exposed as a trigger port. update(dt) runs ONCE
 * per frame from the engine loop (preallocated buffers, no per-read recompute);
 * the read*() methods just return the cached values.
 */
export class Analysers {
  readonly masterMeter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
  readonly bassMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
  readonly fft = new Tone.FFT({ size: FFT_BINS, smoothing: 0.7 });

  private readonly mags = new Float32Array(FFT_BINS);
  private readonly prevMags = new Float32Array(FFT_BINS);
  private readonly bandEdges = logBandEdges(FEATURE_BANDS, 1, Math.round(FFT_BINS * FFT_TOP));
  private readonly bandEnv = new Float32Array(FEATURE_BANDS);
  private readonly onset: OnsetState = createOnsetState();
  private binsDb: Float32Array | null = null;
  private fluxEnv = 0;
  private onsetPulse = 0;

  /**
   * Pull one FFT frame and refresh every feature. Called once per engine frame,
   * BEFORE the matrix evaluates, so routed reads see this frame's values.
   */
  update(dt: number): void {
    const bins = this.fft.getValue();
    this.binsDb = bins;
    const n = Math.min(bins.length, this.mags.length);
    for (let i = 0; i < n; i++) this.mags[i] = dbToLinear(bins[i] ?? -Infinity);

    const flux = spectralFlux(this.mags, this.prevMags);
    this.prevMags.set(this.mags);
    this.fluxEnv = envelopeStep(this.fluxEnv, flux, dt, FLUX_ATTACK_SEC, FLUX_RELEASE_SEC);
    this.onsetPulse = onsetStep(this.onset, flux, dt);

    for (let b = 0; b < FEATURE_BANDS; b++) {
      const e = bandEnergy(this.mags, this.bandEdges[b]!, this.bandEdges[b + 1]!);
      this.bandEnv[b] = envelopeStep(this.bandEnv[b]!, e, dt, BAND_ATTACK_SEC, BAND_RELEASE_SEC);
    }
  }

  private meterValue(meter: Tone.Meter): number {
    const v = meter.getValue();
    return safe01(typeof v === 'number' ? v : (v[0] ?? 0));
  }

  readMaster(): number {
    return this.meterValue(this.masterMeter);
  }
  readBass(): number {
    return this.meterValue(this.bassMeter);
  }

  /** One of the eight log-spaced feature bands (envelope-followed, 0..1). */
  readFeatureBand(index: number): number {
    return safe01(this.bandEnv[index] ?? 0);
  }
  /** Spectral flux, envelope-followed — continuous "how much is changing". */
  readFlux(): number {
    return safe01(this.fluxEnv);
  }
  /** 1 on the frame an onset fired, else 0 — the trigger-port read. */
  readOnset(): number {
    return this.onsetPulse;
  }

  /** Average energy of an FFT sub-band (fractions of the spectrum), mapped to
   *  [0,1] — the legacy fft.low/mid/high reader, unchanged normalisation. */
  readBand(lowFrac: number, highFrac: number): number {
    const bins = this.binsDb ?? this.fft.getValue();
    const n = bins.length;
    if (n === 0) return 0;
    const lo = Math.max(0, Math.floor(lowFrac * n));
    const hi = Math.min(n, Math.max(lo + 1, Math.floor(highFrac * n)));
    let sum = 0;
    let count = 0;
    for (let i = lo; i < hi; i++) {
      const db = bins[i] ?? -Infinity;
      if (Number.isFinite(db)) {
        sum += (db + 100) / 100; // map ~[-100,0] dB → [0,1]
        count++;
      }
    }
    return count === 0 ? 0 : safe01(sum / count);
  }

  dispose(): void {
    this.masterMeter.dispose();
    this.bassMeter.dispose();
    this.fft.dispose();
  }
}
