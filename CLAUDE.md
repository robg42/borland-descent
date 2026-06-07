# CLAUDE.md — Borland Descent

## Project

Borland Descent is a browser-based, smartphone-first generative music & visual
experience, and the minimal studio used to author it. This repo is **v1: the
creative loop** — one engine; one or two continuous generative scenes; zoom mapped
to a position along an emotional arc; a handful of real audio↔visual modulation
routes; a studio that edits scene parameters and those routes live; and lossless
save/load of the work as JSON. v1 is deliberately *not* the whole platform (no
backend, auth, transitions, or seven-scene arc — see the build plan).

## Golden rules (non-negotiable — see the build plan §2)

1. **The Patch is the single source of truth.** A zod-validated JSON document
   (`packages/engine/src/patch`) describes the whole piece. The studio edits it,
   the engine renders it, nothing else holds authored state.
2. **`packages/engine` is framework-agnostic.** It imports only **tone, three and
   zod** — never React, never Vite. Enforced by the engine's `package.json` *and* an
   ESLint `no-restricted-imports` rule. The player and studio both instantiate the
   same `Engine` with the same Patch.
3. **Persistence is reached only through `PatchStore`.** v1 ships `JsonPatchStore`;
   a reactive backend (Convex) later implements the same interface unchanged.
4. **Everything modulatable is a typed, addressable port.** A `PortRef` is a stable
   `"nodeId.portName"`; kinds are `scalar | unipolar | bipolar | trigger | vector`.
   The matrix only connects type-compatible ports.
5. **Audio and visual share one clock** (`core/transport.ts` over Tone's transport).
   The visual rAF loop *reads* transport time; it is not sample-accurate.
6. **Modulation is split into control-rate and audio-rate — they are NOT
   interchangeable.** Control-rate routes are evaluated per frame and smoothed
   (visual uniforms, reverb/filter, all audio→visual). Audio-rate routes are wired
   as native `Tone.Signal`/Web-Audio connections and never written per frame
   (LFO/envelope → cutoff/amp). A route's `rate` field records which.

## Stack & versions

Vite 8 · React 19 (studio/player only) · TypeScript 6 · **Tone.js `~15.1`**
(v15 uses getters: `Tone.getTransport()`, `Tone.getContext()`, `Tone.getDestination()`)
· **Three.js `^0.184`** (vanilla, `three/addons/*`, WebGL2 `EffectComposer`) ·
**zod `^4`** · Vitest 4 · ESLint 10 (flat config) + typescript-eslint 8.

## Structure

```
packages/engine/   framework-agnostic engine (tone/three/zod only)
  src/patch/        Patch types + zod schema + default + PatchStore
  src/core/         Engine, transport, seeded RNG, ports
  src/modulation/   the matrix (control-rate + audio-rate) — Phase 1
  src/audio/        context, buses, synths, composer, analysers, effects/worklets — Phase 1
  src/visual/       renderer, layered compositor, shaders, post chain — Phase 1
  src/gesture/      gesture map → signal outputs — Phase 1
  test/             pure-logic tests (the CI gate)
app/                Vite React app: '/' player, '/studio' studio
patches/borland.json  the canonical seed Patch (committed; round-trips losslessly)
```

## Commands

```
npm run dev         # serve the app (/ player, /studio studio) on :5173
npm run build       # static build to dist/
npm run preview     # preview the production build
npm run typecheck   # tsc --noEmit across both packages
npm run lint        # eslint .
npm test            # vitest run (pure-logic smoke / determinism / round-trip)
npm run check       # typecheck + lint + test
```

## Conventions

- **British English** in all user-facing copy.
- **No secrets** in the repo; nothing hardcoded.
- Prefer **fragment shaders over heavy geometry** for mobile; cap DPR at 2.
- Honour **`prefers-reduced-motion`**.
- **One shared AudioContext**, created/unlocked on a user gesture (Tone owns it);
  dispose the engine cleanly across React StrictMode double-mounts and Vite HMR.
- Commit per phase, conventional messages.

## Performance budget

A mid-range phone at a **390px** viewport, iOS Safari. Keep it smooth: cap voices
(~24), `fftSize` 512–1024, low draw calls, suspend on background.
