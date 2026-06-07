// Tape-warmth AudioWorklet processor: gentle tanh saturation, wow & flutter via a
// modulated fractional delay, and high-frequency loss via a one-pole lowpass. This
// character is core to the sonic identity (brief §7). Kept as plain JS so Vite
// bundles it verbatim as an AudioWorklet module — no TS transpile step to misfire.

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
    this.buf = new Float32Array(Math.ceil(this.sr * 0.05)); // 50 ms delay line
    this.w = 0;
    this.lp = 0;
    this.wowPhase = 0;
    this.flutterPhase = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const inCh = input[0];
    const outCh = output[0];
    const n = outCh.length;

    const drive = params.drive[0] ?? 1.4;
    const fDepth = params.flutterDepth[0] ?? 0.15;
    const fRate = params.flutterRate[0] ?? 4;
    const hf = params.hfCutoff[0] ?? 7000;

    const buf = this.buf;
    const len = buf.length;
    const lpCoeff = Math.min(1, (2 * Math.PI * hf) / this.sr);
    const wowInc = 0.6 / this.sr; // ~0.6 Hz wow
    const flInc = fRate / this.sr;

    for (let i = 0; i < n; i++) {
      const x = inCh[i] ?? 0;

      // 1. soft saturation
      const s = Math.tanh(drive * x);

      // 2. wow & flutter — modulated fractional delay
      this.wowPhase += wowInc;
      if (this.wowPhase > 1) this.wowPhase -= 1;
      this.flutterPhase += flInc;
      if (this.flutterPhase > 1) this.flutterPhase -= 1;
      const wow = Math.sin(this.wowPhase * 2 * Math.PI);
      const flutter = Math.sin(this.flutterPhase * 2 * Math.PI);
      let delaySamp = ((6 + wow * 2 + flutter * fDepth * 4) / 1000) * this.sr;
      if (delaySamp < 1) delaySamp = 1;
      if (delaySamp > len - 2) delaySamp = len - 2;

      buf[this.w] = s;
      let rp = this.w - delaySamp;
      while (rp < 0) rp += len;
      const i0 = Math.floor(rp);
      const frac = rp - i0;
      const a = buf[i0 % len] ?? 0;
      const b = buf[(i0 + 1) % len] ?? 0;
      const delayed = a + (b - a) * frac;
      this.w = (this.w + 1) % len;

      let y = s * 0.7 + delayed * 0.3;

      // 3. high-frequency loss
      this.lp += lpCoeff * (y - this.lp);
      if (Math.abs(this.lp) < 1e-30) this.lp = 0; // denormal guard
      y = this.lp;

      outCh[i] = Number.isFinite(y) ? y : 0;
    }
    return true;
  }
}

registerProcessor('tape-warmth', TapeWarmthProcessor);
