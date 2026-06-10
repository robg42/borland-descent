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

const vertexShader = glslVertex;

// Archive — the data sculpture (Refik Anadol lineage): one near-full-bleed slab
// standing in gallery dark, its edge a thin LED line, its interior a churning
// archive — striated fluid folding under its own weight, a million records read
// as material. Chroma asks the archive to remember its colours; a transient
// billows the whole mass. The arc empties it: the level falls, the mass settles
// to the floor of the slab and compresses, until only the frame's edge holds a
// charge — and then barely that.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uChroma, uSurge;
  varying vec2 vUv;

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
