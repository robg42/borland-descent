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

// Noctiluca — the midnight zone. At 600 m the only light left is alive: the water
// is deleted entirely (no field, no gradient, no vignette — ~95% of pixels are pure
// black) and a shoal of ~14 bioluminescent motes carries the whole frame. Each mote
// rides an analytic elliptical orbit whose single sin/cos pair also yields velocity
// and acceleration, so the curved comet trail is two capsule glows along the
// quadratic ghost path — no history buffer. The shoal flares together on the bass
// breath (pulse), single motes spark on high-band transients (flicker), and every
// ~9 s a chain-flare runs mote-to-mote up the diagonal drift line. The arc thins,
// stills and chills the constellation: it dies out rather than dims out.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark;
  uniform float uPulse, uFlicker;
  varying vec2 vUv;

  // Per-mote constants from golden-ratio / R2 low-discrepancy sequences: evenly
  // scattered, stable across frames, and no sin-hash anywhere in the layer.
  float h1(float i){ return fract(i * 0.6180339887 + 0.36); }
  float h2(float i){ return fract(i * 0.7548776662 + 0.13); }
  float h3(float i){ return fract(i * 0.5698402910 + 0.71); }

  // Three inverse-square light kernels: a hot pinprick core (the only thing that
  // crosses the bloom threshold), a wide fog-gated turbidity halo, and a tapering
  // capsule glow used twice per mote to draw the curved trail.
  float core(float d){ return 2.2e-5 / (d * d + 6.0e-5); }
  float halo(float d){ return 1.1e-3 / (d * d + 0.030); }
  float trailGlow(vec2 q, vec2 a, vec2 b){
    vec2 pa = q - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    return (1.0 - h) * (1.0 - h) * 2.4e-4 / (d * d + 8.0e-4); // bright head, dying tail
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 uv = vec2(vUv.x * aspect, vUv.y);
    float t = uTime * (0.35 + uFlow * 1.1);
    vec3 col = vec3(0.0); // absolute black — there is no water, only the lights

    // Residency progress through this scene's stretch of the arc: uDark carries the
    // DARKNESS macro, which sweeps ≈[0.64, 0.76] across arcRange [0.6, 0.74] — 0 at
    // entry from twilight, 1 at the hand-off into abyssal. All structural arc
    // response (population, stillness, temperature) is driven from this.
    float res = clamp((uDark - 0.64) / 0.12, 0.0, 1.0);
    // Mid-residency bell: tint runs desaturated bio-green -> electric -> cold teal.
    float mid = 1.0 - abs(2.0 * res - 1.0);

    float flare = 0.55 + 1.45 * uPulse;   // the shoal inhales light on the bass breath
    float alive = 1.0 - 0.5 * res;        // the shoal thins from ~14 toward ~7

    // Chain-flare: a brightness wave that propagates mote-to-mote along the drift
    // line on a ~9 s cycle, with off-screen margins at both ends so it is born and
    // dies in the dark. +0.45 phase puts the wave mid-line in the frozen t=0 frame.
    float wavePos = -0.25 + 1.5 * fract(uTime / 9.0 + 0.45);

    for (int i = 0; i < 14; i++){
      float fi = float(i);
      // smooth thinning: each mote's keep threshold against its golden-ratio id,
      // smoothstepped so no light ever pops in or out
      float keep = 1.0 - smoothstep(alive - 0.05, alive + 0.05, h1(fi + 13.0));
      // anchor: R2 point squashed onto a loose lower-left -> upper-right drift line
      float lineU = h2(fi);               // the mote's coordinate ALONG that line
      vec2 a = vec2(lineU, h3(fi));
      a.y = mix(a.y, 0.28 + 0.45 * a.x, 0.45);
      a.x *= aspect;
      // elliptical drift — ONE sin/cos pair shared by position, velocity, curvature
      float w  = 0.25 + 0.35 * h1(fi + 9.0);
      float th = w * t + 6.2832 * h3(fi + 4.0);
      float s = sin(th), c = cos(th);
      vec2 ax = (0.030 + 0.045 * h2(fi + 2.0)) * vec2(1.0, 0.55 + 0.5 * h1(fi + 5.0));
      ax *= 1.0 - 0.45 * res;                    // deeper: survivors hang stiller
      vec2 p = a + ax * vec2(s, c);
      p.y = fract(p.y - uTime * 0.004 * uDepth); // marine-snow sink, wrapped
      vec2 v  =  w * ax * vec2(c, -s);           // analytic velocity (free)
      vec2 ac = -w * w * ax * vec2(s, c);        // analytic accel -> CURVED tail (free)
      float tau = (0.5 + 1.1 * uDepth) * 0.55 / max(w, 0.2); // depth = tail length
      vec2 m = p - v * tau       + 0.5 * ac * tau * tau;     // quadratic ghost path
      vec2 e = p - v * 2.0 * tau + 2.0 * ac * tau * tau;
      // adagio breathing: golden-angle phase spread => ~1/3 of motes lit in any still
      float br = 0.30 + 0.70 * pow(0.5 + 0.5 * sin(t * (0.5 + 0.4 * h2(fi + 7.0)) + fi * 2.39996), 4.0);
      br *= flare * keep;
      // chain-flare envelope: sharp arrival as the wave reaches this mote's place on
      // the line, slow decay after it passes; fades toward rarity with the descent
      float dw = lineU - wavePos;
      float chain = smoothstep(0.10, 0.0, dw) * smoothstep(-0.45, -0.08, dw);
      br *= 1.0 + 2.6 * chain * (1.0 - 0.55 * uDark);
      // high-band spark lottery: ~110 ms slots (9 Hz), at most a mote or two firing
      float spark = uFlicker * step(0.93, fract(h1(fi) + floor(uTime * 9.0) * 0.618));
      br *= 1.0 + 3.0 * spark;
      br *= smoothstep(0.0, 0.08, p.y) * smoothstep(1.0, 0.92, p.y); // hide the wrap

      // biological register: enter partly-desaturated bio-green, reach electric
      // cyan/green only mid-residency, leave cold and deep for abyssal
      vec3 elec = mix(vec3(0.10, 0.96, 0.88), vec3(0.36, 1.0, 0.56), h3(fi + 11.0));
      vec3 tint = mix(mix(vec3(0.30, 0.60, 0.40), vec3(0.14, 0.50, 0.56), res),
                      elec, 0.25 + 0.75 * mid);
      tint = mix(tint, vec3(0.81, 1.0, 0.95), 0.45 * min(spark, 1.0)); // aqua-white flick

      float d = length(uv - p);
      float k = core(d) * br;
      // capped chroma: the hotter the core, the further it leans toward deep teal,
      // so the bloomed edge reads #0B4A52-ish — never white-hot electric cyan
      vec3 hot = mix(tint, vec3(0.13, 0.60, 0.68), clamp(k * 0.25, 0.0, 0.6));
      col += hot * k;
      col += vec3(0.10, 0.52, 0.60) * (br * uFog * halo(d)); // colder than the source
      col += tint * br * (trailGlow(uv, p, m) * 0.9 + trailGlow(uv, m, e) * 0.45);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createMidnightZone(): VisualLayer {
  const pass = new ShaderPass({
    name: 'midnightZone',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.25 },
      uFlow: { value: 0.3 },
      uDepth: { value: 0.5 },
      uDark: { value: 0.65 },
      uPulse: { value: 0 },
      uFlicker: { value: 0 },
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
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.3));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.5));
      bind(registry, nodeId, 'pulse', 'uPulse', num(params.pulse, 0));
      bind(registry, nodeId, 'flicker', 'uFlicker', num(params.flicker, 0));
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
