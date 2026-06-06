import * as Tone from 'tone';

/**
 * One shared AudioContext for the whole page (Safari caps ~4 per page). Tone owns
 * it — we never `new AudioContext()` alongside. It must be unlocked from a user
 * gesture, and on iOS may need re-unlocking after backgrounding ("tap to resume").
 */
export async function unlockAudio(): Promise<void> {
  await Tone.start();
}

/** Raw context state: 'suspended' | 'running' | 'closed' | 'interrupted' (iOS). */
export function audioContextState(): string {
  return Tone.getContext().state;
}

export function isAudioRunning(): boolean {
  return Tone.getContext().state === 'running';
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
