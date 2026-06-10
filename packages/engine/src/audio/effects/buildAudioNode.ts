import * as Tone from 'tone';
import { makePortRef } from '../../core/ports';
import { clamp } from '../../core/curves';
import type { SignalRegistry } from '../../core/registry';
import type { AudioGraphNode, Scalar } from '../../patch/schema';
import type { SynthModule } from '../synths/types';
import type { Analysers } from '../analysers';
import { TapeWarmth } from './tapeWarmth';
import { generateHallIR } from './hallIR';
import { smoothWrite } from '../smoothWrite';

/** The uniform contract every built audio-graph node exposes. */
export interface BuiltNode {
  /** Entry point for incoming connections (null for source nodes like LFO). */
  input: Tone.ToneAudioNode | null;
  /** Exit point for outgoing connections (null for sink nodes like analysers). */
  output: Tone.ToneAudioNode | null;
  /** Async init — call and await before wiring connections. May be undefined. */
  init?: () => Promise<void>;
  /** Called after wiring for nodes that must start producing signal (LFO, etc.). */
  start?: () => void;
  /** Register all ports for this node into the registry. */
  registerPorts(nodeId: string, registry: SignalRegistry, params: Record<string, Scalar>): void;
  dispose(): void;
}

function num(params: Record<string, Scalar>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

// ---- per-kind builders -------------------------------------------------------

function buildSynth(synth: SynthModule): BuiltNode {
  return {
    input: null,
    output: synth.output,
    registerPorts(nodeId, registry, params) {
      synth.registerPorts(nodeId, registry, params);
    },
    dispose() {}, // synth is owned by AudioEngine; it disposes it separately
  };
}

function buildBus(params: Record<string, Scalar>): BuiltNode {
  const gain = new Tone.Gain(num(params, 'gain', 1));
  return {
    input: gain,
    output: gain,
    registerPorts(nodeId, registry, p) {
      registry.addInput(makePortRef(nodeId, 'gain'), {
        kind: 'unipolar',
        base: gain.gain.value,
        min: 0,
        max: 1.5,
        write: (v) => { smoothWrite(gain.gain, clamp(v, 0, 1.5)); },
        audioTarget: gain.gain,
      });
      void p; // params applied at construction
    },
    dispose() { gain.dispose(); },
  };
}

function buildPitchDrift(params: Record<string, Scalar>): BuiltNode {
  const vibrato = new Tone.Vibrato({
    frequency: num(params, 'frequency', 0.13),
    depth: num(params, 'depth', 0.22),
    maxDelay: num(params, 'maxDelay', 0.02),
    type: 'sine',
  });
  return {
    input: vibrato,
    output: vibrato,
    registerPorts(nodeId, registry) {
      registry.addInput(makePortRef(nodeId, 'depth'), {
        kind: 'unipolar',
        base: vibrato.depth.value,
        min: 0,
        max: 1,
        write: (v) => { smoothWrite(vibrato.depth, clamp(v, 0, 1)); },
        audioTarget: vibrato.depth,
      });
    },
    dispose() { vibrato.dispose(); },
  };
}

function buildHighpass(params: Record<string, Scalar>): BuiltNode {
  const filter = new Tone.Filter({
    type: 'highpass',
    frequency: num(params, 'frequency', 280),
    Q: 0.5,
  });
  return {
    input: filter,
    output: filter,
    registerPorts(nodeId, registry, p) {
      registry.addInput(makePortRef(nodeId, 'frequency'), {
        kind: 'scalar',
        base: num(p, 'frequency', 280),
        min: 20,
        max: 2000,
        write: (v) => { smoothWrite(filter.frequency, clamp(v, 20, 2000)); },
        audioTarget: filter.frequency,
      });
    },
    dispose() { filter.dispose(); },
  };
}

function buildReverb(params: Record<string, Scalar>, ir?: string): BuiltNode {
  const reverbSize = num(params, 'size', 0.5);
  const reverb = new Tone.Convolver();
  return {
    input: reverb,
    output: reverb,
    async init() {
      reverb.buffer = Tone.ToneAudioBuffer.fromArray(
        generateHallIR(Tone.getContext().sampleRate, 1.4 + reverbSize * 7, 0.012 + reverbSize * 0.03),
      );
      if (ir) {
        try {
          await reverb.load(ir);
        } catch (err) {
          console.warn('[borland] reverb IR failed to load; using the generated hall.', err);
        }
      }
    },
    registerPorts() { /* no exposed controls */ },
    dispose() { reverb.dispose(); },
  };
}

function buildShimmer(params: Record<string, Scalar>): BuiltNode {
  const pitch = new Tone.PitchShift({
    pitch: num(params, 'pitch', 12),
    windowSize: num(params, 'windowSize', 0.1),
    feedback: num(params, 'feedback', 0.35),
    wet: 1,
  });
  const shimmerReverb = new Tone.Reverb({ decay: num(params, 'decay', 5), wet: 1 });
  const out = new Tone.Gain(num(params, 'level', 0.22));
  pitch.connect(shimmerReverb);
  shimmerReverb.connect(out);
  return {
    input: pitch,
    output: out,
    async init() {
      await shimmerReverb.ready;
    },
    registerPorts(nodeId, registry, p) {
      registry.addInput(makePortRef(nodeId, 'level'), {
        kind: 'unipolar',
        base: out.gain.value,
        min: 0,
        max: 1.5,
        write: (v) => { smoothWrite(out.gain, clamp(v, 0, 1.5)); },
        audioTarget: out.gain,
      });
      registry.addInput(makePortRef(nodeId, 'feedback'), {
        kind: 'unipolar',
        base: num(p, 'feedback', 0.35),
        min: 0,
        max: 0.9,
        write: (v) => { smoothWrite(pitch.feedback, clamp(v, 0, 0.9)); },
        audioTarget: pitch.feedback,
      });
    },
    dispose() {
      pitch.dispose();
      shimmerReverb.dispose();
      out.dispose();
    },
  };
}

function buildTapeWarmth(params: Record<string, Scalar>): BuiltNode {
  let tape: TapeWarmth | null = null;
  const fallback = new Tone.Gain(1);
  let useFallback = false;
  return {
    get input() { return useFallback ? fallback : (tape?.input ?? fallback); },
    get output() { return useFallback ? fallback : (tape?.output ?? fallback); },
    async init() {
      try {
        tape = new TapeWarmth(params);
        await tape.init();
      } catch (err) {
        console.warn('[borland] tape-warmth worklet unavailable; bypassing.', err);
        tape = null;
        useFallback = true;
      }
    },
    registerPorts(nodeId, registry) {
      tape?.registerPorts(nodeId, registry);
    },
    dispose() {
      tape?.dispose();
      fallback.dispose();
    },
  };
}

function buildCompressor(params: Record<string, Scalar>): BuiltNode {
  const comp = new Tone.Compressor({
    threshold: num(params, 'threshold', -18),
    ratio: num(params, 'ratio', 2),
    attack: num(params, 'attack', 0.03),
    release: num(params, 'release', 0.25),
    knee: 8,
  });
  return {
    input: comp,
    output: comp,
    registerPorts() { /* threshold/ratio/attack/release could be ports; deferred */ },
    dispose() { comp.dispose(); },
  };
}

function buildLimiter(params: Record<string, Scalar>): BuiltNode {
  const limiter = new Tone.Limiter(num(params, 'threshold', -1));
  return {
    input: limiter,
    output: limiter,
    registerPorts() { },
    dispose() { limiter.dispose(); },
  };
}

function buildLfo(params: Record<string, Scalar>): BuiltNode {
  const lfo = new Tone.LFO({
    frequency: num(params, 'frequency', 0.1),
    min: num(params, 'min', -220),
    max: num(params, 'max', 220),
    type: 'sine',
  });
  return {
    input: null,
    output: lfo,
    start() { lfo.start(); },
    registerPorts(nodeId, registry) {
      registry.addOutput(makePortRef(nodeId, 'out'), {
        kind: 'bipolar',
        read: () => 0, // audio-rate; control reads not meaningful for raw LFO
        audioNode: lfo,
      });
    },
    dispose() { lfo.dispose(); },
  };
}

function buildAnalyserMeter(meter: Tone.Meter, readFn: () => number): BuiltNode {
  return {
    input: meter,
    output: null,
    registerPorts(nodeId, registry) {
      registry.addOutput(makePortRef(nodeId, 'level'), {
        kind: 'unipolar',
        read: readFn,
      });
    },
    dispose() { /* owned by Analysers */ },
  };
}

function buildAnalyserFft(analysers: Analysers): BuiltNode {
  return {
    input: analysers.fft,
    output: null,
    registerPorts(_nodeId, registry) {
      registry.addOutput(makePortRef('fft', 'low'), { kind: 'unipolar', read: () => analysers.readBand(0, 0.18) });
      registry.addOutput(makePortRef('fft', 'mid'), { kind: 'unipolar', read: () => analysers.readBand(0.18, 0.5) });
      registry.addOutput(makePortRef('fft', 'high'), { kind: 'unipolar', read: () => analysers.readBand(0.5, 1) });
      for (let b = 0; b < 8; b++) {
        const bi = b;
        registry.addOutput(makePortRef('audio', `band${b + 1}`), {
          kind: 'unipolar',
          read: () => analysers.readFeatureBand(bi),
        });
      }
      registry.addOutput(makePortRef('audio', 'flux'), { kind: 'unipolar', read: () => analysers.readFlux() });
      registry.addOutput(makePortRef('audio', 'onset'), { kind: 'trigger', read: () => analysers.readOnset() });
    },
    dispose() { /* owned by Analysers */ },
  };
}

// ---- dispatcher ---------------------------------------------------------------

/**
 * Build a Tone audio node from a patch AudioGraphNode spec. Synth nodes ('voices',
 * 'bass') must be pre-created and passed in — they are long-lived and not rebuilt
 * here. The caller awaits `init()` and calls `start()` after wiring connections.
 */
export function buildAudioNode(
  node: AudioGraphNode,
  synths: { voices: SynthModule; bass: SynthModule },
  analysers: Analysers,
): BuiltNode {
  const p = node.params;

  if (node.kind === 'synthModule') {
    const synth = node.id === 'bass' ? synths.bass : synths.voices;
    return buildSynth(synth);
  }

  if (node.kind === 'bus' || node.kind === 'master') {
    return buildBus(p);
  }

  if (node.kind === 'lfo') {
    return buildLfo(p);
  }

  if (node.kind === 'analyser') {
    if (node.moduleId === 'fft' || node.id === 'fft') return buildAnalyserFft(analysers);
    if (node.id === 'masterMeter') return buildAnalyserMeter(analysers.masterMeter, () => analysers.readMaster());
    if (node.id === 'bassMeter') return buildAnalyserMeter(analysers.bassMeter, () => analysers.readBass());
    // unknown analyser: passthrough stub
    return buildBus(p);
  }

  if (node.kind === 'effect') {
    switch (node.moduleId) {
      case 'pitchDrift':   return buildPitchDrift(p);
      case 'reverb':       return buildReverb(p, node.ir);
      case 'highpass':     return buildHighpass(p);
      case 'shimmer':      return buildShimmer(p);
      case 'tapeWarmth':   return buildTapeWarmth(p);
      case 'compressor':   return buildCompressor(p);
      case 'limiter':      return buildLimiter(p);
    }
  }

  if (node.kind === 'composer') {
    // Composer drives the synths via Tone.Part scheduling, not via audio connections.
    // It's wired into the engine separately — return a no-op placeholder.
    return {
      input: null,
      output: null,
      registerPorts() {},
      dispose() {},
    };
  }

  // Unknown kind/moduleId — passthrough gain so connections don't break.
  console.warn(`[borland] unknown audio node kind="${node.kind}" moduleId="${node.moduleId ?? ''}" — bypassing`);
  return buildBus(p);
}
