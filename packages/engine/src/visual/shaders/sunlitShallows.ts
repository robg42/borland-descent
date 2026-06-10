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
  id: 'sunlitShallows',
  label: 'Cathedral of Light',
  techniqueFamily: 'light shafts',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'shafts', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'scene' },
    { key: 'glint', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Cathedral of Light: a fan of green-glass god-rays from an unseen sun above the
// upper-left corner, cutting the frame diagonally over deepening teal. Three
// superposed angular combs (7/14/23 shafts) counter-sweep at glacial speed while
// dust-motes — the only upward motion in the piece — rise through the bright
// wedges and flare when the bells strike. The gaps already belong to the deep;
// the beams belong to the sky. Cheap by design: no fbm stacks, no loops — one
// atan, two noise calls and two single-cell mote lookups per pixel.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uShafts, uGlint, uDark;
  varying vec2 vUv;

  const float TAU = 6.2831853;

  // One angular comb of soft shafts fanning out from the sun anchor.
  float beamSet(float ang, float freq, float phase, float sharp){
    float s = 0.5 + 0.5 * sin(ang * freq + phase);
    return pow(s, sharp);
  }

  // One mote layer: a single hash sparkle per grid cell, twinkle-phased by its
  // own hash and gated so only a fraction glint at once. The jitter is clamped
  // inside the cell, so no 3x3 neighbourhood search is needed.
  float motes(vec2 wp, float scale, float t, float gate){
    vec2 g = wp * scale;
    vec2 id = floor(g), f = fract(g);
    float h = hash(id);
    vec2 jit = vec2(0.18) + 0.64 * vec2(h, hash(id + 7.3));
    float d = length(f - jit);
    float tw = 0.5 + 0.5 * sin(t * (0.6 + h) * 2.0 + h * TAU); // h*TAU: a scatter is lit at t=0
    return smoothstep(gate, 1.0, tw) * exp(-d * d * 90.0);     // tight gaussian glint
  }

  void main(){
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float t = uTime * (0.3 + uFlow * 0.7);

    // The unseen sun sits above the upper-LEFT corner — top-centre radial light
    // belongs to the surface scene — so the ray fan crosses the frame on the
    // diagonal. Depth pushes it further away (longer, thinner rays); the clamp
    // guarantees the atan seam, which points straight up from it, stays off-frame.
    vec2 sun = vec2((0.15 - 0.5) * aspect, max(1.25 + uDepth * 0.5, 1.15));
    vec2 d = p - sun;
    float r = length(d);
    float ang = atan(d.x, -d.y); // 0 = straight down from the sun

    // The cathedral fan: three counter-sweeping combs. Bass (uShafts) widens the
    // duty cycle and lifts the gain — the nave inhales with the low end. Shaft
    // edges soften with distance from the sun so the narrow combs never crawl.
    float sharp = mix(9.0, 3.0, uShafts);
    sharp *= mix(1.0, 0.55, smoothstep(0.6, 1.6, r));
    float fan = beamSet(ang, 14.0,  t * 0.05,       sharp)       * 0.55
              + beamSet(ang, 23.0, -t * 0.04 + 1.7, sharp * 1.6) * 0.30
              + beamSet(ang,  7.0,  t * 0.02 + 4.0, sharp * 0.7) * 0.45;
    fan *= 0.65 + 0.55 * noise(vec2(ang * 9.0, t * 0.35)); // light wobbling through the moving surface
    float decay = mix(1.1, 2.4, uDark);                    // deeper in the arc, light dies sooner
    float beam = fan * exp(-max(r - 0.25, 0.0) * decay) * (0.55 + 0.45 * uShafts);

    // Water body: a two-stop teal gradient plus one cheap noise octave. The gap
    // light collapses fastest with the arc, so contrast RISES before brightness
    // falls — leaving the scene, only the shafts survive against deep teal.
    float body = noise(p * 3.0 + vec2(0.0, -t * 0.1));
    float gapLight = mix(0.50, 0.14, uDark);
    vec3 col = mix(vec3(0.027, 0.188, 0.212),  // #073036 deepening-teal floor
                   vec3(0.180, 0.420, 0.368),  // #2E6B5E sea-green mid-water
                   uv.y * gapLight * (0.7 + 0.3 * body));

    // The scene cedes gold: beam body is green-glass chartreuse, cooling toward
    // pale sea-green at depth. Only a faint warm lift survives near the anchor —
    // a luminous top edge, never sand-gold dominance.
    vec3 beamCol = mix(vec3(0.624, 0.749, 0.541),  // #9FBF8A green-glass chartreuse
                       vec3(0.50, 0.70, 0.55),     // cooler pale green at depth
                       uDark * 0.7);
    beamCol = mix(beamCol, vec3(0.76, 0.78, 0.56), 0.35 * exp(-max(r - 0.25, 0.0) * 2.0));
    col += beam * beamCol * 0.9; // beam-core luma ~0.8, above the bloom threshold

    // Rising motes — the only upward motion in the seven scenes. Two parallax
    // layers; bells (uGlint) drop the twinkle gate so constellations flare at
    // once, while the arc raises it so fewer particles catch the failing light.
    float rise = t * 0.06;
    float gate = clamp(0.62 + 0.25 * uDark - 0.35 * uGlint, 0.1, 0.9);
    float m = motes(p + vec2(0.0, -rise),       14.0, t,       gate)
            + motes(p + vec2(3.7, -rise * 1.8), 26.0, t * 1.3, gate + 0.08);
    m *= 0.35 + 0.65 * smoothstep(0.05, 0.5, beam);        // the dust lives IN the light
    col += m * (0.6 + 1.8 * uGlint) * vec3(0.84, 0.93, 0.76); // pale glint, green-biased

    // Fog: milky green scatter filling the gaps and softening the architecture —
    // a volumetric haze that is brightest where it sits inside a beam.
    col = mix(col, vec3(0.45, 0.55, 0.42) * (0.35 + 0.5 * beam), uFog * 0.22);

    // Eased settle: mid-arc keeps its glow and the darkening accelerates only
    // near the handoff to the thermocline — the structural dimming is already
    // done by the ray decay and the collapsing gap light above.
    col *= mix(1.0, 0.30, uDark * uDark);
    col *= mix(0.7, 1.0, smoothstep(1.35, 0.3, length(uv - 0.5)));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSunlitShallows(): VisualLayer {
  const pass = new ShaderPass({
    name: 'sunlitShallows',
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
      uniform('uDark').value = clamp(darkness, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

export const sunlitShallowsModule: VisualModule = {
  descriptor,
  create: createSunlitShallows,
};
