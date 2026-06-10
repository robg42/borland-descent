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
  id: 'henke',
  label: 'Lumière',
  techniqueFamily: 'laser figure',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // the room's smoke: how much air the beams have to draw in
    { key: 'haze', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'scene' },
    // route audio.onset here: a strike forces every blade on and jolts the figure
    { key: 'strike', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Lumière — the laser figure (Robert Henke lineage): not projection, light as a
// blade. One closed figure drawn as eight razor segments through a lobed curve,
// each segment gated on its own shutter clock — brutally geometric, never all
// of it at once. A rare full-width scan line crosses the stage; rarer still,
// the rig goes black for a beat. Haze gives the beams air to draw in; a strike
// forces every blade on. The arc strips the lobes from the curve and flattens
// it — by the deep end one thin line turns alone in the smoke.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uHaze, uStrike;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  vec2 figureVert(float s, float t, float lobes, float aLobe, float r0, float spin, float dark){
    float ang = s * 6.2831 + spin;
    float rad = r0 * (1.0 + aLobe * cos(s * 6.2831 * lobes + t * 0.7));
    vec2 v = rad * vec2(cos(ang), sin(ang));
    v.y *= 1.0 - 0.78 * dark;          // the figure flattens toward a single beam
    return v;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime;

    float spin = t * (0.05 + uFlow * 0.25);
    float lobes = floor(mix(2.0, 5.0, uDepth) + 0.5);
    float aLobe = mix(0.16, 0.34, uDepth) * (1.0 - 0.9 * uDark);
    float r0 = 0.30 * (1.0 + uStrike * 0.10);
    float gateRate = 2.0 + uFlow * 7.0;

    float core = 0.0;
    float glow = 0.0;
    vec2 a = figureVert(0.0, t, lobes, aLobe, r0, spin, uDark);
    for (int i = 1; i <= 8; i++){
      float s = float(i) / 8.0;
      vec2 b = figureVert(s, t, lobes, aLobe, r0, spin, uDark);
      vec2 ab = b - a;
      vec2 ap = pc - a;
      float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float d = length(ap - ab * h);
      // each blade's own shutter clock — never the whole figure at once
      float gate = step(0.30, hash(vec2(float(i), floor(t * gateRate + float(i) * 0.61))));
      gate = max(gate, uStrike);
      core += gate * (1.0 - smoothstep(0.0012, 0.0035, d));
      glow += gate * (exp(-d * 90.0) * 0.45 + exp(-d * 16.0) * 0.06);
      a = b;
    }

    // one slow cross-stage scan line, rarely allowed through
    float sweepAng = t * 0.11;
    float dl = abs(dot(pc, vec2(cos(sweepAng), sin(sweepAng))));
    float lineGate = step(0.78, hash(vec2(7.7, floor(t * 0.8))));
    core += lineGate * (1.0 - smoothstep(0.0012, 0.0032, dl)) * 0.8;
    glow += lineGate * exp(-dl * 70.0) * 0.25;

    vec3 laser = vec3(0.62, 0.80, 0.66);               // cold white-green (linear)
    float v = core * (1.0 + uStrike * 1.6) + glow * (0.30 + uHaze * 0.9);
    vec3 col = laser * v;
    col += (uHaze * 0.030 + uFog * 0.012) * laser * exp(-length(pc) * 1.4); // pooled scatter
    // the rig's oldest move: a blackout beat
    float black = step(0.94, hash(vec2(3.3, floor(t * 1.3)))) * (1.0 - uStrike);
    col *= 1.0 - black * 0.85;
    col *= 1.0 - 0.55 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createHenke(): VisualLayer {
  const pass = new ShaderPass({
    name: 'henke',
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

export const henkeModule: VisualModule = {
  descriptor,
  create: createHenke,
};
