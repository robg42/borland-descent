---
description: Refresh docs/design-rationale.html so it matches the current code. User-invoked at commit/phase time; reconciles the living rationale with the real architecture and recent changes.
disable-model-invocation: true
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Read Edit
---

# Refresh the design rationale

`docs/design-rationale.html` is a living document explaining *why* Borland Descent v1
is built the way it is — the decisions, trade-offs and seams. Your job is to reconcile
it with the current code so its claims stay true. This is a **surgical refresh, not a
rewrite**.

## Current state (auto-collected)

Recent commits:
```!
git log --oneline -12
```

Changed over the last few commits:
```!
git diff --stat HEAD~3 HEAD 2>/dev/null || git diff --stat
```

Uncommitted working tree:
```!
git status --short
```

## What to do

1. **Read** `docs/design-rationale.html` in full.
2. **Read the sources of truth it describes**, and check every claim still holds:
   - `CLAUDE.md` — the golden rules, v1 scope, and the §18 roadmap
   - `packages/engine/src/patch/schema.ts` — the Patch shape
   - the engine spine: `core/engine.ts`, `modulation/matrix.ts`, `audio/audioEngine.ts`,
     `visual/visualEngine.ts`, and the synth/shader registries
   - `patches/borland.json` — port names, routes, scene params, polyphony caps
   - anything the recent commits / diff above touched
3. **Reconcile the doc with reality:**
   - Correct any statement that is now stale or wrong (changed port names, route
     counts, polyphony caps, file paths, behaviour).
   - Add design decisions or seams introduced since the last refresh, written in the
     doc's existing voice.
   - Remove claims for things that no longer exist.
   - If the doc has a changelog / "what changed" section, add a dated entry; if it has
     none, do not invent one.
4. **Preserve** the existing HTML structure, styling, palette, and section order.
   British English throughout. **Edit in place** — do not regenerate the file
   wholesale, and do not touch anything that is still accurate.

## Output

After editing, give a short bullet summary of exactly what you changed and why, and
flag anything you noticed in the code that is *under*-documented but you did **not**
add (so the human can decide). Do **not** commit — leave that to the user.
