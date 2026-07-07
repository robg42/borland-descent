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
  id: 'akten',
  label: 'Meditation',
  techniqueFamily: 'neural field',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // the dial between the sea it learned and the breath it imagined
    { key: 'morph', kind: 'unipolar', min: 0, max: 1, default: 0.25, group: 'scene' },
    // route audio.onset here: the field inhales on each transient
    { key: 'swell', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Meditation — the neural field (Memo Akten lineage): a slow billowing mass
// warped by its own reading of itself, the way a network dreams the sea —
// recognisably natural, physically impossible, too smooth to be weather. Morph
// carries it from learned water (cool, horizon-weighted) to imagined breath
// (warm, centreless); a transient makes the whole field inhale. The arc is
// forgetting: motion slows, contrast collapses toward the mean, until the
// phenomenon is a barely-breathing murk.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uMorph, uSwell;
  varying vec2 vUv;

  // weighted fbm variants tuned for this module (glslCommon supplies hash/noise)
  float fbmW(vec2 p){ return 0.55 * noise(p) + 0.30 * noise(p * 2.04 + 11.3) + 0.15 * noise(p * 4.13 + 29.7); }
  float fbm2(vec2 p){ return 0.62 * noise(p) + 0.38 * noise(p * 2.11 + 5.1); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = (vUv - 0.5) * vec2(aspect, 1.0);
    float spd = (0.020 + uFlow * 0.085) * (1.0 - 0.7 * uDark); // the dream slows as it dims
    float t = uTime * spd;
    vec2 p = P * mix(1.6, 3.2, uDepth);

    // the field warped by its own reading of itself — twice removed from nature
    float amp = 1.9 * (1.0 + uSwell * 0.35);
    vec2 q = vec2(fbm2(p + vec2(t, -t * 0.7)),
                  fbm2(p + vec2(5.2, 1.3) - vec2(t * 0.8, -t)));
    vec2 r = vec2(fbm2(p + amp * q + vec2(1.7, 9.2) + t * 0.5),
                  fbm2(p + amp * q + vec2(8.3, 2.8) - t * 0.4));
    float f = fbmW(p + 1.8 * r);
    // a warped field regresses to the mean — pull the contrast back out of it
    f = smoothstep(0.22, 0.80, f);

    // the wave reading leans on a horizon; the breath reading has no floor
    float waveBias = smoothstep(-0.55, 0.65, P.y + 0.45 * (f - 0.5));
    float field = mix(f * (0.55 + 0.45 * waveBias), f, uMorph);
    field = mix(field, 0.42, uDark * 0.55);             // contrast forgets itself

    // two ramps: the sea it learned, the breath it imagined (linear)
    vec3 sea = mix(vec3(0.008, 0.020, 0.030), vec3(0.10, 0.30, 0.34), smoothstep(0.18, 0.62, field));
    sea = mix(sea, vec3(0.58, 0.66, 0.62), smoothstep(0.62, 0.92, field));
    vec3 breath = mix(vec3(0.016, 0.012, 0.014), vec3(0.30, 0.24, 0.21), smoothstep(0.22, 0.66, field));
    breath = mix(breath, vec3(0.72, 0.60, 0.48), smoothstep(0.70, 0.95, field));
    vec3 col = mix(sea, breath, uMorph);

    col *= 1.0 + uSwell * 0.45;
    col += uFog * 0.035 * vec3(0.30, 0.33, 0.36);
    col *= 1.0 - 0.60 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAkten(): VisualLayer {
  const pass = new ShaderPass({
    name: 'akten',
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

export const aktenModule: VisualModule = {
  descriptor,
  create: createAkten,
};
