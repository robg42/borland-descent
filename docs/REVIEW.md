# Borland Descent — Codebase Review

**Date:** 2026-06-10 · **Scope:** full working tree as it stands (including the
uncommitted samples/resynthesis work) · **Reviewer role:** senior audio software
engineer, pre-production upgrade pass.

**Method:** every file under `packages/engine/src` was read directly; the app layer,
visual pipeline and repo hygiene were additionally swept by three independent
read-only audits; `npm run check` was executed (typecheck + lint + 31 tests — all
green) and the CI workflow inspected.

---

## 1. Architecture summary

```
patches/borland.json ──fetch──▶ JsonPatchStore ──zod──▶ Patch (single source of truth)
                                                          │
            app (Vite + React 19)                         ▼
            ┌──────────────────────────┐        ┌──────────────────────────────┐
  '/'   ──▶ │ PlayerView   useEngine() │──new──▶│ Engine (HOST)                │
  '/studio' │ StudioView   (StrictMode-│        │  · Transport (Tone lookahead)│
            │  safe create/dispose)    │        │  · GestureController         │
            └──────────────────────────┘        │  · SignalRegistry (ports)    │
                                                │  · Matrix (modulation)       │
                                                │  · master Gain → Destination │
                                                │  · rAF frame loop            │
                                                └──────┬───────────────────────┘
                                                       │ 1 active (+1 incoming
                                                       ▼   during §18.2 crossfade)
                                          ┌─────────────────────────┐
                                          │ SceneInstance           │
                                          │  ├ AudioEngine          │
                                          │  │   pad synth ─ drift ─ wetBus ─ HP ─ Convolver ─ TapeWarmth(worklet) ─ master
                                          │  │   pad ─ padDry ──────────────────────────────────────────────────────▶ master
                                          │  │   wetBus ─ PitchShift(shimmer) ─ Reverb ─────────────────────────────▶ master
                                          │  │   subBass ─ dryBus ──────────────────────────────────────────────────▶ master
                                          │  │   master ─ glue Compressor ─ Limiter(-1 dB) ─▶ scene Gain ─▶ HOST master
                                          │  │   analysers (Meter ×2, FFT 64) tap pre-glue
                                          │  │   Composer: Tone.Loop @ subdivision → decideStep (pure, seeded) → trigger(time)
                                          │  └ VisualEngine
                                          │      own WebGLRenderer + EffectComposer:
                                          │      scene shader layer → UnrealBloom → grain → OutputPass
                                          └─────────────────────────┘

Modulation: control-rate routes evaluated per rAF frame (evaluate.ts pure fn →
Matrix smoothing → input.write()); audio-rate routes wired once as native
Tone connections (LFO → Gain(amount) → AudioParam). Gesture (pinch/drag/wheel)
→ arc position → scene selection (sticky ranges) + arc.* macro source ports.
Persistence: Patch JSON via PatchStore (fetch + studio download/upload);
sample binaries via SampleStore (IndexedDB), referenced from the Patch by id only.
```

