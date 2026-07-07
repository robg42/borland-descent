import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from '../../core/curves';
import {
  bindDescriptorPorts,
  descriptorUniforms,
  type VisualModule,
  type VisualModuleDescriptor,
} from '../moduleDescriptor';
import type { VisualLayer } from './types';
import { glslCommon, glslVertex } from './glsl/common';

export const descriptor: VisualModuleDescriptor = {
  id: 'thermocline',
  label: 'Prism Horizon',
  techniqueFamily: 'refractive split',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'refract', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'scene' },
    { key: 'dispersion', uniform: 'uDisp', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Prism Horizon: ONE hard horizontal blade — the only hard line in the piece — splits
// a dying amber-grey stratified sky above from steel-indigo isotherm striations below,
// seen through a schlieren lens that bends and RGB-fringes them. The two halves shear
// past each other in opposite directions; the seam is a literal prism (offset R/G/B
// hairlines) that flares with the refract pad. As the arc darkens the cold claims the
// frame: the blade rises 0.45 → 0.74, the warmth ashes out, the lines cool to blue.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uRefract, uDisp, uDark;
  varying vec2 vUv;

  // The optical interface — a function of x only, so the split stays a true horizontal
  // blade. Two incommensurate sines plus low-frequency noise give a slow meniscus
  // wobble; the phase constants freeze the t=0 seam in a gentle S (dipping left of
  // centre, lifting right) for the reduced-motion still.
  float lineY(float x, float t){
    float base = mix(0.45, 0.74, uDark); // arc: the cold claims the frame
    return base
      + 0.014 * sin(x * 6.0 - t * 0.5 - 3.3)
      + 0.007 * sin(x * 17.0 + t * 1.1 + 1.3)
      + 0.020 * (noise(vec2(x * 2.5, t * 0.18 + 2.7)) - 0.5);
  }

  // The warm half — a dying stratified sky: the last light pools in a tight
  // horizon glow against the seam and ashes out fast overhead. Banding is
  // broad, soft and sparse (cloud strata remembered through water), the
  // strata shear leftward, against the cold half's drift.
  vec3 warmField(vec2 uv, float ly, float t, float aspect){
    float h = (uv.y - ly) / max(1.0 - ly, 0.10); // 0 at the seam, 1 at the frame top
    float drift = t * 0.012 * (0.3 + uFlow);     // glacial shear, opposite to below
    // three broad strata, softened and thinned with height — no rhythm, no noise wash
    float yb = h * 4.2
      + 0.14 * sin(uv.x * aspect * 1.9 + drift * 3.0 + 0.8)
      + 0.18 * (noise(vec2(uv.x * aspect * 1.1 + drift, h * 2.2 + 5.2)) - 0.5);
    float strata = pow(0.5 + 0.5 * sin(yb * 3.1), 2.0) * exp(-h * 1.8);
    float glow = exp(-h * 5.5);                  // the horizon light, held tight to the seam
    float high = exp(-h * 1.4);                  // the wider memory of it
    vec2 sd = uv - vec2(0.38, 0.85);             // sun-memory lobe at the upper-left third
    float sun = exp(-(7.0 * sd.x * sd.x + 18.0 * sd.y * sd.y));
    // LINEAR values, authored dark: the sky must read as dying, not daylight.
    vec3 nightAsh = mix(vec3(0.030, 0.032, 0.038), vec3(0.018, 0.020, 0.026), uDark);
    vec3 amber = mix(vec3(0.36, 0.27, 0.15), vec3(0.10, 0.10, 0.11), uDark); // warmth dies
    vec3 haze = mix(vec3(0.10, 0.088, 0.070), vec3(0.05, 0.052, 0.06), uDark);
    vec3 col = nightAsh
             + haze * high * (0.6 + 0.4 * strata)
             + amber * glow * (0.75 + 0.25 * strata);
    col += vec3(0.55, 0.46, 0.32) * sun * 0.16 * (1.0 - uDark); // lobe extinguishes late-arc
    return mix(col, vec3(0.055, 0.058, 0.062), uFog * 0.35);    // fog greys the sky
  }

  // Thin pale isotherm lines on dark ground — re-evaluated per channel with offset
  // coordinates for the chromatic tear, while the fbm grain g is shared.
  float isoBands(float yw, float g){
    return smoothstep(0.86, 0.99, 0.5 + 0.5 * sin(yw * 44.0 + g * 3.0));
  }

  // The cold half — delicate isotherms through a wobbling schlieren lens, shearing
  // the other way. The lens amplitude decays exponentially with depth (the gradient
  // lives AT the thermocline); the sqrt-warped depth packs the lines against the
  // seam, and their light dies away below — packed and bright at the interface,
  // dissolving into steel-indigo dark.
  vec3 coldField(vec2 uv, float ly, float t, float aspect){
    float d = ly - uv.y;                                       // depth below the seam
    vec2 q = vec2(uv.x * aspect - t * 0.012 * (0.3 + uFlow), uv.y);
    float reach = exp(-d * (6.0 - 4.0 * uDepth));              // lens strongest at the seam
    float amp = uRefract * 0.05 * (0.35 + reach);
    vec2 off = amp * vec2(noise(q * 3.0 + vec2(t * 0.15, 0.0)) - 0.5,
                          noise(q * 3.0 + vec2(0.0, t * 0.11) + 7.3) - 0.5);
    float g = fbm3((q + off) * 2.0);                           // shared grain — ONCE
    float yw = sqrt(d + 0.02) * (2.0 + 1.5 * uDepth);          // sqrt packs bands at the seam
    float ds = uDisp * (0.006 + 0.02 * reach);                 // fringe widens at the seam
    vec3 b = vec3(isoBands(yw + (off.y + ds) * 1.6, g),        // R displaced up
                  isoBands(yw + off.y * 1.6, g),               // G carries the lens only
                  isoBands(yw + (off.y - ds) * 1.6, g));       // B down — the RGB tear
    // the lines fade with depth and vary along their length — drawn, not printed
    float fade = (0.25 + 0.75 * reach) * (0.55 + 0.45 * g);
    vec3 ground = mix(vec3(0.014, 0.020, 0.042), vec3(0.055, 0.075, 0.128),
                      0.2 + 0.4 * g * reach);
    vec3 col = ground
             + b * fade * mix(vec3(0.26, 0.32, 0.44), vec3(0.14, 0.20, 0.36), uDark);
    // the squashed warm reflection of the dying sky, hanging under the meniscus
    float smear = exp(-d * 20.0) * (0.55 + 0.45 * noise(vec2(q.x * 5.0, t * 0.2)));
    col += vec3(0.45, 0.34, 0.19) * smear * 0.28 * (1.0 - uDark * 0.8);
    return mix(col, vec3(0.05, 0.06, 0.08), uFog * 0.35 * (1.0 - reach)); // fog lifts the deep
  }

  void main(){
    float t = uTime;
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float ly = lineY(uv.x, t);

    // HARD branch on the seam — screen-coherent, so each pixel pays only its own
    // half's cost. Do not soften this into a mix: the hard split is both the look
    // and the budget.
    vec3 col;
    if (uv.y > ly) {
      col = warmField(uv, ly, t, aspect);
    } else {
      col = coldField(uv, ly, t, aspect);
    }

    // The prism blade: three ~1.5px lines offset one physical pixel apart, tinted
    // R/G/B — widths in pixels via uResolution so the seam never aliases away.
    float w = 1.6 / uResolution.y;
    float po = 1.0 / uResolution.y;
    vec3 blade = vec3(1.0 - smoothstep(0.0, w, abs(uv.y - ly - po)),
                      1.0 - smoothstep(0.0, w, abs(uv.y - ly)),
                      1.0 - smoothstep(0.0, w, abs(uv.y - ly + po)));
    vec3 tint = mix(vec3(1.00, 0.92, 0.74), vec3(0.78, 0.90, 1.00), uDark); // warm → icy
    // The pad flares the blade; the gain eases over the last stretch of residency so
    // the crossfade over twilight's light cone reads as a horizon, not a scanline.
    float gain = (0.9 + 0.4 * uRefract) * (1.0 - 0.55 * smoothstep(0.88, 1.0, uDark));
    col += blade * tint * gain;

    gl_FragColor = vec4(min(col, vec3(1.2)), 1.0); // pre-bloom clamp — load-bearing
  }
`;

// The arc's darkness MACRO (not the arc position) sweeps ≈[0.41, 0.52] while this
// scene is resident (arcRange [0.32, 0.46] interpolated through the canonical patch's
// keyframes): remap to a local 0..1 so the blade completes its whole 0.45 → 0.74 climb
// on screen instead of crawling a few percent. Retune if the arc keyframes change.
const ARC_WINDOW_IN = 0.41;
const ARC_WINDOW_OUT = 0.52;

export function createThermocline(): VisualLayer {
  const pass = new ShaderPass({
    name: 'thermocline',
    uniforms: descriptorUniforms(descriptor, {
      uResolution: { value: new THREE.Vector2(1, 1) },
    }),
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bindDescriptorPorts(descriptor, pass, nodeId, registry, params);
    },
    update(timeSec) {
      uniform('uTime').value = timeSec;
    },
    setResolution(width, height) {
      (uniform('uResolution').value as THREE.Vector2).set(width, height);
    },
    setArc(darkness) {
      const local = (clamp(darkness, 0, 1) - ARC_WINDOW_IN) / (ARC_WINDOW_OUT - ARC_WINDOW_IN);
      uniform('uDark').value = clamp(local, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

export const thermoclineModule: VisualModule = {
  descriptor,
  create: createThermocline,
};
