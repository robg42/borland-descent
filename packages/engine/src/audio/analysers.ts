import * as Tone from 'tone';

/** Finite, in-range guard for analyser reads (silence reads as 0, not -Infinity). */
function safe01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Signal-output measurements for the modulation matrix: master + bass amplitude
 * (RMS) and a banded FFT. Read each frame; values are normalised to [0,1].
 */
export class Analysers {
  readonly masterMeter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
  readonly bassMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
  readonly fft = new Tone.FFT({ size: 64, smoothing: 0.7 });

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

  /** Average energy of an FFT sub-band (fractions of the spectrum), mapped to [0,1]. */
  readBand(lowFrac: number, highFrac: number): number {
    const bins = this.fft.getValue();
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
