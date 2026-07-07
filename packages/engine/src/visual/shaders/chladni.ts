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
  id: 'chladni',
  label: 'Figures',
  techniqueFamily: 'cymatics plate',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route bassMeter.level or a slow LFO here: the note the plate is bowed at
    { key: 'pitch', kind: 'bipolar', min: -1, max: 1, default: 0.15, group: 'scene' },
    // route audio.onset here: a strike scatters the sand; it resettles as it decays
    { key: 'strike', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Figures — the cymatics plate (Chladni lineage): the whole frame is a bowed
// steel plate and the picture is sand, gathering where the plate stands still.
// The standing wave has two mode numbers; pitch detunes one against the other
// and the figure walks smoothly through shapes no integer mode ever held. A
// strike throws the sand off the nodal lines and the figure re-forms as the
// blow rings out. The arc is the bow lifting: the plate holds its figure more
// and more loosely — lines widen, grains wander — until the sand is only dust
// on dark steel.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uPitch, uStrike;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * (0.4 + uFlow * 1.2);

    // the two mode numbers — continuous, so the figure walks between shapes
    float n = mix(2.5, 7.5, uDepth) + 0.35 * sin(t * 0.11);
    float m = n + 1.0 + uPitch * 2.2 + 0.25 * sin(t * 0.07 + 2.0);

    // a strike throws the sand; the arc loosens the plate's hold on it
    float scatter = uStrike * 0.06 + uDark * 0.02;
    vec2 p = pc * 3.14159 + scatter * (hash2(pc * 57.0 + floor(t * 7.0)) - 0.5) * 2.0;

    // the standing wave (antisymmetric square-plate mode)
    float s = cos(m * p.x) * cos(n * p.y) - cos(n * p.x) * cos(m * p.y);

    // sand gathers on the nodal lines; the bow lifting widens and dims them
    float hold = mix(9.0, 3.0, uDark);
    float line = exp(-abs(s) * hold);
    float grain = 0.50 + 0.50 * noise(pc * 150.0 + hash2(vec2(floor(t * 5.0))).x * 4.0);
    float sand = line * grain * (1.0 + uStrike * 0.8);

    // where the plate moves hardest it hums — a breath of teal off the steel
    float hum = smoothstep(0.9, 1.6, abs(s)) * 0.05 * (1.0 - uDark);

    float vig = smoothstep(1.25, 0.35, length(pc));
    vec3 steel = vec3(0.008, 0.010, 0.013);
    vec3 bone = vec3(0.58, 0.54, 0.46);
    vec3 col = steel
             + bone * sand * vig * (1.0 - 0.78 * uDark)
             + vec3(0.10, 0.22, 0.22) * hum * vig;
    col += uFog * 0.03 * vec3(0.26, 0.28, 0.31);
    col *= 1.0 - 0.45 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createChladni(): VisualLayer {
  const pass = new ShaderPass({
    name: 'chladni',
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

export const chladniModule: VisualModule = {
  descriptor,
  create: createChladni,
};
