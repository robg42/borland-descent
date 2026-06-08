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

// The abyssal plain: a vast, near-still dark expanse over a sediment floor, with slow
// pressure undulations in the water column and a faint cold glow along a low horizon.
// A horizon/floor domain (not column-only), sharing the fog/flow/depth ports.
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
    vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
    float t = uTime * (0.03 + uFlow * 0.1);

    // a low horizon over the abyssal plain (raised slightly by depth control)
    float horizon = 0.30 + uDepth * 0.06 + 0.025 * fbm(vec2(uv.x * 1.6 + 4.0, t * 0.1));
    float above = step(horizon, uv.y);

    // slow pressure undulation in the water column above the floor
    float press = fbm(vec2(uv.x * 2.2, uv.y * 1.2 - t * 0.5));
    // a faint, cold distant glow just above the horizon
    float glow = smoothstep(0.0, 0.32, uv.y - horizon) * smoothstep(0.78, horizon, uv.y);

    vec3 water = vec3(0.01, 0.03, 0.06) + press * 0.05 * vec3(0.08, 0.16, 0.26);
    water += glow * vec3(0.10, 0.22, 0.34);

    // the sediment floor below the horizon — grainy ripples, slightly warmer
    float grain = noise(vec2(uv.x * aspect, uv.y) * 220.0 + t);
    float ripple = 0.5 + 0.5 * sin(uv.x * 40.0 + fbm(p) * 5.0);
    vec3 floorCol = vec3(0.05, 0.045, 0.05) * (0.5 + 0.7 * ripple) + grain * 0.03;

    vec3 col = mix(floorCol, water, above);

    col += uFog * 0.10 * vec3(0.12, 0.2, 0.3) * (0.5 + 0.5 * press);
    col *= mix(1.0, 0.35, uDark);

    float vig = smoothstep(1.4, 0.1, length(uv - 0.5));
    col *= mix(0.55, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAbyssalPlain(): VisualLayer {
  const pass = new ShaderPass({
    name: 'abyssalPlain',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.3 },
      uFlow: { value: 0.25 },
      uDepth: { value: 0.6 },
      uDark: { value: 0.8 },
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
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.3));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.25));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.6));
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
