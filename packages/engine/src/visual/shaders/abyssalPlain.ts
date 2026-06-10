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

// Leviathan's Flank: one enormous black ridged silhouette owns the frame on a ~20°
// tilt, against a thin seam of exhausted grey-green water — the negative-space scene,
// ambiguous between landform and animal. The skyline is a 1-D ridged multifractal;
// its signed distance feeds the hard edge, the near-contour crease reveal and the
// sonar rim all at once. The only event is a pale sonar wavefront expanding from a
// heart inside the mass every ~11 s; the only proof of life is a ~10 s bass-driven
// breath. Near-achromatic, matte, glacial — the stillest scene in the set.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark;
  uniform float uPulse, uSonar;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Fold a noise value into a sharp crease — ridges, not the usual soft fbm billows.
  float ridge(float n){ float r = 1.0 - abs(2.0 * n - 1.0); return r * r; }

  // The skyline: a 1-D slice of ridged multifractal with feedback weighting, so big
  // ridges beget sub-ridges and flats stay flat. Low octaves dominate deliberately —
  // one or two great humps across the width, presence rather than mountains.
  float ridged1D(float x, float seed){
    float v = 0.0, a = 0.5, w = 1.0, f = 1.0;
    for (int i = 0; i < 5; i++){
      float r = ridge(noise(vec2(x * f, seed)));
      v += a * w * r;
      w = clamp(r * 1.6, 0.0, 1.0);
      f *= 2.13; a *= 0.5;
    }
    return v;
  }

  // Long lateral folds on the flank — anisotropic (stretched 1:2), read only near the
  // contour; the interior of the mass stays matte black.
  float ridged2D(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * ridge(noise(p)); p = p * 2.07 + 11.3; a *= 0.5; }
    return v;
  }

  float fbm3(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    // World tilt of ~20° (amended up from 12° so the thumbnail never reads as a
    // horizontal horizon — thermocline owns the horizontal). Centred on mid-x so the
    // wedge pivots about the frame rather than running off one edge on wide screens.
    float ca = cos(0.35), sa = sin(0.35);
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y);
    vec2 q = vec2(ca * p.x + sa * p.y, ca * p.y - sa * p.x);
    // Local remap of this scene's residency window (global darkness ≈ 0.78–0.92).
    float arc = smoothstep(0.70, 0.95, uDark);

    // — the mass: 1-D ridged skyline plus the slow breath (bass-driven via uPulse;
    //   non-zero phase so t=0 holds a believable mid-inhale). Base raised so the
    //   silhouette owns ≥60% of the frame from scene entry, climbing with arc/depth.
    float breath  = (0.005 + 0.022 * uPulse) * sin(uTime * 0.62 + q.x * 0.9 + 2.1);
    float profile = 0.52 + 0.16 * arc + 0.10 * uDepth
                  + 0.18 * ridged1D(q.x * 5.0 + 3.0, 7.0) + breath;
    float d = q.y - profile;                       // signed height above the contour
    // Hard edge, widened slightly on low-resolution buffers rather than derivative-based.
    float edgeW  = max(0.0035, 1.5 / max(uResolution.y, 1.0));
    float inside = 1.0 - smoothstep(0.0, edgeW, d);

    // — open water: a flat grey-green band in the upper-left wedge, its light dying
    //   with the arc; the shimmer drift is glacial by construction, even at flow=1.
    float shimmer = fbm3(vec2(q.x * 1.4, q.y * 2.0) + uTime * 0.008 * (0.3 + uFlow));
    float above   = clamp(d * 2.2, 0.0, 1.0);
    vec3 paleW    = vec3(0.135, 0.157, 0.145) * mix(1.0, 0.32, arc);
    vec3 water    = mix(vec3(0.027, 0.035, 0.031), paleW, pow(above, 0.7) * (0.8 + 0.2 * shimmer));

    // — mass interior: matte near-black; the long folds whisper only near the contour.
    float crease   = ridged2D(q * vec2(2.6, 5.2));
    float nearEdge = exp(d * 22.0) * inside;       // decays into the body
    vec3 mass = vec3(0.016, 0.022, 0.019) + crease * nearEdge * vec3(0.030, 0.038, 0.034);

    // — sonar: one wavefront per T seconds from a heart inside the mass, off
    //   lower-right, so rings cross the contour at an angle, never concentric to the
    //   frame. The +0.35T phase offset freezes t=0 mid-traverse, grazing the skyline.
    const float T = 11.0;
    vec2  heart = vec2(0.35 * aspect, 0.05);
    float prog  = fract((uTime + 0.35 * T) / T);
    float dr    = length(q - heart) - prog * 1.9;
    float front = exp(-dr * dr * 900.0) * (1.0 - prog) * (1.0 - prog) * (0.35 + 0.65 * uSonar);
    float edgeBand = exp(-abs(d) * 70.0);
    vec3 rim   = front * edgeBand * 2.4         * vec3(0.56, 0.64, 0.59); // THE event: the contour reveal
    vec3 wash  = front * (1.0 - inside) * 0.10  * vec3(0.33, 0.38, 0.35); // faint pressure arc in the water
    vec3 paint = front * inside * crease * 0.5  * vec3(0.22, 0.27, 0.24); // the echo paints the flank

    // — sparse marine snow, water only, minutes-per-screen; thins as the light dies.
    float mote = smoothstep(0.992 + 0.004 * arc, 1.0,
                            noise(q * 38.0 + vec2(uTime * 0.012 * (0.2 + uFlow), uTime * 0.006)));
    vec3 dust = mote * (1.0 - inside) * 0.18 * vec3(0.36, 0.40, 0.37);

    vec3 col = mix(water, mass, inside) + rim + wash + paint + dust;
    // The veil closes the mass/water contrast gap — the crossfade softener — sparing
    // the sonar rim so the event stays legible through the fog.
    float veil = uFog * (0.35 + 0.40 * arc);
    col = mix(col, vec3(0.047, 0.055, 0.051), veil * (1.0 - edgeBand * 0.5));
    // A whisper of a vignette, centred on the open-water band.
    col *= mix(1.0, 0.86, smoothstep(0.55, 1.35, length(vUv - vec2(0.38, 0.72))));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAbyssalPlain(): VisualLayer {
  const pass = new ShaderPass({
    name: 'abyssalPlain',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.3 },
      uFlow: { value: 0.15 },
      uDepth: { value: 0.45 },
      uDark: { value: 0.8 },
      uPulse: { value: 0.25 },
      uSonar: { value: 0.6 },
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
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.3));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.15));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.45));
      // Scene-specific: the breath amplitude (intended target for bassMeter.level)
      // and the sonar return brightness (intended target for masterMeter.level).
      bind(registry, nodeId, 'pulse', 'uPulse', num(params.pulse, 0.25));
      bind(registry, nodeId, 'sonar', 'uSonar', num(params.sonar, 0.6));
    },
    update(timeSec) {
      uniform('uTime').value = timeSec;
    },
    setResolution(width, height) {
      (uniform('uResolution').value as THREE.Vector2).set(width, height);
    },
    setArc(darkness) {
      // Structural, not a brightness multiply: the shader remaps this to the scene's
      // residency window, lifting the silhouette, dimming the water band, thinning
      // the marine snow and thickening the veil — the composition inverts with depth.
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
