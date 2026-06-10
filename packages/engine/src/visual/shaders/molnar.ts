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
import { glslCommon, glslVertex } from './glsl/common';

export const descriptor: VisualModuleDescriptor = {
  id: 'molnar',
  label: 'Ordres',
  techniqueFamily: 'plotter grid',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.1, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route bassMeter.level here: the low end unsettles the survey
    { key: 'disorder', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'scene' },
    // route audio.onset here: each transient shakes the sheet for its envelope
    { key: 'shake', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Ordres — the plotter grid (Vera Molnár lineage, with a nod to Nees's Schotter):
// a survey of nested square outlines, one per cell, drawn in a single pen weight.
// Disorder is the instrument: each ring strays from its post by a controlled
// offset and rotation, the outer rings further than the inner — order and its
// undoing held in one frame. Every square wanders continuously on its own clock
// (no reseeding, no popping); a transient shakes the whole sheet for its
// envelope. The arc switches cells off in a fixed random order and feeds the
// survivors' disorder — the grid forgets itself on the way down.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uDisorder, uShake;
  varying vec2 vUv;

  vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime;

    // square cells sized off the frame height — a portrait sheet simply carries
    // fewer columns; the plot crops, it never squashes
    float n = mix(6.0, 11.0, uDepth);
    vec2 g = P * n;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;

    // disorder rises with the descent — but only past the shallows, so the
    // surface keeps the full survey. A transient shakes the whole sheet.
    // Offsets and rotations are budgeted so squares stay inside their cells.
    float fade = clamp((uDark - 0.22) / 0.78, 0.0, 1.0);
    float dis = clamp(uDisorder + uShake * 0.9 + fade * 0.5, 0.0, 1.4);
    float drift = 0.04 + uFlow * 0.35; // how fast each square strays about its post

    float ringCount = mix(3.0, 5.0, uDepth);
    float ink = 0.0;
    for (int k = 0; k < 5; k++){
      float fk = float(k);
      float on = step(fk + 0.5, ringCount + 0.5);
      // the outer rings stray further — the inner ones keep the memory of the grid
      float reach = pow((fk + 1.0) / 5.0, 1.5);
      vec2 h = hash2(id + fk * 17.3);
      float wob = t * drift * (0.3 + 0.7 * h.x) + h.y * 6.2831;
      vec2 off = (h - 0.5) * 0.10 * dis * reach
               + 0.02 * dis * reach * vec2(cos(wob), sin(wob * 0.83));
      float ang = (hash(id + fk * 31.7) - 0.5) * 0.55 * dis * reach
                + 0.12 * dis * reach * sin(t * drift * 0.7 + h.x * 6.2831);
      vec2 q = abs(rot(f - off, ang));
      float r = 0.30 * (fk + 1.0) / 5.0;
      float d = abs(max(q.x, q.y) - r);
      float line = 1.0 - smoothstep(0.012, 0.022, d);
      ink = max(ink, on * line * (0.55 + 0.45 * hash(id + fk * 7.7))); // pen pressure
    }

    // the arc retires cells in a fixed random order; survivors stay exact
    float alive = step(fade * 0.9, hash(id + 0.5));
    ink *= alive;

    vec3 paper = vec3(0.012, 0.013, 0.016);
    vec3 pen = vec3(0.58, 0.57, 0.52);             // warm plotter ink (linear)
    vec3 col = paper + pen * ink;
    col += uFog * 0.025 * vec3(0.40, 0.40, 0.42);  // the faintest sheet tone
    col *= 1.0 - 0.5 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createMolnar(): VisualLayer {
  const pass = new ShaderPass({
    name: 'molnar',
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

export const molnarModule: VisualModule = {
  descriptor,
  create: createMolnar,
};
