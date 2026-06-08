import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import type { VisualLayer } from './types';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The midnight zone (bathypelagic): no sunlight at all — a near-black column lit only
// by sparse bioluminescent points that drift and pulse. A point-glow domain over a
// nearly black field, sharing the fog/flow/depth ports.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.05 + uFlow * 0.15);

    // near-black deep water with the faintest cold drift
    float drift = fbm(vec2(uv.x * 2.0, uv.y * 2.0 - t * 0.2));
    vec3 col = vec3(0.005, 0.012, 0.025) + drift * 0.02 * vec3(0.1, 0.2, 0.35);

    // sparse bioluminescent points, drifting slowly and pulsing out of phase
    for (int i = 0; i < 7; i++){
      float fi = float(i);
      vec2 pos = vec2(hash(vec2(fi, 1.7)), hash(vec2(fi, 4.3)));
      pos += (0.04 + uDepth * 0.05) * vec2(sin(t * 0.4 + fi), cos(t * 0.33 + fi * 1.7));
      float pulse = pow(0.5 + 0.5 * sin(t * (0.6 + 0.18 * fi) + fi * 2.3), 3.0);
      float d = length((uv - pos) * vec2(aspect, 1.0));
      vec3 tint = mix(vec3(0.2, 0.9, 0.8), vec3(0.4, 0.6, 1.0), hash(vec2(fi, 9.1)));
      col += tint * pulse * (0.006 / (d * d + 0.0014)); // soft glowing cores, not floods
    }

    col += uFog * 0.06 * vec3(0.1, 0.25, 0.4) * (0.5 + 0.5 * drift);
    col *= mix(1.0, 0.4, uDark); // already dark; the arc deepens it further

    float vig = smoothstep(1.35, 0.1, length(uv - 0.5));
    col *= mix(0.5, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createMidnightZone(): VisualLayer {
  const pass = new ShaderPass({
    name: 'midnightZone',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.35 },
      uFlow: { value: 0.3 },
      uDepth: { value: 0.5 },
      uDark: { value: 0.65 },
    },
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  function bind(registry: SignalRegistry, nodeId: string, port: string, name: string, base: number): void {
    const u = uniform(name);
    u.value = base;
    registry.addInput(makePortRef(nodeId, port), {
      kind: 'unipolar',
      base,
      min: 0,
      max: 1,
      write: (v) => {
        u.value = clamp(v, 0, 1);
      },
    });
  }

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.35));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.3));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.5));
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

function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
