# Borland Descent — Scene Visual Identity (Art Direction)

**Date:** 2026-06-10 · **Drives:** PLAN.md Workstream C item **C-0** (REVIEW
finding **H5**, client mandate: "significantly more diversity in the visuals —
all stylistically different"). · **Full design briefs** (complete GLSL
sketches, port tables, arc responses, still-frame specs, risk notes):
[art-direction/designs.json](./art-direction/designs.json) — produced by a
seven-designer panel with adversarial distinctiveness + cohesion judging; the
panel's required changes are folded in below as **binding amendments**.

## Why

All seven current scenes are one look: a 5-octave value-noise fbm wash at the
same spatial scale, the same copy-pasted fog/vignette/darkening grade, one
desaturated blue-teal palette, one slow-drift motion (REVIEW §4.4). Diversity
must be guaranteed by construction, so each scene **owns** one hue family, one
compositional geometry, one motion verb and one luminance key — no sharing.

## The diversity contract

| Scene | Title | Owned hue | Owned geometry | Owned motion | Key |
|---|---|---|---|---|---|
| surface | Underlight | white-gold + milky aqua | radial caustic NET under a sun-disc | SHIMMER (fast micro-scintillation) | high |
| sunlitShallows | Cathedral of Light | green-glass chartreuse | corner-anchored diagonal ray FAN | RISE (only upward motion) | mid-high |
| thermocline | Prism Horizon | amber-grey ↔ steel-indigo split | ONE hard horizontal blade | SHEAR (halves counter-drift) | mid, split |
| twilight | Last Light | violet / heliotrope | single light CONE + falling snow | FALL | low-mid |
| midnight | Noctiluca | electric cyan / bio-green on true black | scattered CONSTELLATION + trails | PULSE (bass-breathing flares) | lowest base, brightest peaks |
| abyssal | Leviathan's Flank | near-achromatic grey-green | tilted black MASS vs thin seam | STILLNESS (one sonar event) | low, flat, matte |
| descent | The Throat | crimson (UV rim-glaze only) | radial VORTEX into a black core | ROTATION + infall | low, one hot ring |

Every pair must separate on at least two axes; the descent's mean luminance
still falls monotonically surface→centre. Surface and descent are deliberate
radial bookends: a sun that gives light vs a core that swallows it.

## Per-scene direction (amended)

### 1 · surface — *Underlight*
A glittering white-gold caustic net over luminous turquoise, gathered round a
wobbling refracted sun-disc at top-centre — the view from a metre under,
looking up. Two counter-drifting animated Voronoi layers (9-tap, F2−F1
ridges), Snell window + Beer–Lambert column; **no fbm base**. Palette
`#0B5E6E #29C4CF #8CF0E8 #FFE8A8 #FFFAED`. Ports: `glint` (caustic gain — the
masterMeter target), `sun` (azimuth — gesture.touchX). Post: bloom 0.95 /
threshold 0.72, grain 0.06.
**Amendments:** white-gold is surface-exclusive; the aqua stays milky and
water-toned, never emissive-saturated (midnight owns saturated cyan).

### 2 · sunlitShallows — *Cathedral of Light*
A fan of god-rays from an off-frame sun, dust-motes glittering upward inside
the shafts over deepening teal; three superposed angular combs (7/14/23
shafts) break the symmetry. Ports: `shafts` (beam breadth — bassMeter),
`glint` (mote sparkle — fft.high, the bells literally glitter). Post: bloom
1.15 / threshold 0.55, grain 0.07.
**Amendments (panel, high):** the sun anchor moves decisively off top-centre
to an upper **corner** so the rays cut the frame diagonally (top-centre radial
belongs to surface), and the scene **cedes gold**: beam body shifts from
sand-gold to green-glass **chartreuse** (`#9FBF8A`-led), mote glints
green-biased. Verify the surface↔shallows mid-fade with an overlaid still.

### 3 · thermocline — *Prism Horizon*
A razor-thin prismatic blade cuts the frame dead horizontal — the only hard
line in the piece — RGB-fringed and meniscus-wobbling; cold steel-indigo
isotherm striations below compress toward the seam; a squashed warm reflection
smear hangs beneath it. The blade rises 0.45→0.74 as the arc darkens (cold
claiming the frame). Ports: `refract` (displacement — fft.mid bends the
image), `dispersion` (fringe width — fft.high). Post: bloom 0.9 / threshold
0.75, grain 0.10.
**Amendments:** the warm upper half loses its residual fbm haze — graded
horizontal banding (a dying sky), not isotropic noise; blade gain eases in the
last ~10% of residency so the crossfade over twilight's cone reads as a
horizon, not a scanline.

