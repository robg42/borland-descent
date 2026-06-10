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
  id: 'crespo',
  label: 'Neural Zoo',
  techniqueFamily: 'neural organism',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route fft.high here: the brilliance plays on the membrane
    { key: 'sheen', kind: 'unipolar', min: 0, max: 1, default: 0.55, group: 'scene' },
    // route audio.onset here: the creature answers each transient with light
    { key: 'lumen', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Neural Zoo — the imagined organism (Sofia Crespo lineage): one specimen that
// has never existed, grown bilaterally symmetric from a ribbed bell and a noisy
// genome the network never quite resolved. The machine insists on hyper-detail:
// filigree and veining live only where there is flesh; the membrane carries an
// abalone shimmer read straight out of the latent space. It breathes,
// drifts, and answers transients with bioluminescent light at the rim. The arc
// dissolves the flesh and leaves the outline — a creature reduced to its own
// drawing in the dark, motes sinking past it.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uSheen, uLumen;
  varying vec2 vUv;

`;

export function createCrespo(): VisualLayer {
  const pass = new ShaderPass({
    name: 'crespo',
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

export const crespoModule: VisualModule = {
  descriptor,
  create: createCrespo,
};
