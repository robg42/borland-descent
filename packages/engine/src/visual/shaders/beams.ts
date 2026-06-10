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
  id: 'beams',
  label: 'Axis',
  techniqueFamily: 'light beams',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route audio.onset here: transients flash the bars over the bloom threshold
    { key: 'pulse', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // route bassMeter.level here: the low end widens the planes
    { key: 'width', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Axis — architectural light (Nonotak / UVA / 1024 lineage): a family of hard
// parallel light-planes sharing one slowly rotating axis, each plane sequencing
// on its own deterministic clock, volumetric haze hugging the bright edges.
// Geometry, not weather: the frame is organised by a single angle. Pulse
// (trigger-routed) flashes the bars over the bloom threshold; width breathes
// with the bass. The arc strips the rig down — fewer, narrower planes, until
// one faint axis remains.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uPulse, uWidth;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);

    // one shared axis, rotating glacially; +0.6 phase composes the t=0 still
    float ang = uTime * (0.02 + uFlow * 0.10) + 0.6;
    float s = dot(p, vec2(cos(ang), sin(ang)));

    // plane family: count falls as the arc strips the rig
    float freq = mix(mix(2.5, 7.0, uDepth), 1.6, uDark * 0.7);
    float x = s * freq;
    float cell = floor(x + 0.5);
    float fx = x - cell; // signed distance to the nearest plane's centre line

    float w = mix(0.05, 0.24, uWidth) * (1.0 - 0.4 * uDark);
    float hard = 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.02, abs(fx));
    float glow = exp(-abs(fx) * 9.0);

    // per-plane sequencing — each plane gates on its own deterministic clock
    float seq = 0.45 + 0.55 * step(0.38, hash(vec2(cell, floor(uTime * (0.4 + uFlow * 1.8) + hash(vec2(cell, 9.1)) * 4.0))));

    float v = hard * seq * 0.85 + glow * 0.08 * (0.4 + 0.6 * seq);
    v *= 1.0 + uPulse * 1.4 * hard;   // the transient flash — bars cross into bloom

    vec3 cold = vec3(0.55, 0.66, 0.85);              // cold white-blue planes (linear)
    vec3 col = cold * v;
    col += uFog * 0.05 * vec3(0.25, 0.32, 0.45) * glow; // haze hugs the light
    col *= 1.0 - 0.5 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createBeams(): VisualLayer {
  const pass = new ShaderPass({
    name: 'beams',
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

export const beamsModule: VisualModule = {
  descriptor,
  create: createBeams,
};
