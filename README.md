# Borland Descent

A browser-based, smartphone-first **generative music & visual experience**, and the
minimal studio used to author it — a living collaboration between two people in
different cities. Reference point: Brian Eno's generative apps (Bloom, Trope),
pushed darker, more personal, more immersive, and bidirectional.

This repository is **v1: the creative loop** — the smallest thing that lets us
compose and design real scene content and immediately hear and see it change. It is
not the whole platform (no backend, auth, transitions, or full seven-scene arc yet);
those are sequenced for later behind clean seams.

> Architecture, scope and decisions live in `CLAUDE.md` and the build plan. The two
> golden rules to internalise first: **the Patch is the single source of truth**, and
> **`packages/engine` is framework-agnostic (tone/three/zod only — never React).**

## Stack

Vite 8 · React 19 · TypeScript 6 · Tone.js `~15.1` · Three.js `^0.184` · zod `^4`
· Vitest 4 · ESLint 10. npm workspaces (`packages/engine` + `app`).

## Prerequisites

- **Node ≥ 22.12** and npm 10+ (`node --version`).

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

- **Player** → http://localhost:5173/ — opens on a still first frame; **tap to begin**
  unlocks audio and starts the transport.
- **Studio** → http://localhost:5173/studio — the authoring surface (scene
  parameters, the modulation-matrix table, transport + arc scrubbing, and Patch
  import/export arrive in Phase 1).

Test on iOS Safari at a 390px viewport — that is the performance budget.

## Verify

```bash
npm run typecheck   # strict TypeScript across both packages
npm run lint        # ESLint (incl. the engine framework-agnostic boundary)
npm test            # Vitest: seeded-RNG determinism, Patch validation + round-trip
npm run check       # all three
```

The CI gate is the **pure-logic** test surface — jsdom cannot run Web Audio/WebGL,
so the engine's audio + visual backends are exercised behind interfaces, not for
real. A real-audio Browser-Mode (Playwright) suite is a documented later option.

## Edit & commit a Patch

The canonical Patch lives at [`patches/borland.json`](patches/borland.json) and is
loaded at boot (served at `/borland.json`). It is the single source of truth for the
piece.

1. Open `/studio`, edit scene parameters and the modulation matrix with the live
   engine responding _(Phase 1)_.
2. **Export** the working Patch as JSON from the studio.
3. Replace `patches/borland.json` with the exported file and **commit** it.

Collaboration is via git — branches, history, merges. If `borland.json` is missing
or invalid, the player degrades gracefully to a bundled default Patch.

## Deploy

Static site, no backend. Build to `dist/` and serve as static assets.

```bash
npm run build       # → dist/ (index.html, assets/, borland.json, _redirects)
```

**Cloudflare Pages** (recommended): build command `npm run build`, output directory
`dist`. The committed `app/public/_redirects` provides the SPA fallback so `/studio`
resolves on reload. A custom subdomain such as `borland.robgregg.com` can point at
it. Vercel is an equivalent swap (set output to `dist`, add a rewrite to
`/index.html`).

## Layout

```
packages/engine/    framework-agnostic engine — tone/three/zod only
app/                Vite React app — '/' player, '/studio' studio
patches/borland.json  the canonical seed Patch
```