### 4 · twilight — *Last Light*
One pale violet beam failing from top-centre, full of falling marine snow
(three parallax planes, depth-of-field softness), flaring where it crosses the
light. Nothing changes faster than ~3 s. Palette violet/heliotrope, **no
teal**. Ports: `lume` (cone intensity — masterMeter breathes), `presence`
(silhouette opacity — fft.low). Post: bloom 0.55 / radius 0.7, grain 0.12.
**Amendments (panel):** at most **one** distant silhouette, ghost-faint by
design and capped — `presence` ceiling clamped and biased lower near the
scene's entry/exit (abyssal must be the descent's first real encounter with a
vast presence); the thumbnail identity is **cone + snow**, the beast a
subordinate grace note.

### 5 · midnight — *Noctiluca*
A drifting constellation of ~14 plankton lights with curved comet trails along
a loose diagonal, on **absolute black** (~95% of pixels) — no field, no
gradient, no vignette. Adagio breathing: motes flare on the bass breath,
~110 ms spark flicks as grace notes. Ports: `pulse` (global flare —
bassMeter), `flicker` (fft.high). Post: bloom 1.6 / threshold 0.15 (the
bloom-heavy scene).
**Amendments (panel, high):** the expanding jelly/sonar **rings are removed
entirely** — abyssal owns the expanding-ring event; the periodic event becomes
a **chain-flare** propagating mote-to-mote along the drift line. Register
re-tune toward biological, away from neon: motes enter the scene partly
desaturated bio-green and reach peak electric only mid-residency; core chroma
capped (lean toward `#0B4A52` at the bloomed edge); grain raised 0.06 → ~0.10
so the void keeps tape texture.

### 6 · abyssal — *Leviathan's Flank*
An enormous black ridged silhouette (1-D ridged-multifractal skyline, rotated
~18–22°) owning most of the frame against a thin grey-green seam; one pale
sonar ring expands from a heart inside the mass every ~11 s, grazing the
contour; the mass breathes with the bass (~10 s, bass-driven). Near-achromatic;
matte. Ports: `pulse` (breath — bassMeter), `sonar` (ring brightness —
masterMeter). Post: bloom 0.15 / threshold 0.8 (deliberately almost no bloom),
grain 0.14.
**Amendments (panel):** entry mass occupancy raised to **≥60%** of frame and
the tilt steepened (18–22°) so the 128 px read is always *black wedge with a
crack of water*, never a horizontal-horizon read (thermocline owns the
horizontal).

### 7 · descent — *The Throat*
An absolutely black disc slightly above centre, rimmed by one thin hot
pink-crimson ring; seven log-spiral filament arms spiral in like water down a
drain, RGB-fringing as they approach. `setArc` *is* the narrative: the core
grows from a pupil to ~80% of the frame at arc 1, aberration grows, the ring
widens and warms as everything else dies — the strangely warm ending. Ports:
`maw` (core dilation/ring heat — bassMeter gulps), `glow` (filament emission —
masterMeter ignites the arms). Post: bloom 1.15 / threshold 0.62, grain 0.16
(doubles as dither against OLED banding).
**Amendments (panel):** hue claim is **crimson only** — `#5d2bd4` ultraviolet
strictly as outer-rim glaze, never field-dominant (twilight owns violet);
late-arc cool-drift clamped so every arc position reads crimson-led; the ring
stays pink-crimson, never white-hot, and the warp stays organic (a throat, not
a tidy sci-fi accretion disc).

## Engine enablers (built before the shaders, Workstream C)

1. `scene.visualParams` merged over the global layer-node params (un-deadens
   the schema — REVIEW §2.2).
2. Per-scene post overrides from `scene.visualParams`: `bloomStrength`,
   `bloomRadius`, `bloomThreshold`, `grainIntensity` (values above), applied on
   scene activation and crossfaded across transitions.
3. The cloned fog/vignette/darkening footer is deleted; each scene owns its
   grade.
4. Port vocabulary: every layer keeps unipolar `fog`, `flow`, `depth`
   (global routes r1/r4 keep working); at most 2 scene-specific ports each
   (as listed); `setArc(darkness)` remains a structural transformation per
   scene, never a brightness multiply.

## Constraints & verification

- **Budget:** one fullscreen pass per scene, procedural only, no
  feedback/history buffers, constant loop bounds, ≤ ~2× the cost of the old
  5-octave fbm per pixel. The panel's feasibility pass could not complete
  (session limit), so the visuals workstream must sanity-check each
  `gpuCost` note in designs.json against this budget **before** implementing,
  and measure with the C-P1 frame instrumentation after.
- **Stills:** every scene must compose at `t = 0` (reduced motion) — the
  briefs specify each still; phase-seed constants are tuned by eye.
- **Acceptance:** a 7-up grid of 128 px screenshots (captured in the verify
  pass at each scene's mid-arc) in which any two scenes are instantly
  distinguishable; mean luminance falls monotonically down the descent;
  mid-crossfade overlays checked for surface↔shallows and thermocline↔twilight.
