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
  id: 'hobbs',
  label: 'Fidenza',
  techniqueFamily: 'flow field',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route bassMeter.level here: the low end turns the field turbulent
    { key: 'turbulence', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'scene' },
    // route audio.onset here: each transient runs a light along the strokes
    { key: 'ripple', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fidenza — the flow field (Tyler Hobbs lineage): inked strokes of irregular
// length riding one master heading, the whole canvas bent by a slow vector
// field. Turbulence is the collector's dial made a uniform — laminar parallels
// at zero, storm at one. Strokes migrate almost imperceptibly along their own
// length; the palette is Fidenza's, darkened for the descent. Transients run a
// light along the strokes. The arc unpaints it: colour to ash, strokes thinning
// away until the ground shows through.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uTurbulence, uRipple;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){ return 0.6 * noise(p) + 0.4 * noise(p * 2.13 + 7.7); }

  // the Fidenza inks, darkened for the descent (linear)
  vec3 palette(float h){
    vec3 c = vec3(0.70, 0.63, 0.48);                    // bone
    c = mix(c, vec3(0.52, 0.16, 0.06), step(0.18, h));  // rust
    c = mix(c, vec3(0.06, 0.26, 0.30), step(0.38, h));  // deep teal
    c = mix(c, vec3(0.62, 0.38, 0.08), step(0.56, h));  // amber
    c = mix(c, vec3(0.10, 0.11, 0.13), step(0.72, h));  // charcoal
    c = mix(c, vec3(0.24, 0.33, 0.55), step(0.88, h));  // dusk blue
    return c;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime;

    // the field: a slow vector field bends the canvas; turbulence is the dial
    float drift = t * (0.010 + uFlow * 0.040);
    vec2 W = vec2(
      fbm(P * 1.5 + vec2(drift, -drift * 0.6)),
      fbm(P * 1.5 + vec2(4.7, 9.3) + vec2(-drift * 0.8, drift))
    ) - 0.5;
    vec2 Q = P + W * mix(0.08, 0.85, uTurbulence);

    // strokes run along one master heading, as Fidenza's bands do
    vec2 dir = normalize(vec2(0.94, 0.34));
    float s = dot(Q, vec2(-dir.y, dir.x));                  // across the strokes
    float u = dot(Q, dir) + t * (0.006 + uFlow * 0.020);    // along them — slow migration

    float bands = mix(7.0, 16.0, uDepth);
    float bid = floor(s * bands);
    float fs = fract(s * bands) - 0.5;

    // each band breaks into strokes of irregular length; some were never inked
    float segs = mix(2.2, 4.5, uDepth);
    float su = u * segs + hash(vec2(bid, 11.1)) * 9.0;
    float sid = floor(su);
    float fu = fract(su) - 0.5;
    vec2 cell = vec2(bid, sid);

    // the arc raises the bar for a stroke to exist at all
    float present = step(mix(0.30, 0.18, uTurbulence) + uDark * 0.30, hash(cell + 3.3));
    float halfW = 0.5 * mix(0.30, 0.46, hash(cell + 5.5));
    float endCap = mix(0.34, 0.46, hash(cell + 9.2));
    float body = (1.0 - smoothstep(halfW - 0.045, halfW + 0.025, abs(fs)))
               * (1.0 - smoothstep(endCap - 0.10, endCap + 0.03, abs(fu)));
    float ink = present * body;

    vec3 col = palette(hash(cell + 1.7));
    // hand pressure: tone varies a little along each stroke
    col *= 0.82 + 0.30 * hash(cell + 13.0) + 0.10 * sin(u * 20.0 + hash(cell) * 6.2831);
    // the transient light travelling the strokes
    col *= 1.0 + uRipple * 0.9 * (0.5 + 0.5 * sin(u * 5.0 - t * 3.0));

    vec3 ground = vec3(0.016, 0.015, 0.018);
    col = mix(ground, col, ink);

    // the descent unpaints it: colour to ash, then the lights go down
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(luma) * 0.55, uDark * 0.85);
    col += uFog * 0.03 * vec3(0.35, 0.34, 0.36);
    col *= 1.0 - 0.40 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createHobbs(): VisualLayer {
  const pass = new ShaderPass({
    name: 'hobbs',
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

export const hobbsModule: VisualModule = {
  descriptor,
  create: createHobbs,
};
