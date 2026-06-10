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
  id: 'asendorf',
  label: 'Sort',
  techniqueFamily: 'pixel sort',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.05, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route bassMeter.level or audio.flux here: the low end drags more columns under
    { key: 'threshold', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'scene' },
    // route audio.onset here: each transient re-sorts — channels shear, tears flash
    { key: 'glitch', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Sort — pixel sorting as a conscious aesthetic (Kim Asendorf lineage): a
// synthetic colour field, posterised because it was never photography, with
// per-column intervals torn out and replaced by their own value falling
// bright-to-dark — the sorted curtain. Columns re-deal on their own clocks; the
// jump cut is the medium, so this one is ALLOWED to pop. Threshold drags more
// of the image under the sort; a transient shears the channels apart and
// flashes tear rows through. The arc is data death: the source dims to a noise
// floor while the sort takes everything, until only long dark falls remain.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uThreshold, uGlitch;
  varying vec2 vUv;

  // the picture that was never a photograph — a risograph ink set, not a rainbow:
  // the old cosine phase becomes a folded scalar walked through five banded inks
  vec3 img(vec2 p, float t){
    float n = 0.62 * noise(p * 1.6 + vec2(t * 0.05, -t * 0.03))
            + 0.38 * noise(p * 3.3 + vec2(9.1, 3.7) + t * 0.04);
    float m = noise(p * 3.1 - t * 0.04);
    // same animating term as before (n drifts, m shears), folded to a 0..1 triangle
    float s = 1.0 - abs(2.0 * fract(n * 0.8 + m * 0.35) - 1.0);
    vec3 charcoal = vec3(0.10, 0.10, 0.11);
    vec3 ochre    = vec3(0.50, 0.38, 0.14);
    vec3 moss     = vec3(0.22, 0.30, 0.16);
    vec3 slate    = vec3(0.20, 0.26, 0.34);
    vec3 bone     = vec3(0.62, 0.58, 0.50);
    vec3 c = mix(charcoal, ochre, smoothstep(0.05, 0.25, s));
    c = mix(c, moss,  smoothstep(0.30, 0.50, s));
    c = mix(c, slate, smoothstep(0.55, 0.75, s));
    c = mix(c, bone,  smoothstep(0.80, 0.95, s));
    return c;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime;

    float colsN = floor(mix(46.0, 120.0, uDepth) * max(aspect, 0.5) + 0.5);
    float ci = floor(vUv.x * colsN);
    float hcol = hash(vec2(ci, 7.7));

    // each column re-deals on its own clock — the jump cut is the medium
    float tick = floor(t * (0.5 + uFlow * 2.5) + hcol * 6.0);
    float h1 = hash(vec2(ci, tick));
    float h2 = hash(vec2(ci, tick + 91.0));

    // the sorted interval: from y0, falling
    float covers = clamp(uThreshold * (0.55 + 0.60 * h1) + uGlitch * 0.35 + uDark * 0.45, 0.0, 1.0);
    float len = covers * mix(0.25, 1.05, h2);
    float y0 = 1.0 - h1 * (1.0 - 0.2 * covers);
    float inSort = step(vUv.y, y0) * step(y0 - len, vUv.y);

    vec2 p = vec2(vUv.x * aspect, vUv.y);
    vec3 source = img(p, t);
    source = floor(source * 7.0) / 7.0;               // posterised — digital on purpose

    // inside the interval the column becomes its own value, sorted bright to dark
    vec3 seedC = img(vec2(vUv.x * aspect, y0), t);
    float fall = clamp((y0 - vUv.y) / max(len, 1e-3), 0.0, 1.0);
    vec3 sorted = seedC * mix(1.15, 0.10, fall);

    vec3 col = mix(source * (1.0 - 0.85 * uDark), sorted, inSort);

    // glitch: the channels rotate apart; tear rows flash through whole frames
    col = mix(col, col.gbr, uGlitch * 0.6 * inSort);
    float gtick = floor(t * (2.0 + uFlow * 4.0));
    float tear = step(0.9975 - uGlitch * 0.015, hash(vec2(floor(vUv.y * 220.0), gtick)));
    col += tear * uGlitch * vec3(0.32);

    col += uFog * 0.02 * vec3(0.30, 0.30, 0.33);
    col *= 1.0 - 0.50 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAsendorf(): VisualLayer {
  const pass = new ShaderPass({
    name: 'asendorf',
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

export const asendorfModule: VisualModule = {
  descriptor,
  create: createAsendorf,
};
