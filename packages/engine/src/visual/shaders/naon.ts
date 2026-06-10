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

export const descriptor: VisualModuleDescriptor = {
  id: 'naon',
  label: 'Plenitude',
  techniqueFamily: 'packed geometry',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.1, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route fft.mid or audio.flux here: movement saturates the field
    { key: 'vivid', kind: 'unipolar', min: 0, max: 1, default: 0.8, group: 'scene' },
    // route audio.onset here: each transient flushes a brighter generation through
    { key: 'burst', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Plenitude — packed geometry (Manolo Gamboa Naon lineage): two stacked
// generations of discs and rings spilling over their cells, earthen kiln colour
// on a deep plum ground, arranged densely enough to read as tissue. Every disc
// breathes about its own post on its own clock — the profusion wobbles like
// something alive, nothing pops. Vivid holds the saturation; a transient
// flushes a brighter, slightly swollen generation through. The arc drains the
// colour first, then shrinks the plenitude to embers.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uVivid, uBurst;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  vec2 hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Naon's inks: kiln-fired, earthen (linear)
  vec3 palette(float h){
    vec3 c = vec3(0.45, 0.14, 0.16);                    // madder clay
    c = mix(c, vec3(0.52, 0.25, 0.11), step(0.20, h));  // terracotta
    c = mix(c, vec3(0.55, 0.42, 0.14), step(0.40, h));  // ochre
    c = mix(c, vec3(0.10, 0.33, 0.33), step(0.60, h));  // sea glass
    c = mix(c, vec3(0.12, 0.15, 0.32), step(0.78, h));  // slate indigo
    c = mix(c, vec3(0.66, 0.62, 0.55), step(0.92, h));  // warm bone
    return c;
  }

  // one packed generation: discs spill past their cells, so the 3x3 paints
  vec4 generation(vec2 P, float scale, float seed, float t){
    vec2 q = P * scale + seed;
    vec2 id = floor(q);
    vec4 acc = vec4(0.0);
    for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++){
      vec2 cid = id + vec2(float(dx), float(dy));
      vec2 h = hash2(cid * 1.013 + seed);
      // biological wobble — every disc breathes about its own post
      vec2 c = cid + 0.5 + (h - 0.5) * 0.9
             + 0.10 * vec2(sin(t * (0.4 + h.x) + h.y * 6.2831), cos(t * (0.5 + h.y) + h.x * 6.2831));
      float r = mix(0.22, 0.62, hash(cid + seed + 5.5))
              * (1.0 + uBurst * 0.16) * (1.0 - 0.40 * uDark);
      float d = length(q - c) - r;
      float fill = 1.0 - smoothstep(-0.02, 0.02, d);
      float ringLine = 1.0 - smoothstep(0.025, 0.060, abs(d));
      float isRing = step(0.72, hash(cid + seed + 9.1)); // some are strokes, not solids
      float a = mix(fill, ringLine, isRing);
      vec3 col = palette(hash(cid + seed + 1.7));
      // later discs paint over earlier — the stacked profusion
      acc.rgb = mix(acc.rgb, col, a * 0.92);
      acc.a = max(acc.a, a);
    }
    return acc;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * (0.3 + uFlow * 1.0);

    vec3 col = vec3(0.022, 0.016, 0.024);               // deep plum ground
    vec4 a = generation(P, mix(3.0, 6.0, uDepth), 0.0, t);
    vec4 b = generation(P, mix(5.5, 11.0, uDepth), 37.0, t * 1.21);
    col = mix(col, a.rgb, a.a);
    col = mix(col, b.rgb * 1.06, b.a * 0.9);

    // saturation is the instrument — the arc bleeds it away
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float sat = clamp(uVivid * (1.0 - 0.75 * uDark) + uBurst * 0.25, 0.0, 1.2) * 0.85;
    col = mix(vec3(luma), col, sat);

    col *= 1.0 + uBurst * 0.35;
    col += uFog * 0.03 * vec3(0.30, 0.28, 0.33);
    col *= 1.0 - 0.55 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createNaon(): VisualLayer {
  const pass = new ShaderPass({
    name: 'naon',
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

export const naonModule: VisualModule = {
  descriptor,
  create: createNaon,
};
