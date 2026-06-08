// Tape-warmth AudioWorklet processor: gentle tanh saturation, wow & flutter via a
// modulated fractional delay, and high-frequency loss via a one-pole lowpass — now in
// TRUE STEREO, with L/R wow & flutter decorrelated so the wet bus keeps its width
// through the tape. This character is core to the sonic identity (brief §7). Kept as
// plain JS so Vite bundles it verbatim as an AudioWorklet module — no TS transpile.

class TapeWarmthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1.4, minValue: 0.1, maxValue: 10, automationRate: 'k-rate' },
      { name: 'flutterDepth', defaultValue: 0.15, minValue: 0, maxValue: 0.6, automationRate: 'k-rate' },
      { name: 'flutterRate', defaultValue: 4, minValue: 0.1, maxValue: 12, automationRate: 'k-rate' },
      { name: 'hfCutoff', defaultValue: 7000, minValue: 500, maxValue: 18000, automationRate: 'k-rate' },
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
    this.flutterPhase = 0;
    // L/R phase offsets decorrelate the wow & flutter — the wide, drifting edge of real
    // tape. Left sits at 0; right is shifted by ~a third of a cycle.
    this.chOffset = [0, 0.37];
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const nCh = output.length;
    const n = output[0].length;

    const drive = params.drive[0] ?? 1.4;
    const fDepth = params.flutterDepth[0] ?? 0.15;
    const fRate = params.flutterRate[0] ?? 4;
    const hf = params.hfCutoff[0] ?? 7000;

    const lpCoeff = Math.min(1, (2 * Math.PI * hf) / this.sr);
    const wowInc = 0.6 / this.sr; // ~0.6 Hz wow
    const flInc = fRate / this.sr;

    for (let i = 0; i < n; i++) {
      // advance the shared transport phases once per sample frame
      this.wowPhase += wowInc;
      if (this.wowPhase > 1) this.wowPhase -= 1;
      this.flutterPhase += flInc;
      if (this.flutterPhase > 1) this.flutterPhase -= 1;

      for (let ch = 0; ch < nCh; ch++) {
        const inCh = input ? (input[ch] ?? input[0]) : undefined; // mono feeds both sides
        const x = inCh ? (inCh[i] ?? 0) : 0;

        // 1. soft saturation
        const s = Math.tanh(drive * x);

        // 2. wow & flutter — modulated fractional delay, decorrelated per channel
        const off = this.chOffset[ch] ?? 0;
        const wow = Math.sin((this.wowPhase + off) * 2 * Math.PI);
        const flutter = Math.sin((this.flutterPhase + off * 1.3) * 2 * Math.PI);
        const buf = this.bufs[ch] ?? this.bufs[0];
        const len = buf.length;
        let delaySamp = ((6 + wow * 2 + flutter * fDepth * 4) / 1000) * this.sr;
        if (delaySamp < 1) delaySamp = 1;
        if (delaySamp > len - 2) delaySamp = len - 2;

        const w = this.ws[ch] ?? 0;
        buf[w] = s;
        let rp = w - delaySamp;
        while (rp < 0) rp += len;
        const i0 = Math.floor(rp);
        const frac = rp - i0;
        const a = buf[i0 % len] ?? 0;
        const b = buf[(i0 + 1) % len] ?? 0;
        const delayed = a + (b - a) * frac;
        this.ws[ch] = (w + 1) % len;

        let y = s * 0.7 + delayed * 0.3;

        // 3. high-frequency loss (one-pole), per channel
        let lp = this.lps[ch] ?? 0;
        lp += lpCoeff * (y - lp);
        if (Math.abs(lp) < 1e-30) lp = 0; // denormal guard
        this.lps[ch] = lp;
        y = lp;

        output[ch][i] = Number.isFinite(y) ? y : 0;
      }
    }
    return true;
  }
}

registerProcessor('tape-warmth', TapeWarmthProcessor);
