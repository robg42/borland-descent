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

// Axis — architectural light (Nonotak / UVA / 1024 lineage), in two registers:
// a dim family of INFINITE parallel planes sharing one slowly rotating axis
// (the architecture), and over them a brighter rig of SHORT travelling
// streaks — finite segments pitched between 45° and 90° from the horizontal,
// drifting across the frame. Planes and streaks each sequence on their own
// deterministic clocks (the flash is the identity). Pulse (trigger-routed)
// flashes the streaks over the bloom threshold; width breathes both registers
// with the bass. The arc strips the rig — fewer, narrower lights — until one
// faint traveller crosses a single pale plane.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uPulse, uWidth;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = vec2(vUv.x * aspect, vUv.y);
    float t = uTime;

    float v = 0.0;
    float g = 0.0;

    // ---- register one: the infinite planes — dim, architectural, and visibly
    // ROTATING on their own clock (independent of the streaks' travel) ----
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float pAng = t * (0.05 + uFlow * 0.22) + 0.6; // a quarter-turn in ~15-30s
    float pS = dot(pc, vec2(cos(pAng), sin(pAng)));
    float pFreq = mix(mix(2.5, 6.0, uDepth), 1.6, uDark * 0.7);
    float pX = pS * pFreq;
    float pCell = floor(pX + 0.5);
    float pFx = pX - pCell;
    float pW = mix(0.05, 0.22, uWidth) * (1.0 - 0.4 * uDark);
    float pHard = 1.0 - smoothstep(pW * 0.5, pW * 0.5 + 0.02, abs(pFx));
    float pGlow = exp(-abs(pFx) * 9.0);
    float pSeq = 0.45 + 0.55 * step(0.38, hash(vec2(pCell, floor(t * (0.4 + uFlow * 1.8) + hash(vec2(pCell, 9.1)) * 4.0))));
    v += pHard * pSeq * 0.4 + pGlow * 0.05 * (0.4 + 0.6 * pSeq); // the dim base layer
    g += pGlow * 0.02;

    // ---- register two: the short streaks FLOWING across the screen — their
    // travel clock is unrelated to the planes' rotation, so the two registers
    // never read as one rigid body ----
    float count = mix(4.0, 7.0, uDepth) * (1.0 - 0.5 * uDark); // the arc strips the rig
    float travel = 0.09 + uFlow * 0.30; // a streak crosses the frame in ~5-10s
    float wBase = mix(0.02, 0.06, uWidth) * (1.0 - 0.35 * uDark);
    // branch-free fixed loop: streaks beyond the count contribute zero via on
    for (int i = 0; i < 7; i++){
      float fi = float(i);
      float on = step(fi + 0.5, count + 0.5);
      vec2 h = vec2(hash(vec2(fi, 1.3)), hash(vec2(fi, 7.7)));
      // pitch locked between 45° and 90° from horizontal (PI/4 .. PI/2)
      float ang = mix(0.7854, 1.5708, hash(vec2(fi, 3.9)));
      vec2 u = vec2(cos(ang), sin(ang));
      // each streak drifts across the frame — mostly sideways, a slow rise.
      // The wrap-space margins are PROPORTIONAL to the frame (a portrait frame
      // is barely half a unit wide — absolute margins would park most of the
      // travel off-screen); phase offsets compose the t=0 still in-frame.
      float cx = (fract(h.x + t * travel * (0.5 + h.y)) * 1.3 - 0.15) * aspect;
      float cy = fract(h.y + t * travel * 0.3 * (0.3 + h.x)) * 1.2 - 0.1;
      float len = mix(0.22, 0.5, hash(vec2(fi, 5.1))) * (1.0 + 0.3 * uDepth);
      // finite segment: hard core between soft end-caps, tight local haze
      vec2 d = P - vec2(cx, cy);
      float along = abs(dot(d, u));
      float perp = abs(dot(d, vec2(-u.y, u.x)));
      float cap = 1.0 - smoothstep(len * 0.5 - 0.05, len * 0.5 + 0.06, along);
      float core = (1.0 - smoothstep(wBase * 0.5, wBase * 0.5 + 0.012, perp)) * cap;
      // the per-streak flash sequencing — each gates on its own clock
      float seq = 0.4 + 0.6 * step(0.38, hash(vec2(fi, floor(t * (0.5 + uFlow * 2.2) + h.x * 4.0))));
      v += on * core * seq * (0.7 + uPulse * 1.2); // the flash carries it into bloom
      g += on * exp(-perp * 14.0) * cap * 0.03 * (0.4 + 0.6 * seq);
    }
    v = min(v, 1.1);

    vec3 cold = vec3(0.55, 0.66, 0.85);              // cold white-blue light (linear)
    vec3 col = cold * (v + g);
    col += uFog * 0.04 * vec3(0.25, 0.32, 0.45);
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
