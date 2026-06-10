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
  id: 'swarm',
  label: 'Murmuration',
  techniqueFamily: 'particle swarm',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    // route bassMeter.level here: the low end gathers the flock
    { key: 'cohesion', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // route audio.flux or fft.high here: movement makes the swarm glitter
    { key: 'shimmer', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Murmuration — a mass-particle flock (Zhestkov / Universal Everything lineage):
// three parallax layers of champagne points carried on one domain-warped flow,
// visible only where a drifting flock-mask gathers them, so the cloud clumps,
// stretches and re-forms like starlings. Cohesion tightens the mask (the bass
// gathers the flock); shimmer makes individuals glitter on movement. The arc
// thins the flock and lets it sink — by the deep end only stragglers remain.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uCohesion, uShimmer;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  vec2 hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // one parallax layer of flow-carried points
  float layer(vec2 P, float scale, float t, float seed, float cull){
    // the whole lattice rides the flow — coherent travel, no cell popping
    vec2 drift = vec2(t * 0.16, t * 0.05 - 0.12 * sin(t * 0.21 + seed));
    vec2 warp = 0.55 * vec2(noise(P * 0.7 + t * 0.06 + seed), noise(P * 0.7 - t * 0.05 + seed + 4.2));
    vec2 q = (P + warp) * scale + drift * scale * 0.35 + seed * 7.0;
    vec2 id = floor(q), f = fract(q);
    vec2 h = hash2(id);
    if (h.x < cull) return 0.0;                       // arc-thinned stragglers
    vec2 pt = 0.25 + 0.5 * h + 0.16 * sin(t * (0.5 + h.x) + 6.2831 * h.y); // local orbit
    float d = length(f - pt);
    return smoothstep(0.10 + 0.08 * h.y, 0.0, d) * (0.35 + 0.65 * h.y);
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = vec2(vUv.x * aspect, vUv.y + uDark * 0.25); // the flock sinks with the arc
    float t = uTime * (0.3 + uFlow * 1.1);

    // the flock-mask: where the murmuration currently IS. A portrait frame is
    // barely half a unit wide, so the mask needs real frequency to clump.
    float m = noise(P * 3.2 + vec2(t * 0.11, -t * 0.05))
            + 0.4 * noise(P * 6.1 - vec2(t * 0.07, t * 0.04) + 11.0);
    m /= 1.4;
    float lo = mix(0.30, 0.46, uCohesion);
    float hi = mix(0.72, 0.58, uCohesion);
    float mask = smoothstep(lo, hi, m);

    float cull = 0.12 + uDark * 0.55;
    float pts = layer(P, mix(7.0, 12.0, uDepth), t, 1.0, cull)
              + layer(P, mix(11.0, 18.0, uDepth), t * 1.18, 13.0, cull) * 0.7
              + layer(P, mix(17.0, 26.0, uDepth), t * 1.4, 27.0, cull) * 0.45;
    pts *= mask;

    // shimmer: individuals glint when the music moves
    pts *= 1.0 + uShimmer * (0.6 + 0.4 * sin(uTime * 9.0 + m * 12.0));

    vec3 champagne = vec3(0.62, 0.50, 0.33);          // warm pale points (linear)
    vec3 floorCol = vec3(0.008, 0.010, 0.013);        // deep neutral ground
    vec3 col = floorCol + champagne * pts;
    col += uFog * 0.04 * vec3(0.3, 0.3, 0.32) * mask; // haze gathers where the flock is
    col *= 1.0 - 0.45 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSwarm(): VisualLayer {
  const pass = new ShaderPass({
    name: 'swarm',
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

export const swarmModule: VisualModule = {
  descriptor,
  create: createSwarm,
};
