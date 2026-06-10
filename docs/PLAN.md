# Borland Descent — Improvement Plan

**Date:** 2026-06-10 · **Basis:** [REVIEW.md](./REVIEW.md) (finding ids H1–H5,
M1–M12, L1–L10 referenced throughout) · **Status: APPROVED 2026-06-10** (open
questions answered — see Decisions at the end). Amended same day with C-0
(scene visual identity, finding H5) per client direction: "significantly more
diversity in the visuals — all stylistically different."

## Ground rules carried into every workstream

- The Patch stays the single source of truth; everything the sequencer authors is
  zod-schema'd, versioned and round-trip tested.
- `packages/engine` stays framework-free (tone/three/zod only); all UI is React in
  `app/`, consuming engine APIs.
- One shared clock: the sequencer builds **on** the existing transport seam, not
  beside it.
- Audio-thread rules hold: no allocation, no console, no async in `process()`.
- **No new dependencies** are proposed in any workstream (one optional dev-only
  exception is flagged in §B for your call: `fake-indexeddb` to unit-test the
  sample store).
- Any change touching golden-rule files updates `docs/design-rationale.html` in the
  same change (CLAUDE.md rule).

## Priority overview

| Pri | Item | Workstream | Review ref |
|---|---|---|---|
| **P0** | Transport façade + lookahead sequencer core + schema + tests | A | L10, §2.4 |
| **P0** | Host master limiter + gain-staging fix | B | H1 |
| **P0** | Ramped (dezippered) crossfade + param writes | B | H2, M1 |
| **P0** | Single shared renderer; one composer; crossfade as a blend pass | C | H3 |
| **P0** | Scene visual identity: seven stylistically distinct looks per [ART-DIRECTION.md](./ART-DIRECTION.md); wire `scene.visualParams` + per-scene post overrides | C | H5 |
| **P1** | Sequencer studio UI (pattern editor) + port-target tracks | A | — |
| **P1** | Voice stealing + one voice budget across composer/sequencer | B | M4 |
| **P1** | In-worklet param smoothing; worklet nits | B | M2, L3, L4 |
| **P1** | Background policy: audio keeps playing, control keeps ticking | B (engine core) | M3 |
| **P1** | Performance instrumentation + auto-degrade ladder | C | M10, M5 |
| **P1** | DPR refresh on resize; WebGL2 fallback message | C | M6, M7 |
| **P1** | Safe-area insets + React error boundary | C (app) | H4, M7 |
| **P1** | Schema migration scaffold (lands with the sequencer's version bump) | A | M8 |
| **P2** | Synth port-registration helpers; shared GLSL chunks; midiToFreq | B / C | M12, L1 |
| **P2** | macros-per-frame cache; matrix Map reuse | B | L2 |
| **P2** | Crossfade build error logging; sampler dispose race; missing-sample UX | B | M11, L5, L9 |
| **P2** | cathedral.zip → extract usable WAV or delete; react-hooks lint | repo | L6, L7 |
| **P2** | Crossfade CPU staging (stagger incoming build) | B | M5 |

Explicitly deferred (out of scope, noted for honesty): data-driven
`audioGraph.connections` execution and multi-layer `visualGraph` (M9 — separate
initiative already underway), undo/redo (L8), resynthesis in a Worker, backend
PatchStore.

---

## Workstream A — Sequencer (new capability, highest priority)

### A1. Design

**Clock & scheduling — build on the existing transport (decision + rationale).**
Tone's transport *is* a lookahead scheduler driven by the audio clock (a
worker-pumped clock that hands callbacks exact `AudioContext` times ahead of the
play head — the composer already schedules sample-accurately through it, and
golden rule 5 mandates one clock). Building a second raw-`currentTime` scheduler
would duplicate BPM/pause/position handling and violate that rule. So:

