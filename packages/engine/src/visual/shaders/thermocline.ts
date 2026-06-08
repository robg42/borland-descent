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

// The thermocline: a wavering horizontal boundary where warm sunlit water meets the
// cold dark below, with fine stratification bands and a refractive shimmer at the
// interface. A layered/stratified domain (not warp or spiral), sharing fog/flow/depth.
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
    float t = uTime * (0.04 + uFlow * 0.16);
    float depthY = 1.0 - uv.y; // 0 at top, 1 at the bottom

    // the thermocline boundary — wavering across the frame, drifting with depth control
    float boundary = 0.46 + uDepth * 0.12
      + 0.05 * sin(uv.x * 6.2831 + t)
      + (fbm(vec2(uv.x * 2.0, t * 0.2)) - 0.5) * 0.14;
    float below = smoothstep(boundary - 0.03, boundary + 0.08, depthY);

    // fine horizontal stratification
    float bands = 0.5 + 0.5 * sin(depthY * 46.0 + fbm(p) * 4.0 - t * 1.3);
    float strat = mix(1.0, bands, 0.35);

    vec3 warm = mix(vec3(0.06, 0.34, 0.36), vec3(0.30, 0.42, 0.30), uHue); // sunlit above
    vec3 cold = vec3(0.02, 0.05, 0.14);                                    // indigo below
    vec3 col = mix(warm, cold, below) * strat;

    // refractive shimmer right at the boundary seam ('interface' is a reserved word)
    float seam = exp(-pow((depthY - boundary) * 14.0, 2.0));
    col += seam * (0.18 + 0.2 * fbm(p * 3.0 + t)) * vec3(0.5, 0.8, 0.85);

    col += uFog * 0.12 * vec3(0.3, 0.45, 0.5) * (0.5 + 0.5 * bands);
    col *= mix(1.0, 0.30, uDark);

    float vig = smoothstep(1.3, 0.2, length(uv - 0.5));
    col *= mix(0.7, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createThermocline(): VisualLayer {
  const pass = new ShaderPass({
    name: 'thermocline',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.4 },
      uHue: { value: 0.4 },
      uFlow: { value: 0.35 },
      uDepth: { value: 0.3 },
      uDark: { value: 0.3 },
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
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.4));
      bind(registry, nodeId, 'hue', 'uHue', num(params.hue, 0.4));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.35));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.3));
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
