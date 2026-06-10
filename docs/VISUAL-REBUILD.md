# Visual Engine Rebuild — Analysis & Proposal

**Date:** 2026-06-10 · **Status: APPROVED 2026-06-10** — decisions: approach +
V1–V4 plan approved; **N = 10**; feedback/glitch in V3 *if budget holds* (RT
pool still built in V1); presets **both** per-scene and global. ·
Companions: [REVIEW.md](./REVIEW.md) §4, [ART-DIRECTION.md](./ART-DIRECTION.md),
[PLAN.md](./PLAN.md) Workstream C.

## 1 · How the visual engine works today

**Structure.** Each `SceneInstance` owns a complete pipeline
([visualEngine.ts](../packages/engine/src/visual/visualEngine.ts)): its own
`WebGLRenderer` + `EffectComposer`, one **layer module** (a fullscreen
fragment `ShaderPass` chosen by `scene.shaderModuleId` from a factory registry
in [shaders/index.ts](../packages/engine/src/visual/shaders/index.ts)), then
UnrealBloom → film grain → OutputPass. As of today there are **seven visually
distinct layer modules** (the H5 restyle, commit `d295864`) and per-scene
parameter bases + post grades flow from `scene.visualParams`. The host
`Engine` runs one rAF loop that reads transport time; crossfades run two whole
pipelines and blend canvas opacity.

**How it receives audio/modulation.** `Analysers`
([analysers.ts](../packages/engine/src/audio/analysers.ts)): two RMS meters
(master, bass) + one 64-bin FFT exposed as 3 banded ports
(`fft.low/mid/high`). These, plus gesture (`zoomDepth/touchX/touchY`) and the
six arc macros, are **output ports** in the `SignalRegistry`. The `Matrix`
evaluates control-rate routes per frame — `source.read() → curve → amount
(depth) → sum on base → exponential smoothing → input.write()` — writing
shader uniforms through closures each module registers. So *"any audio
feature → any parameter, with depth/curve"* already exists at control rate,
serialised as `modulationMatrix` in the Patch.

**Where the control surface lives.** The studio
([SceneParams.tsx](../app/src/studio/SceneParams.tsx)) **generates** sliders
by introspecting `engine.inputs()` (live registry: ref, kind, base, min,
max), and [MatrixTable.tsx](../app/src/studio/MatrixTable.tsx) edits routes
live with type-compatibility enforced. Edits write through `setInputBase`
into both the live param and the working Patch. Real-time, not
config-at-startup.

## 2 · The honest gap analysis (brief → reality)

| Brief requirement | Today | Gap |
|---|---|---|
| Distinct modules behind a common interface | ✅ `VisualLayer` interface, 7 modules, factory registry | interface is fullscreen-shader-only; no particle/geometry/feedback module types |
| Shared modulation + control layer | ✅ SignalRegistry + Matrix, serialised routes with depth/curve | — |
| Audio features | ⚠️ 2×RMS + 3 FFT bands | **no transients/onsets**, no spectral flux/centroid, coarse bands, no per-feature envelopes |
| Params as schema; UI + routing generated | ⚠️ UI *is* generated — but from the **live** registry; param defs are imperative code per module | no static descriptor: nothing to validate patch params against, nothing to render UI before build, min/max/grouping ad-hoc |
| Add a visual without touching plumbing | ⚠️ true for fullscreen shaders (one file + registry line) | untrue for any non-ShaderPass technique |
| Real-time performable controls | ✅ sliders + routes live | no macro/XY performance controls, no MIDI (out of scope unless you say otherwise) |
| Presets: capture/recall full state | ❌ the Patch is one implicit preset | no named presets, no recall/morph |
| Keep AudioWorklet DSP + split modulation | ✅ untouched by this proposal | — |
| Serialisable state | ✅ zod Patch + migrations (v2) | presets/descriptors need schema v3 |
| 60 fps in-browser | ⚠️ fine steady-state | renderer-per-scene doubles cost in crossfades (REVIEW H3) |

**Conclusion:** this is a **targeted rebuild of three subsystems** (module
contract, audio features, presets) plus the already-planned renderer
unification — *not* a ground-up rewrite. The modulation core, port system,
patch model, studio generation pattern and the seven new modules all carry
over. Calling that out per your instruction to flag keep-vs-replace honestly.

## 3 · Keep vs replace

