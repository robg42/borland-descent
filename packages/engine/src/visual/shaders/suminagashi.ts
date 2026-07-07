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
  id: 'suminagashi',
  label: 'Marbling',
  techniqueFamily: 'ink marbling',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route a slow LFO here: the stylus drawn through the bath combs the rings
    { key: 'comb', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // route audio.onset here: a fresh drop of ink lands and rings outward
    { key: 'drop', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // one ink at 0 — alternating indigo/sepia rings at 1 (two ink stones)
    { key: 'tone', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'scene' },
    // which bath this is — offsets warp and drop-points so no two patches match
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 23, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Marbling — the floating-ink bath (suminagashi lineage): rings of ink laid on
// still water, one inside another, then a stylus drawn through the bath drags
// the whole nested figure into veins. Two drop-points breathe against each
// other; comb is the hand, and the warp it works with never repeats. The ink
// itself misbehaves the way real ink does — lines pool thick and starve thin
// along their length, and with two ink stones (tone) the rings alternate
// indigo and sepia. A transient is a fresh drop, a ring that spreads and
// thins as the envelope dies. The arc is the ink sinking: lines swell, blur
// and let go of their figure until the bath is dark water again.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uComb, uDrop, uTone, uSeed;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * (0.03 + uFlow * 0.10) + uSeed * 3.7;

    vec2 p = pc * mix(1.2, 2.6, uDepth);

    // the stylus: an organic warp dragged through the bath — the marbling hand
    float combAmp = uComb * (0.55 + 0.25 * sin(uTime * 0.021 + uSeed));
    vec2 w = vec2(fbm3(p * 1.35 + vec2(t, -t * 0.6) + uSeed),
                  fbm3(p * 1.35 + vec2(7.7, 2.9) + vec2(-t * 0.8, t) - uSeed));
    vec2 q = p + combAmp * 1.5 * (w - 0.5) * 2.0;

    // two drop-points breathing against each other
    vec2 c0 = 0.34 * vec2(sin(uTime * 0.031 + uSeed), cos(uTime * 0.024 + uSeed * 0.7));
    vec2 c1 = -0.30 * vec2(cos(uTime * 0.019 - uSeed), sin(uTime * 0.027 + uSeed * 1.3));

    // nested rings: log-spaced like ink laid drop after drop from the centre
    float rings = mix(9.0, 16.0, uDepth) * (1.0 - 0.40 * uDark); // the figure lets go
    float f0 = log(length(q - c0) + 0.06) * rings;
    float f1 = log(length(q - c1) + 0.06) * rings + 2.3;

    // real ink pools and starves along the line — width breathes along the ring
    float pool0 = 0.65 + 0.7 * fbm3(q * 2.1 + vec2(uSeed, f0 * 0.35));
    float pool1 = 0.65 + 0.7 * fbm3(q * 2.1 + vec2(f1 * 0.35, -uSeed));

    // the ink sinking: lines swell and blur as the arc falls
    float soft = mix(0.050, 0.22, uDark);
    float ink0 = 1.0 - smoothstep(soft * pool0, soft * pool0 + 0.10, abs(fract(f0) - 0.5));
    float ink1 = 1.0 - smoothstep(soft * pool1, soft * pool1 + 0.10, abs(fract(f1) - 0.5));

    // two ink stones: rings alternate indigo and sepia by ring parity
    vec3 indigo = vec3(0.40, 0.43, 0.55);
    vec3 sepia = vec3(0.48, 0.42, 0.33);
    float par0 = step(0.5, fract(floor(f0 + 0.5) * 0.5));
    float par1 = step(0.5, fract(floor(f1 + 0.5) * 0.5));
    vec3 inkCol0 = mix(indigo, sepia, par0 * uTone);
    vec3 inkCol1 = mix(indigo, sepia, par1 * uTone);
    // nearer ink wins where the figures cross
    vec3 inkCol = ink0 >= ink1 * 0.75 ? inkCol0 : inkCol1;
    float ink = max(ink0, ink1 * 0.75);

    // a fresh drop rings outward and thins as the envelope dies
    vec2 cD = 0.22 * vec2(sin(uTime * 0.013 + 4.0 + uSeed), cos(uTime * 0.017 + 1.0 - uSeed));
    float rp = (1.0 - uDrop) * 1.1;
    float front = exp(-abs(length(q - cD) - rp) * 22.0) * uDrop * uDrop;

    // the bath: paper-fibre flecks under still water
    float fibre = noise(pc * vec2(190.0, 70.0) + uSeed) * noise(pc * 31.0 - uSeed);

    vec3 water = vec3(0.010, 0.011, 0.014) + fibre * 0.012;
    vec3 col = water
             + inkCol * ink * 0.55 * (1.0 - 0.72 * uDark)
             + vec3(0.50, 0.54, 0.62) * front;
    col += uFog * 0.030 * vec3(0.24, 0.26, 0.31);
    col *= 1.0 - 0.42 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSuminagashi(): VisualLayer {
  const pass = new ShaderPass({
    name: 'suminagashi',
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

export const suminagashiModule: VisualModule = {
  descriptor,
  create: createSuminagashi,
};
