/** Music helpers, pure. Used by the composer (and testable in isolation). */

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Arc-mapped tempo: the surface takes the DNA range's top, the deep end its floor —
 * the descent literally slows as the pressure builds. Pure, so the mapping is
 * testable and the engine only owns the smoothing.
 */
export function bpmAt(tempoRange: [number, number], position: number): number {
  const [lo, hi] = tempoRange;
  const p = Math.min(1, Math.max(0, position));
  return hi - (hi - lo) * p;
}

/**
 * Map a scale-degree walk to a MIDI pitch. `scale` is semitone offsets within an
 * octave (e.g. natural minor = [0,2,3,5,7,8,10]); negative/large degrees wrap with
 * octave shifts. `octaveBaseMidi` anchors degree 0.
 */
export function degreeToMidi(
  degree: number,
  scale: number[],
  keyCentre: number,
  octaveBaseMidi: number,
): number {
  const n = scale.length;
  if (n === 0) return octaveBaseMidi + keyCentre;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  const semis = scale[idx] ?? 0;
  return octaveBaseMidi + keyCentre + octave * 12 + semis;
}
