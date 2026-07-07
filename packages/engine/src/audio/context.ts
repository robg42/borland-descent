import * as Tone from 'tone';

/**
 * One shared AudioContext for the whole page (Safari caps ~4 per page). Tone owns it —
 * we never `new AudioContext()` alongside. It must be unlocked from a user gesture, and
 * on iOS may need re-unlocking after backgrounding ("tap to resume").
 */
export async function unlockAudio(): Promise<void> {
  await Tone.start(); // resume Tone's context inside the user gesture
  const ctx = Tone.getContext();
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      /* iOS can refuse outside a gesture; the player offers a tap-to-resume */
    }
  }
  // Some iOS versions need an actual sound played within the gesture to open the audio
  // output — resume() alone is not enough. A one-sample silent buffer primes it.
  try {
    const raw = ctx.rawContext as unknown as AudioContext;
    const source = raw.createBufferSource();
    source.buffer = raw.createBuffer(1, 1, raw.sampleRate);
    source.connect(raw.destination);
    source.start(0);
  } catch {
    /* best-effort: not all contexts expose the raw node API */
  }
}

/** Raw context state: 'suspended' | 'running' | 'closed' | 'interrupted' (iOS). */
export function audioContextState(): string {
  return Tone.getContext().state;
}

export function isAudioRunning(): boolean {
  return Tone.getContext().state === 'running';
}

/**
 * Monitor mute — silences Tone's destination without touching the Patch. This is
 * EPHEMERAL monitor state (like a mixing desk's monitor cut), deliberately not
 * authored data: saves never carry it, and it survives engine rebuilds because
 * the destination node is Tone's page-wide singleton.
 */
export function setMonitorMuted(muted: boolean): void {
  Tone.getDestination().mute = muted;
}

export function isMonitorMuted(): boolean {
  return Tone.getDestination().mute;
}

/** Attempt to resume after an interruption/background. May fail on iOS Safari. */
export async function resumeAudio(): Promise<boolean> {
  try {
    await Tone.getContext().resume();
    return isAudioRunning();
  } catch {
    return false;
  }
}
