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

// Underlight — the skin of the world from a metre under, looking up. A
// white-gold caustic net (two counter-drifting animated Voronoi layers,
// F2−F1 ridges) stretched over milky turquoise, gathered round a refracted
// sun-disc and Snell window at the top edge; Beer–Lambert absorption pulls
// the lower third down to deep turquoise, the hand-off to the scene below.
// The only high-key, warm-gold frame in the descent. No fbm anywhere.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uGlint, uSun;
  varying vec2 vUv;

  // Per-cell random 2-vector — the same sin-hash family as the sibling passes.
  vec2 hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // 9-tap animated Voronoi returning (F1, F2). Each feature point orbits
  // inside its own cell on a phase-offset clock, so the net is fully knitted
  // at t = 0 (reduced motion gets a composed still) and scintillates in place
  // rather than scrolling. Squared distances in the loop, one sqrt at the end.
  vec2 voronoiF(vec2 p, float clk){
    vec2 i = floor(p), f = fract(p);
    float F1 = 8.0, F2 = 8.0;
    for (int y = -1; y <= 1; y++){
      for (int x = -1; x <= 1; x++){
        vec2 g = vec2(float(x), float(y));
        vec2 h = hash2(i + g);
        vec2 o = g - f + 0.5 + 0.42 * sin(clk + 6.2831 * h);
        float d = dot(o, o);
        if (d < F1) { F2 = F1; F1 = d; } else { F2 = min(F2, d); }
      }
    }
    return sqrt(vec2(F1, F2));
  }

  // A caustic filament is where two cells meet (F2 − F1 -> 0), pow-sharpened.
  float net(vec2 p, float clk, float width, float sharp){
    vec2 F = voronoiF(p, clk);
    return pow(1.0 - smoothstep(0.0, width, F.y - F.x), sharp);
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = vec2(vUv.x * aspect, vUv.y);

    // The sun floats just above the top edge; its azimuth follows the sun
    // port (a thumb-drag), and the arc lowers it towards the rim — the
    // surface receding overhead rather than a dimmer.
    vec2 sunPos = vec2(mix(0.18, 0.82, uSun) * aspect, 1.08 - 0.18 * uDark);
    vec2 dS = P - sunPos;
    dS += 0.035 * sin(P.yx * vec2(3.1, 2.7) + uTime * vec2(0.7, -0.55)); // refraction wobble
    float r = length(dS);

    // Looking-up perspective: cells are coarsest at the zenith beneath the
    // sun and compress towards the frame edges as the plane recedes; the
    // whole domain rides a slow breathing swell of two incommensurate sines.
    float persp = 1.0 + 1.35 * smoothstep(0.0, 1.5, r);
    float swell = 1.0 + 0.05 * sin(uTime * 0.17) + 0.03 * sin(uTime * 0.11 + 1.7);
    vec2 p = P * persp * swell;

    // Two counter-drifting net layers. Flow drives the scintillation clock
    // and the drift; depth and the arc push the coarse layer finer, as if
    // the surface is further overhead. Crossings (A·B) flare hottest, so
    // loudness on glint reads as sparkle density, not a brightness pump.
    float clk = uTime * (0.5 + 1.6 * uFlow);
    vec2 drift = uTime * (0.10 + 0.35 * uFlow) * vec2(0.31, 0.13);
    float A = net(p * (3.6 + 1.2 * uDepth + uDark) + drift, clk, 0.50, 2.2);
    float B = net(p * 6.8 - drift * 1.7 + 4.1, clk * 1.31, 0.38, 3.0);
    float caustic = 0.6 * A + 0.5 * B + 1.5 * A * B;

    // The water column: Beer–Lambert absorption towards the frame floor.
    // Depth and the arc both lengthen the path, so the ridges die from the
    // bottom up and the turquoise deepens.
    float column = (1.0 - vUv.y) * 1.3 + 0.9 * uDepth + 0.9 * uDark;
    float absorb = exp(-column * 1.05);

    // Palette: milky water aqua over a deep turquoise floor; pale aqua in
    // the Snell window (never saturated cyan — midnight owns that); the
    // white-gold pair is reserved for the net and the sun core.
    vec3 AQUA  = vec3(0.161, 0.769, 0.812); // #29C4CF dominant water body
    vec3 DEEP  = vec3(0.043, 0.369, 0.431); // #0B5E6E frame floor / hand-off anchor
    vec3 PALE  = vec3(0.549, 0.941, 0.910); // #8CF0E8 inside the Snell window
    vec3 GOLD  = vec3(1.0, 0.91, 0.659);    // #FFE8A8 the caustic net
    vec3 CORE  = vec3(1.0, 0.98, 0.929);    // #FFFAED sun core
    vec3 MILK  = vec3(0.78, 0.95, 0.93);    // fog milk: pale aqua lifted to white
    vec3 NIGHT = vec3(0.012, 0.10, 0.14);   // deep-teal hand-off hue downward

    // The Snell window hugs the sun — the sun sits above the top edge, so the
    // whole top band of a portrait frame is within r ≈ 0.45 of it; the window
    // and glare must be tight or the top third clips to white.
    float snell = 1.0 - smoothstep(0.12, 0.45, r);
    float glare = exp(-r * 4.5);             // radial god-glow, tightly sun-local
    float disc  = exp(-r * r * 26.0);        // hot refracted core

    // The body of the water: brightened inside the window, but pulled milky
    // pale rather than emissive — only ridges and the core reach 0.9+.
    vec3 water = mix(AQUA, DEEP, smoothstep(0.0, 1.7, column));
    water = mix(water, PALE, 0.30 * snell);
    vec3 col = water * (0.40 + 0.16 * snell + 0.12 * glare);

    // The net. Glint is the audio-reactive gain (the masterMeter target);
    // absorption dims it with depth; fog softens its contrast; crossings
    // tint towards the near-white core so only they cross into bloom.
    // Compress the absorption range for the net: raw absorb is ~4x stronger at
    // the top than the floor, which stacked ridge peaks past 1.0 up there.
    float gain = (0.5 + 1.2 * uGlint) * mix(0.18, 0.38, absorb) * mix(0.65, 1.0, snell);
    gain *= 1.0 - 0.3 * uFog;
    col += mix(GOLD, CORE, B) * min(caustic, 1.8) * gain * 0.85;

    // The sun itself, paling as the arc carries the surface away.
    col += CORE * (1.5 * disc + 0.30 * glare) * (1.0 - 0.75 * uDark);

    // Underwater haze: milk gathers in the light, strongest round the glare.
    col = mix(col, MILK, uFog * (0.12 + 0.25 * glare));

    // The arc's last move: the whole frame settles towards the night teal
    // the next scene opens on.
    col = mix(col, NIGHT, 0.6 * uDark);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createOceanicField(): VisualLayer {
  const pass = new ShaderPass({
    name: 'oceanicField',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.25 },
      uFlow: { value: 0.45 },
      uDepth: { value: 0.15 },
      uDark: { value: 0.2 },
      uGlint: { value: 0.5 },
      uSun: { value: 0.5 },
    },
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  function bind(
    registry: SignalRegistry,
    nodeId: string,
    port: string,
    name: string,
    base: number,
  ): void {
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
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.45));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.15));
      bind(registry, nodeId, 'glint', 'uGlint', num(params.glint, 0.5));
      bind(registry, nodeId, 'sun', 'uSun', num(params.sun, 0.5));
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
