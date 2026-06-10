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
