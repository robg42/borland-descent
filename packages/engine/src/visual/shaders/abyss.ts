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

// The dark centre: a turbulent ember vortex spiralling inward. Structurally a
// different world from oceanicField (polar/log-spiral domain, deep red-black
// palette, tunnel vignette). Shares the fog/flow/depth port vocabulary so the
// global matrix routes still apply.
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
    for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    float r = length(p) + 1e-4;
    float ang = atan(p.y, p.x);
    float t = uTime * (0.05 + uFlow * 0.22);

    // log-polar spiral pulled toward the centre
    vec2 q = vec2(ang / 6.28318 + t * 0.12, log(r) * (1.1 + uDepth) - t * 0.6);
    float n = fbm(q * 3.0 + fbm(q * 1.5));

    float core = smoothstep(0.85, 0.0, r);
    vec3 deep = vec3(0.04, 0.012, 0.02);
    vec3 ember = mix(vec3(0.34, 0.06, 0.05), vec3(0.52, 0.2, 0.08), n);
    vec3 col = mix(deep, ember, clamp(n * core, 0.0, 1.0));

    col += uFog * 0.1 * vec3(0.4, 0.12, 0.09) * (0.5 + 0.5 * n);
    col *= mix(0.85, 0.25, uDark); // deeper in the arc = more swallowed
    col *= smoothstep(1.15, 0.08, r); // tunnel vignette

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAbyss(): VisualLayer {
  const pass = new ShaderPass({
    name: 'abyss',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.35 },
      uFlow: { value: 0.4 },
      uDepth: { value: 0.5 },
      uDark: { value: 0.6 },
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
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.4));
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
