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

// A slow oceanic field: domain-warped fbm, a surface→depth vertical gradient, a
// teal palette that shifts with hue, fog that lifts the blacks, and an arc-driven
// darkening. Surface is wide and luminous; the centre is darker and closer.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uHue, uFlow, uDepth, uDark;
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
    vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
    float t = uTime * (0.04 + uFlow * 0.14);

    vec2 q = vec2(fbm(p + t), fbm(p - t + 5.2));
    float n = fbm(p + q * 1.5 + vec2(0.0, -t * 0.6));

    float depthGrad = mix(1.0, 0.14, smoothstep(0.0, 1.0, (1.0 - uv.y) + uDepth * 0.3));

    vec3 deep = vec3(0.02, 0.07, 0.09);
    vec3 mid = mix(vec3(0.05, 0.34, 0.38), vec3(0.42, 0.28, 0.5), uHue);
    vec3 col = mix(deep, mid, clamp(n * depthGrad, 0.0, 1.0));

    col += uFog * 0.14 * vec3(0.3, 0.5, 0.55) * (0.5 + 0.5 * n);
    col *= mix(1.0, 0.32, uDark);

    float vig = smoothstep(1.25, 0.2, length(uv - 0.5));
    col *= mix(0.65, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createOceanicField(): VisualLayer {
  const pass = new ShaderPass({
    name: 'oceanicField',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.4 },
      uHue: { value: 0.55 },
      uFlow: { value: 0.3 },
      uDepth: { value: 0.2 },
      uDark: { value: 0.2 },
    },
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  function bind(
    registry: SignalRegistry,
    nodeId: string,
    port: string,
    name: string,
    base: number,
  ): void {
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
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.4));
      bind(registry, nodeId, 'hue', 'uHue', num(params.hue, 0.55));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.3));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.2));
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
