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
  id: 'rickards',
  label: 'Moiré',
  techniqueFamily: 'interference grating',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.1, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route a slow LFO or bassMeter.level here: detune sets the beat wavelength
    { key: 'phase', kind: 'bipolar', min: -1, max: 1, default: 0.2, group: 'scene' },
    // route audio.onset here: a transient knocks the phase; it re-locks as it decays
    { key: 'jolt', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Moiré — the interference study (Paul Rickards lineage): two pens ruling
// almost the same lines; the difference is the picture. Grating A turns
// glacially against grating B, detuned by a few percent, and the beat pattern
// blooms at a scale neither pen ever drew — where both inks coincide the
// rulings glow. At depth the second pen turns circular and the beats curve.
// A transient knocks the phase apart and it re-locks as the envelope decays.
// The arc lifts one pen before the other: the beats die first, then the lines.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uPhase, uJolt;
  varying vec2 vUv;

  float grating(vec2 p, float ang, float freq, float ph){
    float s = dot(p, vec2(cos(ang), sin(ang))) * freq + ph;
    float f = abs(fract(s) - 0.5);
    float aa = 0.006 + freq * 0.0020;                 // keep the pen sharp but unaliased
    return 1.0 - smoothstep(0.10, 0.10 + aa, f);
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime;

    float rotR = 0.004 + uFlow * 0.030;               // glacial counter-rotation
    float freqA = mix(22.0, 56.0, uDepth);
    float detune = 1.0 + uPhase * 0.14 + 0.012 * sin(t * 0.05); // the beat breathes
    float freqB = freqA * detune;
    float kick = uJolt * 2.6;

    // a few degrees of standing separation — the fringes exist from the start
    float A = grating(pc, 0.7854 + t * rotR, freqA, 0.0);
    float linB = grating(pc, 0.7854 - 0.045 - t * rotR * 0.8, freqB, kick);

    // at depth the study turns circular — ring moiré against the straight pen
    vec2 cc = pc - vec2(0.10 * sin(t * 0.07), 0.06 * cos(t * 0.05));
    float fring = abs(fract(length(cc) * freqB * 0.85 + kick * 0.6) - 0.5);
    float rings = 1.0 - smoothstep(0.10, 0.112 + freqB * 0.0020, fring);
    float B = mix(linB, rings, smoothstep(0.45, 0.85, uDepth));

    // each pen lifts on its own as the arc falls — the beats die before the lines
    float fadeB = 1.0 - smoothstep(0.15, 0.60, uDark);
    float fadeA = 1.0 - smoothstep(0.45, 0.95, uDark);
    float v = A * 0.30 * fadeA + B * 0.30 * fadeB + A * B * 0.50 * fadeA * fadeB;

    vec3 ink = vec3(0.50, 0.52, 0.55);                // cool plotter grey (linear)
    vec3 col = vec3(0.010, 0.011, 0.013) + ink * v;
    col += uFog * 0.025 * vec3(0.35, 0.36, 0.38);
    col *= 1.0 - 0.40 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createRickards(): VisualLayer {
  const pass = new ShaderPass({
    name: 'rickards',
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

export const rickardsModule: VisualModule = {
  descriptor,
  create: createRickards,
};