**What is genuinely good** (worth saying before the issues): strict TypeScript
everywhere (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); zero
`any`/`@ts-ignore` in the tree; the engine boundary (tone/three/zod only) is
enforced twice (package.json + ESLint `no-restricted-imports`); the Patch is
schema-first zod with a forward-compatible loose object and a tested lossless
round-trip; the React lifecycle is StrictMode/HMR-safe by construction
([useEngine.ts](../app/src/engineReact/useEngine.ts)); the worklet DSP is
allocation-free with denormal and NaN guards; composer note scheduling is
sample-accurate (exact times passed through Tone's lookahead transport); CI runs
typecheck + lint + test + build on every push/PR. This is a healthy codebase —
the findings below are the gap between "healthy" and "production".

---

## 2. Code quality issues

### 2.1 Duplication (the biggest cleanliness issue)

| What | Where | Scale |
|---|---|---|
| `midiToFreq` redefined locally per synth while [core/music.ts:3](../packages/engine/src/core/music.ts) exports an unused copy | all 10 files in `audio/synths/` | 10 copies |
| level / cutoff / detune port-registration blocks (identical shape, different bounds) | driftPad, leviathan, voxChoir, sampler, subBass, glassBells, refractPad, duskStrings, pressureDrone, voidChoir | ~15 lines × 10 |
| `num()` scalar-param helper | duplicated in [audioEngine.ts:17](../packages/engine/src/audio/audioEngine.ts), [tapeWarmth.ts:140](../packages/engine/src/audio/effects/tapeWarmth.ts), [visualEngine.ts:210](../packages/engine/src/visual/visualEngine.ts), every shader module; `numParam` in synths/types.ts is the same thing | ~10 copies |
| GLSL `hash`/`noise`/`fbm` + the identical vertex shader | all 7 files in `visual/shaders/` | 7 copies |

`registerAdsrPorts` ([synths/types.ts:55](../packages/engine/src/audio/synths/types.ts))
shows the right pattern — it just needs siblings (`registerLevelPort`,
`registerCutoffPort`, …) and a shared GLSL chunk module. None of this is
behaviour-affecting today, but Workstream A will add more port-registering
modules, so consolidating first reduces the surface it must conform to.

### 2.2 Schema promises more than the engine implements

- `visualGraph.layers` supports N layers with `blendMode`/`opacity`; the engine
  uses `layers[0]` only ([visualEngine.ts:109](../packages/engine/src/visual/visualEngine.ts)).
- `audioGraph.connections` describes a routing graph; `AudioEngine.build()`
  hardcodes the topology and reads only node `params`. The connections array is
  effectively documentation (it is accurate documentation — verified against the
  built graph — but nothing enforces that).
- **`scene.visualParams` is parsed but never read.** `VisualEngine` takes its
  layer params from the single global `visualGraph.layers[0]` node and its
  bloom/grain settings from the global `postChain` nodes
  ([visualEngine.ts:109-148](../packages/engine/src/visual/visualEngine.ts));
  `opts.scene.visualParams` is never consulted (and is `{}` for every scene in
  the canonical patch). Per-scene visual tuning is therefore structurally
  impossible today — a direct cause of H5 below.

This is a known, deliberate v1 seam (the data-driven graph is a separate
initiative), but it is the kind of drift that misleads contributors and it
matters for the sequencer: **new authored state must be real state**, not
aspirational schema.

### 2.3 Smaller items

- Silent failure swallow: `beginCrossfade`'s `catch { this.abortCrossfade(); }`
  ([engine.ts:195](../packages/engine/src/core/engine.ts)) discards the error
  entirely — a scene that fails to build aborts the transition with no log.
- `TapeWarmth.register()` caches `moduleRegistered` in module scope
  ([tapeWarmth.ts:8](../packages/engine/src/audio/effects/tapeWarmth.ts)); if the
  AudioContext is ever replaced (tests, future close/reopen), the flag goes stale
  and `createAudioWorkletNode` throws. Cache per-context instead.
- `sampler.bindSample` resolves an async load with no disposed guard
  ([sampler.ts:42](../packages/engine/src/audio/synths/sampler.ts)) — a race if
  the scene is swapped before the sample decodes.
- ESLint has no `react-hooks` plugin, so `exhaustive-deps` is unchecked in the
  app (the deliberate ref-pattern in `useEngine` would need one targeted disable).
- No TODO/FIXME debt, no debug `console.log`s — all engine console output is
  intentional `[borland]`-prefixed degradation warnings. Good.

### 2.4 Untested logic

The pure-logic gate (5 files, 31 tests) covers rng, decide, arc, curves,
matrix control path, patch round-trip, resynthesis DSP. **Not covered at all:**

- `Engine`'s crossfade state machine (begin/advance/complete/abort) — the most
  intricate stateful logic in the repo, currently only testable in a browser
  because it lives next to Tone/raF. Extracting the fade math + state into a pure
  helper would make it CI-testable.
- `degreeToMidi` (music.ts), `clampToKind`/`parsePortRef` edge cases,
  `smoothingCoeff`, gesture mapping math, `generateHallIR` (finiteness/shape),
  `SampleStore` (testable with fake-indexeddb), `evaluateControlTargets`'s
  multi-route-sum + base interaction (only partially exercised).
- There are **no scheduler timing tests** because there is no scheduler —
  Workstream A's core must arrive with them (it is the most testable new code).

---

## 3. Audio engine assessment

### 3.1 Scheduling & latency — sound

The composer is the right shape: a `Tone.Loop` at the scene's subdivision calls a
pure, seeded `decideStep`, and triggers synths with **exact transport times**
(`composer.ts:36-40`) — sample-accurate through Tone's worker-driven lookahead
clock. There is no `setTimeout` timing anywhere in the audio path. Latency is
Tone's default lookahead (~100 ms), fine for an ambient, non-percussive piece —
a future sequencer with rhythmic material should keep this architecture and
simply tighten/own the windowing.

Limitations: BPM is fixed once at the midpoint of `dna.tempoRange`
([engine.ts:85](../packages/engine/src/core/engine.ts)); there is no time
signature, no bar/beat position surface, and `Transport.stop()` calls the global
`Tone.getTransport().cancel()` — single-engine-safe, but it is a thin global
wrapper rather than an owned clock; the sequencer workstream needs to formalise it.

### 3.2 Glitch risks — the two real bugs

1. **The host master bus has no limiter.** `Engine.start()` builds
   `masterBus = new Tone.Gain(1)` straight into the destination
   ([engine.ts:261](../packages/engine/src/core/engine.ts)). Each scene limits
   itself at −1 dBFS *before* its scene gain — and
   [audioEngine.ts:148-150](../packages/engine/src/audio/audioEngine.ts) explicitly
   says the limiter should move to the host "when crossfades land". Crossfades
   landed; the limiter didn't move. During a crossfade two −1 dBFS programmes sum
   on an unprotected bus (worst case ≈ +2 dB over full scale at mid-fade) —
   audible clipping on exactly the material (dense, reverb-heavy) this piece
   produces. **Severity: High.**

2. **Crossfade gains are stepped, not ramped.** `SceneInstance.setLevel` writes
   `sceneGain.gain.value = v` once per rAF frame
   ([sceneInstance.ts:94](../packages/engine/src/core/sceneInstance.ts)). At a
   steady 60 fps that's a 16 ms staircase (borderline); under the *doubled*
   audio+visual load of a crossfade, frames drop and the staircase becomes
   audible zipper/level-jumps — and if the tab is hidden mid-fade the rAF loop
   stops entirely, freezing the fade at half level while audio keeps playing
   (see 3.5). Use `setTargetAtTime`/linear ramps toward the per-frame target.
   **Severity: High.**

### 3.3 Parameter smoothing / dezippering — partial

The Matrix smooths *values* per frame (exponential, max-smoothing-per-target —
nice, deterministically tested), but every `write()` then sets
`AudioParam.value` directly (master gain, cutoffs, HP frequency, shimmer
feedback, worklet params, …). Value-smoothing at frame rate caps step *size*,
but each write is still an instantaneous param jump 60×/s — fine for slow
routes (smoothing ≥ 100 ms), marginal for fast ones (`r2` zoom→cutoff at 80 ms
while pinching), and it will not survive the sequencer driving ports at step
rate. A single shared `writeSmoothed(param, v)` helper using
`setTargetAtTime(v, now, ~0.015)` fixes the whole class at the registry level.

In the worklet, all six params are declared `k-rate` and read once per 128-sample
block with **no internal smoothing**
([tapeWarmth.worklet.js:11-16](../packages/engine/src/audio/effects/worklets/tapeWarmth.worklet.js))
— modulated `hfCutoff`/`drive` step per block. A per-block one-pole toward the
incoming value is ~6 lines and removes the zipper.

### 3.4 Audio-thread hygiene — good

`process()` allocates nothing, has a denormal guard (`1e-30` flush), a NaN/∞
output guard, k-rate param reads, 2× oversampled tanh saturation, and pre-sized
Float32Array delay lines. Two nits: `Math.random()` per sample for hiss (an
inline LCG is cheaper and deterministic) and the dry/delayed 70/30 mix is a mild
6 ms comb (aesthetic choice — presumably intentional). The wrapper's failure
path (warn + route around) is the correct degraded-gracefully behaviour, as is
the convolver's generated-IR fallback.

### 3.5 Lifecycle / background behaviour — inconsistent

On `document.hidden` the engine stops the rAF loop but the transport, composer
and audio keep running ([engine.ts:61-65](../packages/engine/src/core/engine.ts)).
Consequences: control-rate modulation freezes at last values while audio plays;
an in-flight crossfade stalls mid-blend; CLAUDE.md's budget says "suspend on
background" and nothing does. A policy decision is needed (keep playing is
defensible for a music app) — but modulation and crossfades must then keep
ticking on a low-rate timer, or audio should fade and suspend.

