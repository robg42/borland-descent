import { sampleStore, type SampleEntry } from '../sampleStore';
import { encodeWav } from './wav';
import { paulStretch, granular, type Progress } from './transforms';

/** A resynthesis transform — offline; produces a new derived sample from an existing one. */
export type ResynthSpec =
  | { kind: 'paulstretch'; stretch: number; windowSec?: number }
  | { kind: 'granular'; stretch: number; grainMs?: number; jitterMs?: number; pitch?: number };

export type { Progress } from './transforms';
export { paulStretch, granular } from './transforms';
export { encodeWav } from './wav';

function readChannels(buf: AudioBuffer): Float32Array[] {
  const chs: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  return chs;
}

/** Cap output to ~90 s so an extreme stretch of a long sample can't blow up memory. */
const MAX_OUT_SEC = 90;

/**
 * Resynthesise a stored sample into a NEW derived sample (offline) and add it to the
 * store, persisted like any other sample. Returns the new entry (or undefined if the
 * source is missing). The transform runs in chunks, reporting progress and yielding so
 * the studio stays responsive; the result is just another sample the sampler can play.
 */
export async function resynthesizeSample(
  sourceId: string,
  spec: ResynthSpec,
  onProgress?: Progress,
): Promise<SampleEntry | undefined> {
  const src = await sampleStore.load(sourceId);
  const audio = src?.buffer.get();
  if (!src || !audio) return undefined;

  const channels = readChannels(audio);
  const sr = audio.sampleRate;
  const inDur = audio.length / sr;
  const stretch = Math.min(spec.stretch, Math.max(1, MAX_OUT_SEC / Math.max(0.01, inDur)));

  const result =
    spec.kind === 'paulstretch'
      ? await paulStretch(channels, sr, { stretch, windowSec: spec.windowSec ?? 0.25 }, onProgress)
      : await granular(
          channels,
          sr,
          { stretch, grainMs: spec.grainMs ?? 80, jitterMs: spec.jitterMs ?? 20, pitch: spec.pitch ?? 0 },
          onProgress,
        );

  const wav = encodeWav(result, sr);
  return sampleStore.add(`${src.name} · ${spec.kind} ×${Math.round(stretch)}`, src.rootMidi, wav);
}
