// Tape-warmth AudioWorklet processor: gentle tanh saturation; wow & flutter via a
// modulated fractional delay (with a slow SECOND wow so the drift never quite repeats);
// lo-fi degradation (subtle bit reduction + an ever-present tape-hiss floor); and high-
// frequency loss via a one-pole lowpass. TRUE STEREO, with L/R wow & flutter
// decorrelated so the wet bus keeps its width. This degraded-tape character is core to
// the sonic identity (Boards of Canada). Plain JS so Vite bundles it verbatim — no TS.

const TWO_PI = 2 * Math.PI;

class TapeWarmthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1.4, minValue: 0.1, maxValue: 10, automationRate: 'k-rate' },
      { name: 'flutterDepth', defaultValue: 0.15, minValue: 0, maxValue: 0.6, automationRate: 'k-rate' },
      { name: 'flutterRate', defaultValue: 4, minValue: 0.1, maxValue: 12, automationRate: 'k-rate' },
      { name: 'hfCutoff', defaultValue: 7000, minValue: 500, maxValue: 18000, automationRate: 'k-rate' },
      { name: 'hiss', defaultValue: 0.0015, minValue: 0, maxValue: 0.05, automationRate: 'k-rate' },
      { name: 'crush', defaultValue: 12, minValue: 4, maxValue: 16, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const len = Math.ceil(this.sr * 0.05); // 50 ms delay line per channel
    // Per-channel state (stereo). A mono input feeds both sides, so even a mono source
    // emerges subtly wide.
    this.bufs = [new Float32Array(len), new Float32Array(len)];
    this.ws = [0, 0];
    this.lps = [0, 0];
    this.wowPhase = 0;
    this.wow2Phase = 0;
    this.flutterPhase = 0;
    // L/R phase offsets decorrelate the wow & flutter — the wide, drifting edge of real
    // tape. Left sits at 0; right is shifted by ~a third of a cycle.
    this.chOffset = [0, 0.37];
    // previous input per channel — for 2× oversampling the saturation (anti-aliasing)
    this.satPrev = [0, 0];
    // xorshift32 state for the hiss noise (any nonzero seed; never reaches 0)
    this.rngState = 0x6d2b79f5;
    // Per-block one-pole smoothing: each param target is ramped over ~50 ms of blocks
    // (blockSize/sr ≈ 2.9 ms per block at 128 samples / 44100 Hz, so tc ≈ 17 blocks).
    // This eliminates the audible step artefact when the matrix or studio sliders write
    // a new value between blocks.
    this.sm = { drive: 1.4, fDepth: 0.15, fRate: 4, hf: 7000, hiss: 0.0015, crush: 12 };
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const nCh = output.length;
    const n = output[0].length;

    // Per-block smoothing coefficient: 1 − exp(−blockDuration / tc), tc = 0.05 s.
    const blockDur = n / this.sr;
    const smCoeff = 1 - Math.exp(-blockDur / 0.05);
    const sm = this.sm;
    sm.drive  += smCoeff * ((params.drive[0]        ?? 1.4)    - sm.drive);
    sm.fDepth += smCoeff * ((params.flutterDepth[0] ?? 0.15)   - sm.fDepth);
    sm.fRate  += smCoeff * ((params.flutterRate[0]  ?? 4)      - sm.fRate);
    sm.hf     += smCoeff * ((params.hfCutoff[0]     ?? 7000)   - sm.hf);
    sm.hiss   += smCoeff * ((params.hiss[0]          ?? 0.0015) - sm.hiss);
    sm.crush  += smCoeff * ((params.crush[0]         ?? 12)     - sm.crush);

    const drive = sm.drive;
    const fDepth = sm.fDepth;
    const fRate = sm.fRate;
    const hf = sm.hf;
    const hiss = sm.hiss;
    const crush = sm.crush;

    const lpCoeff = Math.min(1, (TWO_PI * hf) / this.sr);
    const wowInc = 0.6 / this.sr; // ~0.6 Hz wow
    const wow2Inc = 0.19 / this.sr; // slow second wow — breaks up the periodicity
    const flInc = fRate / this.sr;
    // Bit-reduction levels (k-rate). ~16 bits is transparent, so skip the work then.
    const levels = crush < 15.5 ? Math.pow(2, crush) : 0;
    const invLevels = levels ? 1 / levels : 0;
    const msToSamp = this.sr / 1000;
    const fDepth4 = fDepth * 4;

    // Channel-outer, sample-inner: all mutable state lives in locals so the per-sample
    // loop touches no properties and does no modulo/branchy wrap-around. The transport
    // phases advance identically for every channel (each runs its own copy from the
    // block-start values); the last channel's end values are committed after the loop.
    let endWow = this.wowPhase;
    let endWow2 = this.wow2Phase;
    let endFl = this.flutterPhase;
    let rng = this.rngState;
    for (let ch = 0; ch < nCh; ch++) {
      const inCh = input ? (input[ch] ?? input[0]) : undefined; // mono feeds both sides
      const outCh = output[ch];
      const buf = this.bufs[ch] ?? this.bufs[0];
      const len = buf.length;
      const off = this.chOffset[ch] ?? 0;
      const off06 = off * 0.6;
      const off13 = off * 1.3;
      let w = this.ws[ch] ?? 0;
      let lp = this.lps[ch] ?? 0;
      let xPrev = this.satPrev[ch] ?? 0;
      let wowP = this.wowPhase;
      let wow2P = this.wow2Phase;
      let flP = this.flutterPhase;

      for (let i = 0; i < n; i++) {
        // advance the transport phases once per sample frame
        wowP += wowInc;
        if (wowP > 1) wowP -= 1;
        wow2P += wow2Inc;
        if (wow2P > 1) wow2P -= 1;
        flP += flInc;
        if (flP > 1) flP -= 1;

        const x = inCh ? (inCh[i] ?? 0) : 0;

        // 1. soft saturation, 2x oversampled to tame aliasing: linear-interp upsample →
        // tanh on both points → 2-tap average downsample (cheap, and the drive is gentle).
        const s = 0.5 * (Math.tanh(drive * 0.5 * (xPrev + x)) + Math.tanh(drive * x));
        xPrev = x;

        // 2. wow & flutter — modulated fractional delay, decorrelated per channel, with
        // a slow second wow so the drift wanders rather than cycles.
        const wow = Math.sin((wowP + off) * TWO_PI);
        const wow2 = Math.sin((wow2P + off06) * TWO_PI);
        const flutter = Math.sin((flP + off13) * TWO_PI);
        let delaySamp = (6 + wow * 2 + wow2 * 1.2 + flutter * fDepth4) * msToSamp;
        if (delaySamp < 1) delaySamp = 1;
        else if (delaySamp > len - 2) delaySamp = len - 2;

        buf[w] = s;
        // delaySamp ∈ [1, len-2] and w ∈ [0, len), so one conditional add wraps rp
        // and only the i0+1 neighbour can step past the end.
        let rp = w - delaySamp;
        if (rp < 0) rp += len;
        const i0 = rp | 0;
        const frac = rp - i0;
        let i1 = i0 + 1;
        if (i1 >= len) i1 -= len;
        const delayed = buf[i0] + (buf[i1] - buf[i0]) * frac;
        w += 1;
        if (w >= len) w = 0;

        let y = s * 0.7 + delayed * 0.3;

        // 3. lo-fi degradation: gentle bit reduction, then a tape-hiss floor (always
        // present, like a running reel) — xorshift32 white noise, far cheaper than
        // Math.random in a per-sample loop. The lowpass below softens both into haze.
        if (levels) y = Math.round(y * levels) * invLevels;
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        y += (rng | 0) * 4.656612873077393e-10 * hiss; // int32 → [-1, 1)

        // 4. high-frequency loss (one-pole), per channel
        lp += lpCoeff * (y - lp);
        if (lp > -1e-30 && lp < 1e-30) lp = 0; // denormal guard
        y = lp;

        // NaN and runaway values both fail the predicate and flush to silence
        outCh[i] = y > -1e6 && y < 1e6 ? y : 0;
      }

      this.ws[ch] = w;
      this.lps[ch] = lp;
      this.satPrev[ch] = xPrev;
      endWow = wowP;
      endWow2 = wow2P;
      endFl = flP;
    }
    this.rngState = rng;
    this.wowPhase = endWow;
    this.wow2Phase = endWow2;
    this.flutterPhase = endFl;
    return true;
  }
}

registerProcessor('tape-warmth', TapeWarmthProcessor);
