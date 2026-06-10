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
  id: 'anadol',
  label: 'Archive',
  techniqueFamily: 'data sculpture',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route audio.flux here: movement colours the archive
    { key: 'chroma', kind: 'unipolar', min: 0, max: 1, default: 0.25, group: 'scene' },
    // route audio.onset here: each transient billows the mass
    { key: 'surge', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Archive — the data sculpture (Refik Anadol lineage): one near-full-bleed slab
// standing in gallery dark, its edge a thin LED line, its interior a churning
// archive — striated fluid folding under its own weight, a million records read
// as material. Chroma asks the archive to remember its colours; a transient
// billows the whole mass. The arc empties it: the level falls, the mass settles
// to the floor of the slab and compresses, until only the frame's edge holds a
// charge — and then barely that.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uChroma, uSurge;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm3(vec2 p){ return 0.55 * noise(p) + 0.30 * noise(p * 2.04 + 11.3) + 0.15 * noise(p * 4.13 + 29.7); }
  float fbm2(vec2 p){ return 0.62 * noise(p) + 0.38 * noise(p * 2.11 + 5.1); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime;

    // the plinth: a near-full-bleed slab, gallery-dark around it
    vec2 he = vec2(aspect * 0.5 - 0.045, 0.5 - 0.085);
    vec2 b = abs(pc) - he;
    float boxD = max(b.x, b.y);
    float inside = 1.0 - step(0.0, boxD);
    float edge = (1.0 - smoothstep(0.0015, 0.0045, abs(boxD))) + 0.16 * exp(-abs(boxD) * 30.0);

    // inside: the archive churning — striated fluid folding under its own weight
    vec2 p = pc * mix(2.2, 4.0, uDepth);
    float ct = t * (0.04 + uFlow * 0.16);
    float wAmp = 1.35 * (1.0 + uSurge * 0.55);
    vec2 W = vec2(fbm2(p * 1.4 + vec2(ct, -ct * 0.5)),
                  fbm2(p * 1.4 + vec2(7.7, 2.2) + vec2(-ct * 0.7, ct * 0.9 - t * 0.012)));
    float m = fbm3(p * 1.1 + wAmp * W);
    float stria = pow(0.5 + 0.5 * sin(m * 6.2831 * mix(4.0, 9.0, uDepth) + ct * 2.0), 2.0);
    float lum = pow(max(m, 0.0), 1.5) * (0.22 + 0.78 * stria) * 1.55;

    // the arc drains the archive: the level falls, the mass settles
    float yIn = (pc.y + he.y) / (2.0 * he.y);            // 0 floor .. 1 ceiling
    float level = 1.0 - uDark * 0.92;
    float fill = 1.0 - smoothstep(level - 0.06, level + 0.10, yIn);
    lum *= fill;

    // chroma: the archive remembers its colours when asked — a mineral arc,
    // sandstone to glacial teal, the same animating term carrying the flow
    vec3 mono = vec3(0.72, 0.70, 0.66);
    float hueT = 0.5 + 0.5 * cos(6.2831 * (m * 0.9 + ct * 0.25));
    vec3 hue = mix(vec3(0.52, 0.45, 0.36), vec3(0.26, 0.38, 0.40), hueT);
    vec3 dataCol = mix(mono, hue, clamp(uChroma, 0.0, 1.0));

    vec3 col = dataCol * lum * inside * (1.0 + uSurge * 0.5);
    col += vec3(0.55, 0.58, 0.62) * edge * (1.0 - 0.6 * uDark); // the LED frame holds longest
    // the room: a breath of spill light around the slab
    float spill = exp(-max(boxD, 0.0) * 9.0) * 0.05 * (1.0 - uDark);
    col += vec3(0.20, 0.22, 0.26) * spill * (1.0 - inside);
    col += uFog * 0.02 * vec3(0.20, 0.21, 0.24);
    col *= 1.0 - 0.45 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAnadol(): VisualLayer {
  const pass = new ShaderPass({
    name: 'anadol',
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

export const anadolModule: VisualModule = {
  descriptor,
  create: createAnadol,
};