### 3.6 Voice management — budget without stealing

`PolySynth.maxPolyphony` **drops** notes at the cap; the composer compensates
with its own budget (`activePad` + a hardcoded `PAD_TAIL_STEPS = 10` tail
estimate, [decide.ts:39](../packages/engine/src/audio/composer/decide.ts)) that
goes stale if the release port is edited live. Works for the generative bed;
will not survive a sequencer adding bursts. Needs real voice stealing
(release-oldest at cap) and one shared budget across composer + sequencer.

### 3.7 Performance under load

A crossfade runs **two complete scenes**: 2× Convolver, 2× `Tone.PitchShift`
(granular — the most expensive Tone node in the graph), 2× Reverb, 2× worklet,
2× full synth voice sets, for 6–8 s on a mid-range phone, simultaneously with
the doubled visual cost (see §4.1). This is the load case most likely to glitch
in the field. Mitigations: stagger the incoming build, consider hosting
shimmer/tape/reverb once at host level (larger refactor, aligns with the
data-driven-graph initiative), and instrument it before tuning it.

Per-frame control path allocations are minor but real: `macrosAt` allocates
2–3 objects per call and is called ~8×/frame (6 arc ports + audio/visual
`applyArc`), plus a fresh `Map` per `evaluateControlTargets`. A per-frame arc
cache removes most of it.

