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
  id: 'crespo',
  label: 'Neural Zoo',
  techniqueFamily: 'neural organism',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.3, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route fft.high here: the brilliance plays on the membrane
    { key: 'sheen', kind: 'unipolar', min: 0, max: 1, default: 0.55, group: 'scene' },
    // route audio.onset here: the creature answers each transient with light
    { key: 'lumen', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Neural Zoo — the imagined organism (Sofia Crespo lineage): one specimen that
// has never existed, grown bilaterally symmetric from a ribbed bell and a noisy
// genome the network never quite resolved. The machine insists on hyper-detail:
// filigree and veining live only where there is flesh; the membrane carries an
// abalone shimmer read straight out of the latent space. It breathes,
// drifts, and answers transients with bioluminescent light at the rim. The arc
// dissolves the flesh and leaves the outline — a creature reduced to its own
// drawing in the dark, motes sinking past it.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uSheen, uLumen;
  varying vec2 vUv;

  // weighted fbm variant tuned for this module (glslCommon supplies hash/noise)
  float fbmW(vec2 p){ return 0.55 * noise(p) + 0.30 * noise(p * 2.04 + 11.3) + 0.15 * noise(p * 4.13 + 29.7); }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 P = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * (0.25 + uFlow * 0.75);

    // the specimen drifts a little in its dark water
    vec2 c = 0.06 * vec2(sin(t * 0.31), cos(t * 0.23));
    vec2 Q = P - c;
    Q.x = abs(Q.x);                                  // bilateral symmetry — grown, not drawn
    float rr = length(Q * vec2(1.0, 0.82));
    float an = atan(Q.y, Q.x);

    // morphology: a ribbed bell over a genome the GAN never resolved
    float segs = floor(mix(5.0, 11.0, uDepth) + 0.5);
    float breath = 1.0 + 0.05 * sin(t * 0.9);
    float R = 0.30 * breath
            + 0.045 * sin(an * segs + t * 0.4)
            + 0.11 * (fbmW(vec2(an * 1.4, rr * 2.6) + t * 0.10) - 0.5);
    float dBell = rr - R;
    float body = 1.0 - smoothstep(-0.16, 0.015, dBell);
    float rim = exp(-abs(dBell) * 26.0);

    // hyper-detail the machine insists on: filigree only where there is flesh
    float fil = fbmW(Q * mix(7.0, 15.0, uDepth) + vec2(0.0, -t * 0.18));
    float veins = pow(0.5 + 0.5 * sin(an * segs * 2.0 + rr * 24.0 - t * 0.7 + fil * 5.0), 6.0);

    // abalone shimmer read out of the latent space: one animated scalar sweeps
    // the membrane between kelp green and dusty rose over the pearl base —
    // mother-of-pearl, not petrol slick
    float shimmer = 0.5 + 0.5 * cos(6.2831 * (fil * 0.7 + rr * 1.6 - an * 0.16));
    vec3 kelp = vec3(0.28, 0.40, 0.34);
    vec3 rose = vec3(0.46, 0.34, 0.38);
    vec3 irid = mix(kelp, rose, shimmer);
    vec3 pearl = vec3(0.36, 0.46, 0.52);
    vec3 flesh = mix(pearl, irid, clamp(uSheen, 0.0, 1.0));

    float interior = body * (0.30 + 0.45 * fil + 0.55 * veins) * (1.0 - 0.80 * uDark);
    float edge = rim * (0.5 + 0.5 * veins) * (1.0 + uLumen * 2.6) * (1.0 - 0.35 * uDark);

    // the water: motes sinking slowly past the creature
    float motes = step(0.998, hash(floor((P + vec2(0.0, t * 0.05)) * 90.0)))
                * (0.3 + 0.4 * sin(t + P.x * 30.0));
    motes *= 1.0 - 0.5 * uDark;

    vec3 water = vec3(0.008, 0.014, 0.020);
    vec3 col = water
             + flesh * interior
             + vec3(0.22, 0.46, 0.42) * edge * 0.9      // bioluminescent rim, deep-sea moss-teal
             + vec3(0.46, 0.55, 0.59) * motes * 0.5;
    col += uFog * 0.05 * vec3(0.10, 0.16, 0.20) * (1.0 - rr); // murk pools at the centre
    col *= 1.0 - 0.45 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createCrespo(): VisualLayer {
  const pass = new ShaderPass({
    name: 'crespo',
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

export const crespoModule: VisualModule = {
  descriptor,
  create: createCrespo,
};
