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

// The twilight zone (mesopelagic): the last blue light dying out, with marine snow
// drifting endlessly down through three parallax layers. A particulate domain (point
// fields, not fbm warp), sharing the fog/flow/depth ports.
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

  // one parallax layer of falling marine snow
  float snow(vec2 uv, float aspect, float t, float scale, float speed, float seed){
    vec2 g = vec2(uv.x * aspect, uv.y) * scale;
    g.y += t * speed;                 // particles fall
    g.x += sin(t * 0.3 + seed) * 0.3; // gentle sway
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash(id + seed);
    if (h < 0.55) return 0.0;         // sparse — most cells are empty
    vec2 center = vec2(0.25 + 0.5 * hash(id + seed + 3.1), 0.25 + 0.5 * h);
    float d = length(f - center);
    float r = 0.04 + 0.06 * h;
    return smoothstep(r, 0.0, d) * (0.3 + 0.7 * h);
  }

  void main(){
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.06 + uFlow * 0.18);
    float depthY = 1.0 - uv.y;

    // dim blue-grey, light dying with depth
    vec3 top = vec3(0.04, 0.10, 0.16);
    vec3 bot = vec3(0.01, 0.02, 0.05);
    float murk = fbm(vec2(uv.x * 2.0, uv.y * 2.0 - t * 0.4));
    vec3 col = mix(top, bot, smoothstep(0.0, 1.0, depthY + uDepth * 0.2));
    col *= 0.7 + 0.5 * murk;

    // marine snow — three parallax layers, faster/smaller in front
    float s = snow(uv, aspect, t, 18.0, 0.5, 1.0)
            + snow(uv, aspect, t, 30.0, 0.8, 13.0) * 0.7
            + snow(uv, aspect, t, 46.0, 1.2, 27.0) * 0.5;
    col += s * vec3(0.55, 0.65, 0.7);

    col += uFog * 0.14 * vec3(0.25, 0.35, 0.45) * (0.5 + 0.5 * murk);
    col *= mix(1.0, 0.28, uDark);

    float vig = smoothstep(1.3, 0.2, length(uv - 0.5));
    col *= mix(0.65, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createTwilightZone(): VisualLayer {
  const pass = new ShaderPass({
    name: 'twilightZone',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.4 },
      uFlow: { value: 0.35 },
      uDepth: { value: 0.4 },
      uDark: { value: 0.5 },
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
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.35));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.4));
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
