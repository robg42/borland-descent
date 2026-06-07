/** Music helpers, pure. Used by the composer (and testable in isolation). */

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
