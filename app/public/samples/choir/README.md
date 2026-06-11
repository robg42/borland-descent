# Choir samples

Drop multisample WAV or MP3 files here. Recommended source: **VCSL** or **VSCO2 Community Edition** (both CC0).

Tone.Sampler expects files named by MIDI note name:

```
C2.wav  Eb2.wav  G2.wav  Bb2.wav
C3.wav  Eb3.wav  G3.wav  Bb3.wav
C4.wav  Eb4.wav  G4.wav  Bb4.wav
```

Every ~3 semitones is enough; Tone interpolates between them.
Flat names only (Eb not D#). Use A4 = 440 Hz tuning.

The engine will look for these files automatically once you register
the folder path in the patch's sampler voice node.