---

## 4. Visual engine assessment

### 4.1 The structural issue: one renderer per scene

Each `SceneInstance` constructs its own `WebGLRenderer`, `EffectComposer` and
`UnrealBloomPass` ([visualEngine.ts:80-104](../packages/engine/src/visual/visualEngine.ts));
crossfades blend two stacked canvases via CSS opacity. So every transition runs
**two full pipelines including two UnrealBloom chains** (bloom is by far the
heaviest pass) at up to DPR 2 — on top of the doubled audio. A full descent
creates and destroys 7 WebGL contexts. Browsers tolerate this, but it is the
single largest frame-budget liability and it makes transitions cost the most at
the moment smoothness matters most. The fix (one shared renderer; scene layers
as passes/render-targets blended in one composer) is a contained refactor of
VisualEngine + SceneInstance. **Severity: High** (under load).

### 4.2 The rest of the loop is clean

Confirmed by audit: the rAF tick is allocation-free apart from the `macrosAt`
objects (§3.7); analyser reads reuse Tone's internal buffers; uniforms are
written in place; shaders are procedural (no dependent texture reads), 5-octave
fbm, ~5–7 draw calls/frame; reduced-motion freezes shader time and CSS
animations honour the media query; gesture listeners have correct
passive/cleanup hygiene.

### 4.3 Gaps

- **DPR is sampled once** at construction and never re-read on
  resize/zoom/display-move ([visualEngine.ts:79](../packages/engine/src/visual/visualEngine.ts)).
- **No WebGL2-unavailable path** — old devices get a black canvas with audio.
  A one-time capability check with a graceful message is enough.
- **Context loss** is flagged and rendering skips, but restore does not rebuild
  composer targets — acceptable (three handles most of it), worth a manual test.
- **No performance instrumentation at all** — no frame-time tracking, no
  dropped-frame counter, no auto-degradation ladder (DPR step-down, bloom off).
  Given §4.1, instrumentation should land *before* tuning work.
- Pinch relies on `touchmove` with two touches (works on current iOS Safari);
  there is no `touch-action` CSS guard on the canvas container, so one-finger
  drag vs. page gestures on iOS deserves an on-device verification pass.

### 4.4 Visual monoculture — the scenes don't look different enough

Reading all seven shaders side by side, the "seven structurally different
worlds" promise is not delivered visually; the scenes are parameter variations
of one look. Concretely:

- **One technique family.** Six of seven are the same 5-octave value-noise
  `fbm` wash at near-identical spatial scale (`p × 3–4`) with a small additive
  accent (veins / bands / snow / points / horizon / glow). Only `abyss` changes
  the domain (log-polar).
- **One colour grade, copy-pasted.** Every shader ends with the same three
  lines: an additive blue `uFog` haze, a `mix(1.0, ~0.3, uDark)` global
  darkening, and the same centred vignette. Seven scenes, one grade.
- **One palette family.** Desaturated blue-teal in the ~0.01–0.4 luminance
  range everywhere except `abyss` (dark ember). Nothing bright, nothing
  saturated, nothing achromatic — so the global bloom (one shared
  strength/threshold for all scenes) reads identically everywhere.
- **One motion signature.** Every scene advances at
  `t = uTime * (0.03–0.06 + flow·k)` — the same slow drift; no scene owns a
  distinct motion (pulse, fall, rotation, stillness).
- **No per-scene tuning channel.** Because `scene.visualParams` and per-scene
  post settings are unwired (§2.2), even the existing knobs cannot
  differentiate scenes.

This is a product-level gap (the scenes are the product), recorded as **H5**.


---

## 5. Production readiness gaps