**Keep (reuse as-is):** AudioWorklet DSP + entire audio path; SignalRegistry/
ports; Matrix + control/audio rate split; gesture + arc sources; Patch/zod/
migrations; JsonPatchStore; studio's registry-driven UI generation approach;
the seven scene modules (become roster modules 1–7); per-scene visualParams +
post grades; DPR cap/resize/context-loss handling.

**Replace / rework:** renderer-per-scene → **one shared renderer host**
(PLAN C-P0; crossfade becomes a composer blend); imperative-only port
registration → **descriptor-driven** (generic binder generated from schema);
`Analysers` → **FeatureExtractor** (superset, same port idiom);
scene→shader hard link → scene references any module id (already true) + a
studio module picker.

**New:** module *capability* types (scene-graph/points, feedback render-target);
transient/onset trigger ports + trigger-route envelopes; presets (capture,
recall, morph); 3 new technique-family modules.

## 4 · Target architecture

```
            ┌───────────────────────── Patch (zod, v3) ─────────────────────────┐
            │ scenes · visualParams · modulationMatrix · sequences · presets[]  │
            └──────┬──────────────────────────────┬─────────────────────────────┘
                   │ params/routes/presets        │ moduleId per scene
                   ▼                              ▼
   ┌─────────────────────────┐      ┌────────────────────────────────────────┐
   │ MODULATION+CONTROL LAYER│      │ RENDERER HOST (one WebGLRenderer,      │
   │ SignalRegistry (ports)  │      │  one EffectComposer, RT pool)          │
   │ Matrix (depth/curve/    │◀────▶│  active module (+incoming during fade) │
   │  smoothing; trigger env)│      │  → per-scene post (bloom/grain/output) │
   │ FeatureExtractor:       │      └────────────────────────────────────────┘
   │  8 log bands·RMS·flux·  │                      ▲
   │  onset triggers·env     │      ┌───────────────┴───────────────────────┐
   │ Gesture · Arc · Seq     │      │ VISUAL MODULES (self-contained)        │
   └─────────────────────────┘      │ descriptor: id, params schema (key,    │
            ▲                       │  kind, min/max/default, group, curve   │
   generated│from descriptors       │  hint), capabilities (feedback? points?)│
   ┌────────┴────────────────┐      │ create(ctx) → render(t,dt) lifecycle   │
   │ STUDIO (React)          │      │ fullscreen-shader | scene-graph |      │
   │ module picker · param   │      │ feedback variants                      │
   │ panels · routing matrix │      └────────────────────────────────────────┘
   │ preset capture/recall   │
   └─────────────────────────┘
```

The load-bearing change is the **`VisualModuleDescriptor`**: every module
exports a static, zod-validated schema of its parameters. From it we generate
(a) the registry bindings (one generic binder replaces today's per-module
`bind()` boilerplate), (b) the studio panels (groups, ranges, labels),
(c) patch validation for `visualParams`, and (d) the routing target list.
Adding a module = one file exporting `{ descriptor, create }` + one registry
line — no control/audio plumbing touched. That is the brief's goal stated as
a mechanical invariant.

**Audio features** (`audio.*` ports): 8 log-spaced FFT bands, master/bass
RMS (kept), spectral flux, **onset/transient as `trigger`-kind ports** (the
port system already has the kind), per-feature attack/release envelopes.
The Matrix gains one small extension: a trigger route fires a decaying
envelope into its target (depth/curve as ever) — Ikeda-style strobe-tight
mapping without per-frame hacks. Pure feature maths is headless-testable.

**Presets** (schema v3 + migration): `presets[]` — named captures of
`{ moduleId, visualParams, scoped routes, post }`, per scene or global.
Capture/recall in the studio; recall with optional morph time (params lerp,
routes crossfade depth). Serialises in the Patch, git-diffable, and a preset
is exactly what a sequencer port-track or arc keyframe can target later.

**References → technique families** (translated, not copied): the existing 7
cover Reas/Watz-style procedural fields, Quayola-ish decomposition (abyssal),
Lemercier light-cones (twilight). The new families: **signal** —
Ikeda/Nicolai/Bretschneider strobing barcode/grid lattices, onset-locked,
monochrome; **swarm** — Zhestkov/Houzé/Universal Everything mass-particle
flows (three.js `Points` + curl noise, audio-pushed, ~50k points is fine at
60 fps); **beams** — Nonotak/UVA/1024 volumetric strobe planes and light
architecture; *(stretch)* **feedback/glitch** — Weirdcore/Akten trails,
datamosh-ish displacement via ping-pong render targets (needs the RT-pool
capability, hence stretch).