- **`core/transport.ts` grows into the shared transport façade** (the interface
  both sequencer and visuals consume — defined before agents launch):

  ```ts
  interface TransportClock {
    readonly state: 'stopped' | 'started' | 'paused';
    bpm: number;                       // also exposed as port transport.bpm
    timeSignature: [number, number];   // new; default [4,4]
    readonly seconds: number;          // transport time (visuals read this)
    readonly position: { bar: number; beat: number; sixteenth: number };
    start(): void; pause(): void; stop(): void;
    /** Lookahead pump: cb(windowStartSec, windowEndSec) ahead of the playhead. */
    scheduleWindow(cb: (t0: number, t1: number) => void, intervalSec?: number): () => void;
  }
  ```

  Implementation wraps `Tone.getTransport()` (`scheduleRepeat` as the pump,
  interval ≈ 50 ms, window ≈ 150 ms). No `setTimeout` timing anywhere.

- **The sequencer core is pure and framework-free**
  (`packages/engine/src/sequencer/core.ts`): given (pattern, bpm, swing,
  windowStart, windowEnd, seeded rng) → the exact event times in that window.
  Loop-boundary handling, swing offsets, ratchets, probability draws — all pure
  maths, all unit-tested headlessly (this is the CI-testable surface the brief
  asks for). A thin `sequencer/scheduler.ts` binds the core to `TransportClock`
  and dispatches events (synth triggers with exact times; port writes at the
  event's frame).

**Pattern model (zod, serialised in the Patch).** Top-level `sequences` array
(sibling of `modulationMatrix`), `.default([])` so every existing patch loads:

```ts
SequenceSchema = {
  id, name?, enabled (default true),
  sceneId?: string,            // bound to a scene (runs/crossfades with it); absent = global
  division: int,               // steps per beat (e.g. 4 = 16ths in 4/4)
  length: int,                 // steps per loop, 1..64 — variable per track
  swing: unipolar (default 0), // delays off-steps up to half a step
  humanizeMs: number (default 0),
  target:
    | { kind: 'notes'; nodeId: 'voices' | 'bass' }   // existing synth nodes; extensible ids
    | { kind: 'port'; port: PortRef },               // any modulatable input port
  steps: Step[],
}
Step = {
  on: boolean, degree?: int,    // scale degree → degreeToMidi via scene scale/keyCentre
  octave?: int, velocity: unipolar (default 0.8),
  probability: unipolar (default 1),
  lengthSteps: number (default 1), ratchet?: int (default 1), tie?: boolean,
  value?: number,               // for port targets
}
```

Notes quantise through the **scene's** scale and key (reusing `degreeToMidi`),
so sequences stay harmonically inside each world; `meta.version` bumps to 2 and
the **migration scaffold** (`patch/migrate.ts`, `version→version` steps run
before zod parse) lands here, satisfying M8.

**Integration with the modulation model.** Each sequence registers in the
`SignalRegistry` as a source node: `seq<id>.gate` (trigger kind), `seq<id>.value`
(scalar, last fired step value), `seq<id>.velocity` (unipolar). Existing routes
can then take sequences anywhere the matrix reaches (sequence → bloom strength,
sequence → cutoff…), and port-target sequences write through the same
`SignalInput.write()` path the matrix uses — same smoothing, same clamping, same
destinations as modulators. Note sequences trigger the scene's synth modules and
**share the composer's voice budget** (see B-P1 voice stealing — the budget moves
to one place both consumers draw from).

**Determinism.** Each sequence forks its own RNG stream
(`hash(meta.seed, sequence.id)` + loop index) so probability outcomes reproduce
per seed and are independent of composer draw order — keeps the §8 determinism
story intact and makes the timing tests exact.

**UI separation.** `app/src/studio/SequencerPanel.tsx` (grid editor: step
toggles, per-step velocity/probability lanes, length/division/swing controls,
target picker fed by `engine.inputs()`/synth node ids). Edits flow exactly like
existing panels: patch update + live `engine.applySequences()` where possible,
reload token where structural. The engine never imports React; the panel never
touches Tone.

### A2. Deliverables & acceptance

- `packages/engine/src/sequencer/{core,scheduler,index}.ts`, transport façade,
  schema v2 + `migrate.ts`, registry integration.
- `packages/engine/test/sequencer.test.ts`: window-exact event times (incl.
  windows spanning loop boundaries), swing maths, probability under fixed seed,
  ratchets/ties, zero-allocation pump (no per-window arrays beyond the returned
  events), schema round-trip + v1→v2 migration.