| Area | State | Gap |
|---|---|---|
| Error handling | Engine degrades gracefully (IR fallback, worklet bypass, patch fallback-to-default); player surfaces iOS audio state with tap-to-resume | **No React error boundary** (a render throw white-screens the app); crossfade build failure is swallowed silently; missing-sample is silent by design but has no studio surface |
| Persistence integrity | zod-validated, loose-object forward compat, lossless round-trip tested, import errors shown with field paths | `meta.version` exists but there is **no migration scaffold** — the sequencer schema change is the moment to add one; patches referencing IndexedDB samples silently lose audio on another device (documented seam, needs UX) |
| Browser compatibility | iOS unlock is robust (Tone.start + resume + silent-buffer prime + tap-to-resume); worklet failure degrades; worklet assets explicitly not inlined (iOS data:-URL refusal handled) | WebGL2 hard requirement with no message; production worklet URL resolution (`new URL` + hashed assets) has never been smoke-tested on a real build |
| Performance under load | Budgets stated (CLAUDE.md), DPR capped, voices capped, fftSize small | Crossfade doubles audio+visual cost (§3.7/§4.1); no instrumentation; background policy inconsistent (§3.5) |
| Mobile UX | smartphone-first player, tap-highlight handled, scene-name fade | **No safe-area insets** — `inset: 0` UI collides with notch/Dynamic Island on modern iPhones (ui.css `.player`/`.veil`) |
| Build/deploy | CI: typecheck+lint+test+build on push/PR; clean .gitignore; Vercel SPA config; patch emitted as asset | [app/public/ir/cathedral.zip](../app/public/ir/cathedral.zip) is an 8.1 MB **zip** nothing can load (`Tone.Convolver` needs WAV; no patch node references it) — extract the needed IR as WAV or remove it; large uncommitted changeset on `main` should be committed before parallel work begins |
| Tests | 31 green pure-logic tests run in CI | No coverage of crossfade state machine, transport, gesture math, sample store; no timing tests (no scheduler yet) — see §2.4 |

---

## 6. Findings index (by severity)

**High**
- H1 No limiter on the host master bus; clipping during crossfades — engine.ts:261 vs audioEngine.ts:148.
- H2 Crossfade gains stepped per rAF frame (zipper; stalls when hidden) — sceneInstance.ts:94, engine.ts:61.
- H3 Two renderers + two UnrealBloom chains during every crossfade; 7 contexts per descent — visualEngine.ts:80.
- H4 No safe-area insets on the full-bleed player UI — app/src/ui.css.
- H5 Visual monoculture: all seven scenes share one technique family, one
  copy-pasted colour grade, one palette family and one motion signature, and
  `scene.visualParams` / per-scene post settings are unwired so they cannot be
  differentiated by data — §4.4, visualEngine.ts:109.

**Medium**
- M1 Control-rate writes set `AudioParam.value` directly (no dezipper at the param level) — all `write()` closures.
- M2 Worklet params k-rate with no in-worklet smoothing — tapeWarmth.worklet.js:11.
- M3 Background/hidden policy inconsistent: audio runs, modulation+crossfade freeze — engine.ts:61.
- M4 No voice stealing; composer tail estimate hardcoded — decide.ts:39.
- M5 Crossfade CPU spike: full second audio chain incl. PitchShift — audioEngine.ts build.
- M6 DPR sampled once, never refreshed — visualEngine.ts:79.
- M7 No WebGL2 fallback message; no React error boundary.
- M8 No schema migration scaffold despite `meta.version`.
- M9 Schema↔engine drift: multi-layer visualGraph and audioGraph.connections unimplemented.
- M10 No performance instrumentation anywhere.
- M11 Crossfade build failure swallowed without logging — engine.ts:195.
- M12 Synth/shader boilerplate duplication (10×/7×) ahead of adding more modules.

**Low**
- L1 `midiToFreq` dead export + 10 local copies — core/music.ts:3.
- L2 `macrosAt` allocations ~8×/frame; fresh Map per matrix eval.
- L3 `Math.random()` hiss in the audio thread; unseeded hall IR.
- L4 Worklet `moduleRegistered` flag stale across context recreation — tapeWarmth.ts:8.
- L5 Sampler async bind race vs dispose — sampler.ts:42.
- L6 cathedral.zip: 8.1 MB unusable asset in app/public/ir.
- L7 No `eslint-plugin-react-hooks`; lint not type-aware.
- L8 No undo in studio; no patch-changed event for future subscribers.
- L9 Missing-sample states invisible in studio UI.
- L10 BPM fixed at tempoRange midpoint; no time signature; transport not port-addressable.
