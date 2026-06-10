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
  id: 'lemercier',
  label: 'Fuji',
  techniqueFamily: 'projected landform',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route bassMeter.level here: the low end raises the massif
    { key: 'relief', kind: 'unipolar', min: 0, max: 1, default: 0.55, group: 'scene' },
    // route audio.onset here: lightning — every ridge answers at once
    { key: 'storm', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Fuji — the projected landform (Joanie Lemercier lineage): a mountain that is
// only light. Stacked ridge contours compress toward a high horizon; a slow
// projector beam sweeps the massif and the crests catch it; the camera pans and
// the far ridges barely move — the parallax is the mountain. Relief raises the
// terrain with the bass; a storm flashes every contour at once. The arc is
// nightfall in reverse order of distance: the far rows go out first, until one
// near ridgeline breathes alone.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uRelief, uStorm;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime;
    float x = (vUv.x - 0.5) * aspect;

    float H = 0.80;                                     // the horizon
    float pan = t * (0.012 + uFlow * 0.055);
    float sx = fract(t * (0.016 + uFlow * 0.036));
    float beam = exp(-pow((vUv.x - sx) * 5.0, 2.0));    // the projector sweep

    // the sky: night air, a breath of scattered projection at the horizon
    float skyM = step(H, vUv.y);
    vec3 col = skyM * (vec3(0.006, 0.008, 0.013)
             + vec3(0.020, 0.028, 0.042) * exp(-(vUv.y - H) * 9.0)) * (1.0 - 0.85 * uDark);

    // fourteen strata, far to near; each body occludes the lit lines behind it
    float ink = 0.0;
    for (int i = 0; i < 14; i++){
      float fi = float(i);
      float rowF = fi / 13.0;                           // 0 far .. 1 near
      float baseY = H - pow(rowF, 1.35) * (H + 0.04);
      // the camera pans; far ridges barely move — the parallax IS the mountain
      float fx = x * mix(3.2, 1.2, rowF) + pan * mix(0.12, 1.0, rowF) + fi * 19.7;
      float n = noise(vec2(fx * mix(1.6, 3.2, uDepth), fi * 7.31));
      float ridge = pow(1.0 - abs(2.0 * n - 1.0), 1.7);
      ridge += 0.25 * (noise(vec2(fx * 5.1, fi * 3.77)) - 0.5) * rowF; // near detail
      float amp = mix(0.20, 1.0, uRelief) * mix(0.045, 0.20, rowF);
      float lineY = baseY + ridge * amp;

      // the nearer stratum's dark body blocks the strata behind it
      float body = 1.0 - smoothstep(lineY - 0.002, lineY + 0.004, vUv.y);
      ink *= 1.0 - body * 0.93;

      float d = abs(vUv.y - lineY);
      float w = mix(0.0016, 0.0034, rowF);
      float line = 1.0 - smoothstep(w, w + 0.0035, d);
      // distance haze takes the far strata; the night takes them first too
      float hazeF = mix(1.0, mix(0.22, 1.0, rowF), clamp(uFog * 1.5, 0.0, 1.0));
      float vis = step((1.0 - rowF) * (0.62 + 0.20 * hash(vec2(fi, 1.0))), 1.0 - uDark * 0.95);
      float bright = 0.34 + 1.05 * beam + 0.25 * smoothstep(0.72, 1.0, ridge);
      ink += line * hazeF * vis * bright;
    }
    ink *= 1.0 + uStorm * 1.8;                          // lightning: every ridge at once

    vec3 beamCol = vec3(0.55, 0.66, 0.82);              // projection white-blue (linear)
    col += beamCol * ink;
    col += vec3(0.50, 0.55, 0.65) * uStorm * 0.05;      // the flash reaches the sky
    col *= 1.0 - 0.50 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createLemercier(): VisualLayer {
  const pass = new ShaderPass({
    name: 'lemercier',
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

export const lemercierModule: VisualModule = {
  descriptor,
  create: createLemercier,
};