**Proposed N = 10** at definition-of-done: the seven scene modules + signal +
swarm + beams, all behind the descriptor interface, all routable, all
preset-capable. Glitch/feedback as an 11th when the RT pool lands.

## 5 · Phased plan (each phase gated, `npm run check` + on-device verify)

> **Progress:** V1 ✅ (commits `8a30da4`, `fb5a98a`, `3873578` — contract,
> single-renderer host with crossfade-as-blend verified in-browser, all seven
> modules migrated, studio module picker). V2 ✅ (feature layer: 8 log bands /
> flux / onset trigger ports; trigger→numeric envelope routing in the Matrix;
> 8 new headless tests; sources appear in the routing UI automatically).
> V3 ✅ — N = 10: signal (Signal), swarm (Murmuration) and beams (Axis) live
> behind the descriptor contract and selectable in the studio picker, each
> with trigger/bass/flux-ready scene ports. Decision note: swarm ships as a
> flow-warped fragment-pass field (reads as a murmuration well within budget);
> a true Points-based GPU particle system and the feedback/glitch module both
> wait on the scene-graph/RT-pool capability work and the frame-budget check.
> Next: V4 presets. A double-tap gesture (player) now advances to the next
> scene via an arc glide; pinch/drag/wheel cancels it.
> V3.1 ✅ — the artist series, N = 20: ten further technique families, each
> translated (not copied) from a named generative artist and shipped on the
> descriptor contract as a single fragment pass: molnar (Ordres — Vera Molnár),
> hobbs (Fidenza — Tyler Hobbs), naon (Plenitude — Manolo Gamboa Naon), akten
> (Meditation — Memo Akten), crespo (Neural Zoo — Sofia Crespo), anadol
> (Archive — Refik Anadol), henke (Lumière — Robert Henke), lemercier (Fuji —
> Joanie Lemercier), rickards (Moiré — Paul Rickards), asendorf (Sort — Kim
> Asendorf). All carry the fog/flow/depth field trio plus two routable scene
> ports (one trigger-shaped), and all answer the arc's darkness.

- **V1 — Host + contract (the structural phase).** Single shared renderer +
  composer + RT pool; crossfade as blend pass (closes REVIEW H3);
  `VisualModuleDescriptor` + generic binder; migrate all 7 modules onto it
  (mechanical — their params are already enumerated); studio module picker;
  schema v3 (`presets[]` empty) + migration. *Golden-rule files touched →
  design-rationale update rides along.*
- **V2 — Features + performable routing.** FeatureExtractor (bands, flux,
  onsets, envelopes) behind the existing port idiom; trigger-route envelopes
  in the Matrix; studio routing UI gains the new sources; headless tests for
  feature maths + trigger envelopes.
- **V3 — New modules.** signal, swarm, beams (+ feedback capability and the
  glitch module if budget holds); each ships with descriptor, default preset,
  and a per-scene cost measurement via the C-P1 frame instrumentation.
- **V4 — Presets.** Capture/recall/morph + studio panel; round-trip tests.
- **Punch list folded into V1:** thermocline warm-half level, midnight haze
  at native arc, abyssal seam contrast, linear-vs-sRGB palette audit across
  all seven (the root cause of this week's level fixes).

Workstreams A (sequencer) and B (sound engine) from PLAN.md are unaffected;
B's only interaction is that FeatureExtractor taps the existing analyser
nodes — the AudioWorklet DSP and the split modulation model stay exactly as
they are, per your constraint.

## 6 · Definition of done (restating the brief, concretely)

1. **N = 10** visually distinct modules behind `VisualModuleDescriptor`.
2. Studio control panel fully generated from descriptors (zero hand-wired
   per-module UI), live at 60 fps on the 390 px target.
3. Any `audio.*` feature → any module parameter with depth/curve/smoothing,
   including onset triggers; end-to-end demo: kick-onset → strobe gate.
4. Preset capture/recall (with morph) round-tripping through the Patch.
5. `npm run check` green; no audio-engine regression (same audible output
   with visuals swapped); adding an 11th module touches no plumbing file.

---

**Stopping here for your sign-off**, per the brief. Decisions you may want to
weigh in on: (a) N=10 OK, or different roster? (b) feedback/glitch in-scope
for V3 or explicitly deferred? (c) presets per-scene, global, or both
(proposal: both)?
