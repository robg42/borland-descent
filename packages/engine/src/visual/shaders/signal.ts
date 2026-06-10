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
  id: 'signal',
  label: 'Signal',
  techniqueFamily: 'signal grid',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route audio.onset here: each transient hard-inverts the frame for its envelope
    { key: 'strobe', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    { key: 'scan', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Signal — the data made visible (Ikeda / Nicolai lineage): a strict monochrome
// lattice of binary cells, barcode-weighted columns, one sweeping readout row.
// No gradients, no atmosphere — only states. Cells mutate deterministically on
// per-cell clocks (composed at t = 0); a trigger-driven strobe inverts the whole
// frame for the length of its envelope. The arc kills the data: cells black out
// and the survivors grey as darkness rises.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uStrobe, uScan;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float cols = mix(28.0, 72.0, uDepth);
    float rows = mix(12.0, 26.0, uDepth);
    vec2 g = vec2(vUv.x * aspect * cols, vUv.y * rows);
    vec2 id = floor(g);

    // every cell mutates on its own clock — the field never beats in unison
    float rate = 0.5 + uFlow * 6.0;
    float tick = floor(uTime * rate + hash(id) * 8.0);
    float on = step(0.60 + uDark * 0.28, hash(id + tick * 0.0137));

    // barcode weights: some columns carry, some stay silent
    float colW = hash(vec2(id.x, 3.7));
    on *= step(0.18, colW);

    // the readout: one bright row sweeping the lattice top to bottom
    float scanPos = fract(uTime * (0.05 + uFlow * 0.16) + 0.37); // +phase: composed still
    float scanHit = 1.0 - step(0.5, abs(id.y - floor(scanPos * rows)));

    float v = on * (0.45 + 0.55 * colW);
    v += uScan * scanHit * (0.5 * on + 0.10);

    // transient strobe: the whole field inverts for the envelope's length
    v = mix(v, 1.0 - v, clamp(uStrobe, 0.0, 1.0) * 0.9);

    vec3 col = vec3(0.55, 0.58, 0.62) * v;          // cold paper-white (linear)
    col += uFog * 0.03 * vec3(0.45, 0.5, 0.55);     // the faintest veil — data, not weather
    col *= 1.0 - 0.55 * uDark;                       // the signal dies with the descent

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSignal(): VisualLayer {
  const pass = new ShaderPass({
    name: 'signal',
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

export const signalModule: VisualModule = {
  descriptor,
  create: createSignal,
};
