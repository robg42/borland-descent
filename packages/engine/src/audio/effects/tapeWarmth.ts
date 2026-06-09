import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';

const PROCESSOR = 'tape-warmth';
let moduleRegistered = false;

/**
 * Tone wrapper around the tape-warmth AudioWorklet. Runs in TRUE STEREO — L/R wow &
 * flutter are decorrelated, so the wet bus keeps its width through the tape (without
 * this the whole wet path collapses to mono). Sits on the wet bus between the reverb
 * and the master. Exposes drive / hfCutoff / flutterDepth as modulatable
 * ports (the worklet's AudioParams are both control-writable and audio-rate
 * connectable). If the worklet module fails to load, the audio engine routes around
 * it — the experience still runs (brief: don't rabbit-hole on the worklet).
 */
export class TapeWarmth {
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private node: AudioWorkletNode | null = null;

  constructor(private readonly params: Record<string, Scalar>) {}

  static async register(): Promise<void> {
    if (moduleRegistered) return;
    const url = new URL('./worklets/tapeWarmth.worklet.js', import.meta.url);
    // Use Tone's context helpers, NOT rawContext.audioWorklet — Tone v15 wraps the
    // context (standardized-audio-context), so the native AudioWorkletNode and
    // rawContext.audioWorklet.addModule reject the wrapped context.
    await Tone.getContext().addAudioWorkletModule(url.href);
    moduleRegistered = true;
  }

  async init(): Promise<void> {
    await TapeWarmth.register();
    this.node = Tone.getContext().createAudioWorkletNode(PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    Tone.connect(this.input, this.node);
    Tone.connect(this.node, this.output);

    this.setParam('drive', num(this.params.drive, 1.4));
    this.setParam('flutterDepth', num(this.params.flutterDepth, 0.15));
    this.setParam('flutterRate', num(this.params.flutterRate, 4));
    this.setParam('hfCutoff', num(this.params.hfCutoff, 7000));
    this.setParam('hiss', num(this.params.hiss, 0.0015));
    this.setParam('crush', num(this.params.crush, 12));
  }

  private getParam(name: string): AudioParam | undefined {
    return this.node?.parameters.get(name);
  }
  private setParam(name: string, value: number): void {
    const p = this.getParam(name);
    if (p) p.value = value;
  }

  registerPorts(nodeId: string, registry: SignalRegistry): void {
    const drive = this.getParam('drive');
    if (drive) {
      registry.addInput(makePortRef(nodeId, 'drive'), {
        kind: 'scalar',
        base: drive.value,
        min: 0.1,
        max: 10,
        write: (v) => {
          drive.value = clamp(v, 0.1, 10);
        },
        audioTarget: drive,
      });
    }
    const hf = this.getParam('hfCutoff');
    if (hf) {
      registry.addInput(makePortRef(nodeId, 'hfCutoff'), {
        kind: 'scalar',
        base: hf.value,
        min: 500,
        max: 18000,
        write: (v) => {
          hf.value = clamp(v, 500, 18000);
        },
        audioTarget: hf,
      });
    }
    const flutter = this.getParam('flutterDepth');
    if (flutter) {
      registry.addInput(makePortRef(nodeId, 'flutterDepth'), {
        kind: 'unipolar',
        base: flutter.value,
        min: 0,
        max: 0.6,
        write: (v) => {
          flutter.value = clamp(v, 0, 0.6);
        },
        audioTarget: flutter,
      });
    }
    const hiss = this.getParam('hiss');
    if (hiss) {
      registry.addInput(makePortRef(nodeId, 'hiss'), {
        kind: 'unipolar',
        base: hiss.value,
        min: 0,
        max: 0.05,
        write: (v) => {
          hiss.value = clamp(v, 0, 0.05);
        },
        audioTarget: hiss,
      });
    }
    const crush = this.getParam('crush');
    if (crush) {
      registry.addInput(makePortRef(nodeId, 'crush'), {
        kind: 'scalar',
        base: crush.value,
        min: 4,
        max: 16,
        write: (v) => {
          crush.value = clamp(v, 4, 16);
        },
        audioTarget: crush,
      });
    }
  }

  dispose(): void {
    this.node?.disconnect();
    this.input.dispose();
    this.output.dispose();
  }
}

function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
