import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import type { VisualLayer } from './types';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The Throat — the terminal scene, and the only one that looks back at you.
// An absolutely black core slightly above centre, rimmed by one thin hot
// pink-crimson ring; seven log-spiral filament arms spiral inward like water
// down a drain, tearing into radial RGB fringes as they near the horizon.
// Translation along log(r) makes the infall scale-invariant, so the swallow
// never visibly loops. setArc IS the narrative: the core dilates from a pupil
// to ~80% of the frame as darkness -> 1, the aberration grows, the field
// cools a clamped amount (crimson stays dominant at every arc position —
// twilight owns violet) and the ring widens and warms as everything else
// dies. Crimson is this scene's owned hue; ultraviolet appears only as an
// outer-rim glaze and a thin haze hugging the horizon. No orange anywhere.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uMaw, uGlow;
  varying vec2 vUv;

  const float TAU = 6.28318530718;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  // Value noise made periodic along x (the angular axis): the atan seam makes
  // q.x jump by exactly one period, so wrapping the lattice there closes the
  // seven arms seamlessly around the throat — no radial seam in the field.
  // The y lattice wraps at 256 cells purely to keep the sin-based hash inside
  // its precision comfort zone over very long sessions; the infall axis
  // translates forever, so unbounded coordinates would slowly degrade it.
  float pnoise(vec2 p, float perX){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x0 = mod(i.x, perX), x1 = mod(i.x + 1.0, perX);
    float y0 = mod(i.y, 256.0), y1 = mod(i.y + 1.0, 256.0);
    float a = hash(vec2(x0, y0)), b = hash(vec2(x1, y0));
    float c = hash(vec2(x0, y1)), d = hash(vec2(x1, y1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float ridge(float n){ float v = 1.0 - abs(2.0 * n - 1.0); return v * v; }

  // Lacunarity is exactly 2 so the angular period doubles cleanly per octave;
  // the constant offsets decorrelate the otherwise-aligned octave lattices.
  // rfbm2 must share rfbm4's offsets so the fringe samples track the same
  // filament structure rather than degrading into colour noise.
  float rfbm4(vec2 p, float perX){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * ridge(pnoise(p, perX)); p = p * 2.0 + vec2(13.7, 7.3); perX *= 2.0; a *= 0.55; }
    return v;
  }
  float rfbm2(vec2 p, float perX){
    float v = 0.0, a = 0.6;
    for (int i = 0; i < 2; i++){ v += a * ridge(pnoise(p, perX)); p = p * 2.0 + vec2(13.7, 7.3); perX *= 2.0; a *= 0.55; }
    return v;
  }
  float fbm3(vec2 p, float perX){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++){ v += a * pnoise(p, perX); p = p * 2.0 + vec2(9.2, 5.1); perX *= 2.0; a *= 0.5; }
    return v;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    // Focal origin slightly above centre — good for a 390px portrait frame
    // with the UI at the bottom.
    vec2 p = (vUv - vec2(0.5, 0.55)) * vec2(aspect, 1.0);
    float r = length(p) + 1e-4;
    float ang = atan(p.y, p.x) / TAU;
    // The +31.7s phase seed composes the reduced-motion still at t = 0.
    float t = (uTime + 31.7) * (0.04 + uFlow * 0.20);

    // The horizon: the core grows from a pupil to ~80% of the frame with the
    // arc; the maw port gulps it a little wider on each pedal note.
    float Rc = mix(0.055, 0.58, pow(uDark, 1.35)) + uMaw * 0.10;

    // Log-polar spiral frame: u wraps the angle, v = log r is the infall
    // axis. The v-dependent twist is the differential rotation — glacial at
    // the rim, perceptibly faster at the horizon; -t on v = endless infall.
    float v_ = log(r);
    float twist = 1.6 + uDepth * 2.2;
    float u_ = ang + v_ * (twist / TAU) + t * 0.10;
    vec2 q = vec2(u_ * 7.0, v_ * 1.05 - t * 0.85); // seven arms

    // Filaments: warped, anisotropic ridged fbm — squashed along v so the
    // noise pulls into long inward threads. The warp keeps them organic: a
    // throat being swallowed, not a tidy accretion disc.
    float w = fbm3(q * vec2(2.0, 1.7), 14.0) - 0.5;
    vec2 qa = q * vec2(3.0, 0.9) + w * 0.9;
    float fil = rfbm4(qa, 21.0);

    // Chromatic fringe: offsetting v = log r is exactly a multiplicative
    // radial offset, so two cheap low-octave evaluations give radial RGB
    // fringing that grows toward the horizon as the arc ends.
    float ca = mix(0.004, 0.024, uDark) * (1.0 - smoothstep(Rc, 1.1, r));
    float filR = rfbm2(qa + vec2(0.0, -ca * 14.0), 21.0); // sampled inward
    float filB = rfbm2(qa + vec2(0.0,  ca * 14.0), 21.0); // sampled outward
    vec3 fr = vec3(filR, fil, filB);

    // Palette: crimson owns the field, maroon in the shadows; ultraviolet is
    // confined to the rim glaze and the horizon haze; the ring is
    // pink-crimson, never white-hot, never ember-orange.
    vec3 violet  = vec3(0.21, 0.10, 0.55);
    vec3 crimson = vec3(0.55, 0.05, 0.13);
    vec3 maroon  = vec3(0.20, 0.015, 0.07);
    vec3 hot     = vec3(1.0, 0.66, 0.61);

    float band = smoothstep(Rc + 0.05, 1.0, r);
    vec3 body = mix(maroon, crimson, smoothstep(0.1, 0.75, fil));
    // Late-arc cool drift, clamped well below dominance so every arc
    // position reads crimson-led (binding amendment).
    body = mix(body, violet, band * mix(0.22, 0.40, uDark));
    vec3 col = body * fr * (0.55 + uGlow * 0.9);
    // Bright knots where the loudest filaments cross near the ring — the
    // glow port pushes these over the bloom threshold.
    col += hot * pow(fr.g, 3.0) * (0.25 + uGlow * 0.6) * (1.0 - smoothstep(Rc, 0.9, r));

    // The ring: an analytic hot rim on an organically perturbed horizon —
    // the filaments lick the edge of the void so it never reads stamped. It
    // softens and warms as the arc ends: the last light, strangely warm.
    float edge = Rc * (1.0 + (fil - 0.5) * 0.06);
    float ring = exp(-abs(r - edge) * (26.0 - uDark * 10.0));
    col += hot * ring * (0.8 + uMaw * 0.8);
    col += violet * exp(-abs(r - edge) * 9.0) * 0.22; // UV haze hugging the horizon

    // Ultraviolet outer-rim glaze, keyed to corner distance so it reaches
    // the corners of a portrait frame — the last light, shifted out of the
    // visible.
    float rimN = r / (length(vec2(0.5 * aspect, 0.55)) + 1e-4);
    col += violet * 0.16 * smoothstep(0.62, 1.0, rimN);

    // Fog: a faint crimson dust veil suspended outside the horizon — the
    // global field.fog route stays meaningful, but here fog glows red
    // rather than washing blue.
    col += uFog * 0.08 * crimson * (0.4 + 0.6 * fil) * smoothstep(Rc, 1.2, r);

    // Black-violet void floor: the background is violet-black, never teal.
    col += vec3(0.012, 0.002, 0.024);

    // The swallow: absolute black inside the horizon (which also keeps the
    // atan/log singularity permanently hidden), and the outer light dies
    // harder as the arc closes the frame.
    col *= smoothstep(edge - 0.012, edge + 0.018, r);
    float vign = 1.0 - smoothstep(0.30, 1.45, r);
    col *= mix(0.9, vign, 0.35 + uDark * 0.5);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAbyss(): VisualLayer {
  const pass = new ShaderPass({
    name: 'abyss',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.25 },
      uFlow: { value: 0.4 },
      uDepth: { value: 0.5 },
      uDark: { value: 0.8 },
      uMaw: { value: 0.15 },
      uGlow: { value: 0.45 },
    },
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  function bind(registry: SignalRegistry, nodeId: string, port: string, name: string, base: number): void {
    const u = uniform(name);
    u.value = base;
    registry.addInput(makePortRef(nodeId, port), {
      kind: 'unipolar',
      base,
      min: 0,
      max: 1,
      write: (v) => {
        u.value = clamp(v, 0, 1);
      },
    });
  }

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.25));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.4));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.5));
      bind(registry, nodeId, 'maw', 'uMaw', num(params.maw, 0.15));
      bind(registry, nodeId, 'glow', 'uGlow', num(params.glow, 0.45));
    },
    update(timeSec) {
      uniform('uTime').value = timeSec;
    },
    setResolution(width, height) {
      (uniform('uResolution').value as THREE.Vector2).set(width, height);
    },
    setArc(darkness) {
      uniform('uDark').value = clamp(darkness, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
