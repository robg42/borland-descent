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

  // The warm half — a dying stratified sky: graded horizontal banding, NOT an
  // isotropic haze. The last warmth pools against the seam and ashes out overhead;
  // the strata shear leftward, against the cold half's drift. Noise is kept at
  // whisper amplitude — just enough to unstraighten the layers.
  vec3 warmField(vec2 uv, float ly, float t, float aspect){
    float h = (uv.y - ly) / max(1.0 - ly, 0.10); // 0 at the seam, 1 at the frame top
    float drift = t * 0.012 * (0.3 + uFlow);     // glacial shear, opposite to below
    float yb = h * 7.0
      + 0.20 * sin(uv.x * aspect * 2.6 + drift * 3.0 + 0.8)
      + 0.25 * (noise(vec2(uv.x * aspect * 1.4 + drift, h * 3.0 + 5.2)) - 0.5);
    float strata = 0.5 + 0.5 * sin(yb * 3.1);
    strata = mix(strata, 0.5 + 0.5 * sin(yb * 1.3 + 2.1), 0.45); // two widths, no rhythm
    float glow = exp(-h * 2.6);                  // the grade: horizon-bright, grey above
    vec2 sd = uv - vec2(0.38, 0.85);             // sun-memory lobe at the upper-left third
    float sun = exp(-(6.0 * sd.x * sd.x + 14.0 * sd.y * sd.y));
    // Values are LINEAR — the OutputPass sRGB-encodes, so linear 0.3 displays
    // ≈ 0.62; the faded amber-grey must be authored low or it washes to white.
    vec3 amber = mix(vec3(0.30, 0.255, 0.175), vec3(0.185, 0.18, 0.16), uDark); // warmth dies
    vec3 ash = mix(vec3(0.12, 0.12, 0.115), vec3(0.085, 0.09, 0.10), uDark);
    vec3 col = mix(ash, amber, glow * (0.55 + 0.45 * strata));
    col += vec3(0.90, 0.85, 0.74) * sun * 0.24 * (1.0 - uDark); // lobe extinguishes late-arc
    return mix(col, vec3(0.22, 0.22, 0.21), uFog * 0.25);       // fog greys the sky
  }

  // Thin pale isotherm lines on dark ground — re-evaluated per channel with offset
  // coordinates for the chromatic tear, while the fbm grain g is shared.
  float isoBands(float yw, float g){
    return smoothstep(0.78, 0.99, 0.5 + 0.5 * sin(yw * 44.0 + g * 3.0));
  }

  // The cold half — striations through a wobbling schlieren lens, shearing the other
  // way. The lens amplitude decays exponentially with depth (the gradient lives AT
  // the thermocline) and the sqrt-warped depth packs the bands against the seam.
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
    vec3 col = mix(vec3(0.039, 0.055, 0.118), vec3(0.208, 0.275, 0.420),
                   0.25 + 0.5 * g * reach);
    col += b * mix(vec3(0.30, 0.36, 0.46), vec3(0.18, 0.26, 0.42), uDark); // lines cool (linear)
    col += vec3(0.63, 0.55, 0.40) * exp(-d * 26.0) * 0.30 * (1.0 - uDark * 0.7); // TIR smear
    return mix(col, vec3(0.14, 0.16, 0.20), uFog * 0.35 * (1.0 - reach)); // fog lifts the deep
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