- Player: sequences in the canonical patch audibly trigger in time with the
  generative bed; pause/stop/start clean; scene crossfade hands sequences over
  with their scene.
- `docs/design-rationale.html` updated (schema + transport are golden-rule
  surfaces).

---

## Workstream B — Sound engine

**P0 — correctness of the master path (H1, H2, M1).**
- Move the brick-wall stage to the host: `Engine.start()` builds
  `masterBus → glue? → Tone.Limiter(-1) → Destination`; per-scene chains keep
  their glue compressor but drop (or keep as safety, decision documented) the
  per-scene limiter. Two summed scenes can no longer exceed FS.
- `SceneInstance.setLevel` ramps instead of steps: `gain.setTargetAtTime(v, now, 0.03)`
  (or Tone `rampTo`); crossfade completes correctly even under dropped frames.
- One shared `smoothWrite(param, v, tc≈0.015)` helper used by every registry
  `write()` that targets an `AudioParam` (master gain, cutoffs, HP, shimmer,
  worklet params). Non-param writes (e.g. `poly.set`) keep matrix smoothing only.

**P1 — robustness under the sequencer's load.**
- **Voice stealing:** wrap the poly voices so the cap releases-oldest instead of
  dropping; single `VoiceBudget` consumed by composer *and* sequencer; replace
  the hardcoded `PAD_TAIL_STEPS` with the voice's live release port value.
- **Worklet:** per-block one-pole smoothing of all six params toward their
  AudioParam values; inline LCG replaces `Math.random()` hiss (deterministic,
  cheaper); per-context registration cache (L4).
- **Background policy (M3, decision for approval):** recommended — audio keeps
  playing when hidden; a 4 Hz `setInterval` fallback ticks
  `matrix.evaluateControl` + `advanceCrossfade` while rAF is stopped, so fades
  complete and modulation tracks; visuals stay paused. (Alternative: fade out and
  suspend — say the word and B implements that instead.)
- Crossfade failures logged (`console.warn`, M11); sampler bind guards disposed
  state (L5).

**P2 — cleanliness & headroom.**
- `registerLevelPort`/`registerCutoffPort`/`registerDetunePort` helpers beside
  `registerAdsrPorts`; all synths import `midiToFreq` from `core/music.ts` (L1,
  M12). Behaviour-neutral, verified by ear + existing tests.
- Per-frame arc-macro cache + reusable Map in `evaluateControlTargets` (L2).
- Stagger crossfade build cost (M5): build the incoming audio graph, then start
  composer/sequencer one pump-window later; measure before/after with C's
  instrumentation.
- Gain-staging pass documented in the rationale: target ≈ −6 dB programme into
  the host limiter.
- Optional (flagging per the no-new-deps rule): dev-only `fake-indexeddb` to test
  `SampleStore`. Skip if you'd rather not add it.

**Degraded paths** (brief checklist item): already good — worklet bypass, IR
fallback, patch fallback. B adds: WebAudio-unavailable → player veil shows a
clear unsupported message instead of hanging on "loading…".

---

## Workstream C — Visual engine

**P0 — scene visual identity (H5, client mandate).** All seven scenes currently
share one technique family (5-octave fbm wash), one copy-pasted grade, one
blue-teal palette and one drift motion — see REVIEW §4.4. C rebuilds each
scene's layer shader to its own designed identity per
[ART-DIRECTION.md](./ART-DIRECTION.md): each scene owns a distinct hue family,
compositional geometry, motion verb and luminance key (assigned axes:
caustic net / light shafts / refractive split / snow-and-silhouettes /
bioluminescent constellation / looming mass / vortex). Enablers built first:

- Wire `scene.visualParams` into the layer (merged over the global layer-node
  params) and add per-scene post overrides (bloom strength/radius/threshold,
  grain intensity) — un-deadens the schema (REVIEW §2.2) and lets each look
  own its grade.
- Delete the cloned fog/vignette/darkening footer from the shaders; each scene
  grades itself.
