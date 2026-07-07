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
  id: 'sonar',
  label: 'Soundings',
  techniqueFamily: 'echolocation sweep',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.25, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route audio.onset here: the array fires and a wavefront rolls outward
    { key: 'ping', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // route bassMeter.level or fft.low here: receiver gain — how much the dark answers
    { key: 'gain', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // seafloor returns: a ragged bathymetry ring the beam lights as it passes
    { key: 'terrain', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'scene' },
    // which waters these are — re-lays the contacts and the floor
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 41, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Soundings — the echolocation sweep (naval phosphor lineage): a hydrophone
// display turning in the dark, the beam dragging a green afterglow, and
// whatever is out there answering as blips that fade until the beam comes
// round again. Some of those returns are real: they hold their station
// revolution after revolution, drifting slowly, while the rest is sea noise
// that never repeats. Terrain raises the floor itself — a ragged bathymetry
// ring the beam lights as it passes. A transient fires the array: a wavefront
// rolls outward and everything it crosses flares. Gain is how hard you
// listen. The arc is the set losing power: the returns die first, then the
// rings, and last a ghost of the beam turning in a dead display.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uPing, uGain, uTerrain, uSeed;
  varying vec2 vUv;

  const float TAU = 6.2831853;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float r = length(pc);
    float a = atan(pc.y, pc.x);

    // the beam turns; losing power it turns slower
    float rot = (0.30 + uFlow * 0.85) * (1.0 - 0.45 * uDark);
    float sw = uTime * rot;
    float lag = fract((sw - a) / TAU);          // 0 = just swept

    // phosphor afterglow behind the beam; fog holds the glow longer
    float trail = exp(-lag * mix(9.0, 4.0, uFog));
    float beam = exp(-lag * 70.0);

    // the returns: polar cells; TRUE contacts (seed-hashed, station-keeping,
    // drifting slowly) against sea noise re-rolled every revolution
    float Na = 48.0;
    float Nr = mix(5.0, 9.0, uDepth);
    float cellA = floor((a / TAU + 0.5) * Na);
    float cellR = floor(r * Nr);
    float aC = ((cellA + 0.5) / Na - 0.5) * TAU;
    float rev = floor((sw - aC) / TAU);
    float lagC = fract((sw - aC) / TAU);

    vec2 cell = vec2(cellA * 1.7 + 13.1, cellR * 3.1);
    vec2 real2 = hash2(cell + uSeed);
    vec2 noise2 = hash2(cell + rev * 17.3 + uSeed);
    // a real contact exists rarely and persists; sea noise flickers per rev
    float isReal = step(1.0 - 0.022 * (0.3 + uGain), real2.x);
    float isNoise = step(1.0 - 0.030 * (0.2 + uGain), noise2.x) * (1.0 - isReal);
    float lives = (isReal + isNoise) * step(0.06, r) * step(r, 1.05);

    // real contacts drift on station; noise sits wherever it flashed
    float drift = isReal * 0.25 * sin(uTime * 0.05 + real2.y * TAU);
    float rBlip = (cellR + 0.2 + 0.6 * mix(noise2.y, real2.y, isReal)) / Nr;
    vec2 blipPos = vec2(cos(aC + drift / max(rBlip, 0.1) * 0.1), sin(aC + drift / max(rBlip, 0.1) * 0.1)) * rBlip;
    float dB = length(pc - blipPos);
    float blip = lives * exp(-dB * dB * 2600.0) * exp(-lagC * mix(3.2, 1.8, isReal));

    // a fired array: the wavefront rolls outward and flares what it crosses
    float rp = (1.0 - uPing) * 1.25;
    float front = exp(-abs(r - rp) * 26.0) * uPing * uPing;
    blip *= 1.0 + 4.0 * exp(-abs(dB) * 3.0) * front;

    // the floor answering: a ragged bathymetry ring lit by the passing beam
    float floorR = 0.62 + 0.22 * (fbm3(vec2(a * 1.7 + uSeed, uSeed * 0.9)) - 0.5) * 2.0;
    float bathy = exp(-abs(r - floorR) * mix(60.0, 26.0, uFog))
                * (trail * 0.85 + front * 1.5) * uTerrain;

    // range rings and bearing ticks — the instrument itself
    float ring = 1.0 - smoothstep(0.0, 0.015, abs(fract(r * Nr) - 0.5) / Nr);
    float ticks = exp(-abs(fract(a / TAU * 12.0) - 0.5) * 60.0)
                * smoothstep(0.90, 0.95, r) * (1.0 - smoothstep(1.0, 1.05, r));

    // the noise floor breathes with gain
    float speckle = step(0.9975 - uGain * 0.0018, hash(floor(pc * 130.0) + floor(uTime * 3.0) + uSeed))
                  * trail * 0.5;

    // the set loses power outward-in: returns, then rings, then the beam
    float fadeBlip = 1.0 - smoothstep(0.10, 0.55, uDark);
    float fadeRing = 1.0 - smoothstep(0.40, 0.85, uDark);
    float fadeBeam = 1.0 - smoothstep(0.60, 0.98, uDark);

    vec3 phosphor = vec3(0.14, 0.40, 0.28);
    vec3 hot = vec3(0.34, 0.62, 0.42);
    float vig = smoothstep(1.35, 0.45, r);
    vec3 col = vec3(0.006, 0.010, 0.009)
             + phosphor * (trail * 0.16 + speckle) * vig * fadeBeam
             + hot * beam * 0.35 * vig * fadeBeam
             + hot * blip * 1.4 * fadeBlip
             + mix(phosphor, hot, 0.4) * bathy * vig * fadeBlip
             + phosphor * front * 0.8 * fadeBlip
             + phosphor * (ring * 0.10 + ticks * 0.18) * vig * fadeRing;
    col += uFog * 0.020 * vec3(0.10, 0.18, 0.15);
    col *= 1.0 - 0.35 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSonar(): VisualLayer {
  const pass = new ShaderPass({
    name: 'sonar',
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

export const sonarModule: VisualModule = {
  descriptor,
  create: createSonar,
};