- Keep the `field.fog` / `field.flow` / `field.depth` port vocabulary on every
  layer (global matrix routes must keep working); up to 2 scene-specific ports
  each.

Acceptance: at 128 px thumbnails, any two scenes are instantly distinguishable
(different dominant hue + structure); each scene reads as a composed still
under `prefers-reduced-motion`; the descent's luminance still falls
monotonically surface→centre; per-scene screenshots captured in the verify
pass; frame budget held on the C-P1 instrumentation.

**P0 — one renderer (H3).** Refactor `VisualEngine` so the host owns a single
`WebGLRenderer` + `EffectComposer`; a scene contributes its shader layer (and
arc/uniform bindings) rather than a whole pipeline. Crossfade becomes a blend
uniform between the outgoing and incoming layer passes (equal time, one bloom,
one grain, one output pass) instead of two canvases + CSS opacity. Halves
transition GPU cost, ends context churn, and decouples render cost from scene
count. Port handover semantics (§18.2 registry swap) unchanged — C consumes the
registry read-only.

**P1 — measure, adapt, fail gracefully.**
- Instrumentation: frame-time EMA + dropped-frame counter inside the engine loop
  (zero-dep, ~40 lines), exposed as a `perf.frameMs` output port and a small
  studio readout; render-rate is already decoupled from audio (audio state
  arrives via the registry snapshot) — keep it that way and document it.
- Auto-degrade ladder on sustained over-budget (>24 ms EMA for >2 s):
  DPR 2 → 1.5 → 1, then bloom off; restore on recovery. Logged once per step.
- DPR re-read in `resize()` (M6); WebGL2 capability check at construction with a
  styled fallback message in the container (M7).
- `touch-action: none` on the canvas container + on-device pinch verification.
- Object pooling audit: the loop is already allocation-light; pool the remaining
  per-frame objects C introduces (blend pass uniforms etc.). rAF already pauses
  when hidden (stays).

**P1 (app-side, owned by C to keep ownership clean).**
- Safe-area insets (H4): `env(safe-area-inset-*)` on `.player`, `.veil`,
  scene-name block; `viewport-fit=cover` meta.
- React error boundary around both views with a minimal recover/reload UI.

**P2 —** shared GLSL chunk module (hash/noise/fbm + vertex shader) imported by
all seven shaders; consolidate `num()` helpers; keep shader behaviour
pixel-identical (verified by eye against each scene).

---

## Phase 3 shape (preview — executed only after approval)

- **Shared interfaces defined first** (by me, before agents launch):
  `TransportClock`, the sequencer schema, `smoothWrite`, and the
  `VisualEngine`-host contract — committed as a tiny interfaces change so no
  agent drifts.
- **Ownership:** A owns `sequencer/`, `core/transport.ts`, `patch/*`,
  `SequencerPanel.tsx`, its tests. B owns `audio/**` + `sceneInstance` audio
  surface. C owns `visual/**` + `sceneInstance`/player visual surface + app CSS.
  `core/engine.ts` is shared: each workstream gets named insertion points in its
  task spec; I resolve overlaps in the integration pass.
- **Branches:** one per workstream off a clean `main`; integration branch for the
  final pass (typecheck/lint/test/build + end-to-end run: transport plays,
  sequences trigger sound, visuals respond), then `docs/CHANGELOG.md`.
- **Precondition:** the current uncommitted work (samples, resynthesis, voxChoir,
  hall IR, studio panel) should be committed first so workstream branches have a
  stable base — see open question 3.

## Decisions (approved 2026-06-10)

1. **Sequences are scene-bound by default** (`sceneId` set on authoring;
   global sequences remain possible via the schema).
2. **Background policy: keep audio playing when hidden**, with a low-rate
   (≈4 Hz) fallback tick driving `matrix.evaluateControl` + crossfade advance
   while rAF is stopped; visuals stay paused. CLAUDE.md's budget note will be
   updated to match.
3. **In-flight samples/resynthesis work: commit before Phase 3** branches off.
4. **cathedral.zip: extract the WAV, convert to a lean format, wire it** into
   the reverb node's `ir`, keep attribution, and never commit the zip.
