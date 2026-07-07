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
  id: 'snell',
  label: 'Skylight',
  techniqueFamily: 'snell window',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.25, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route gesture.touchX or a slow LFO here: where the sun hangs in the window
    { key: 'sun', kind: 'bipolar', min: -1, max: 1, default: 0.3, group: 'scene' },
    // route masterMeter.level or fft.high here: the glitter path answers the music
    { key: 'glimmer', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // which sea this is — wave phases and the set of the swell
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 13, group: 'scene' },
  ],
};

const vertexShader = glslVertex;

// Skylight — Snell's window: the whole sky compressed into one bright circle
// overhead, the way it truly looks from under water. Inside the cone the last
// of the world: a low sun, a graded evening sky, glitter where wave facets
// catch the sun's image. Outside the critical angle the surface turns to a
// dark mirror showing only the deep back to itself. Waves worry the window's
// rim and tear brief chromatic fringes (water disperses: each colour has its
// own critical angle). The arc is the sinking itself: the window dims, blues
// and blurs, the sun dissolves first, the glitter dies last — and what
// remains is a pale coin fading above you.
const fragmentShader = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark, uSun, uGlimmer, uSeed;
  varying vec2 vUv;

  const float IOR = 1.333;

  // the swell: three directional waves plus a breath of noise, returning the
  // surface slope where this ray meets it (analytic derivatives — no taps)
  vec2 waveSlope(vec2 p, float t){
    float a = 0.010 + uDepth * 0.022;               // chop
    vec2 s = vec2(0.0);
    s += a * 1.0 * vec2(cos(dot(p, vec2(2.1, 1.3)) + t * 1.10 + uSeed)) * vec2(2.1, 1.3);
    s += a * 0.6 * vec2(cos(dot(p, vec2(-3.7, 2.2)) + t * 1.45 - uSeed)) * vec2(-3.7, 2.2);
    s += a * 0.35 * vec2(cos(dot(p, vec2(1.4, -4.6)) + t * 1.9 + uSeed * 2.0)) * vec2(1.4, -4.6);
    s += (noise(p * 3.0 + t * 0.35 + uSeed) - 0.5) * a * 2.5;
    return s;
  }

  // the evening sky seen through the window, by air-angle from the zenith
  vec3 sky(float thetaA, vec2 azim, vec2 sunDir, float sink){
    float horizon = smoothstep(0.5, 1.5708, thetaA);       // near the rim = near the horizon
    vec3 zenith = vec3(0.085, 0.14, 0.21);
    vec3 low = vec3(0.48, 0.34, 0.17);                      // the dying amber, kin to the thermocline
    vec3 col = mix(zenith, low, pow(horizon, 1.6));
    // the sun: a low disc, its position squeezed toward the rim like everything else
    float sunAng = acos(clamp(dot(azim, sunDir), -1.0, 1.0));
    float sunTheta = 1.15;                                  // low sun, ~24 degrees up
    float d2 = (thetaA - sunTheta) * (thetaA - sunTheta) + sunAng * sunAng * 0.55;
    col += vec3(1.1, 0.88, 0.58) * exp(-d2 * 60.0) * (1.0 - sink);        // the disc
    col += vec3(0.55, 0.38, 0.18) * exp(-d2 * 6.0) * 0.5 * (1.0 - sink);  // its haze
    return col;
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * (0.4 + uFlow * 0.9);
    float sink = smoothstep(0.0, 1.0, uDark);               // how far gone the surface is

    // looking straight up: radius maps to water-angle from the vertical
    float r = length(pc);
    vec2 azim = r > 1e-4 ? pc / r : vec2(1.0, 0.0);
    // scale so the window's rim sits inside the SHORT axis with a margin of
    // dark mirror around it — the coin of sky must float in the frame
    float thetaW = r * (0.95 / (0.5 * min(aspect, 1.0)));

    // the swell bends the local vertical where the ray crosses the surface
    vec2 sp = pc * 3.4 + vec2(t * 0.12, -t * 0.09);
    vec2 slope = waveSlope(sp, t);
    float thetaWp = thetaW + dot(slope, azim) * 0.6;
    float phase = dot(slope, vec2(-azim.y, azim.x));        // sideways wobble for the glitter

    // water disperses — each channel has its own refractive index, so the
    // window's rim carries a real chromatic fringe
    vec3 ior = vec3(IOR - 0.004, IOR, IOR + 0.006);
    vec3 col = vec3(0.0);
    vec2 sunDir = normalize(vec2(cos(uSun * 1.8 + uSeed * 0.1), sin(uSun * 1.8 + uSeed * 0.1)));

    for (int c = 0; c < 3; c++) {
      float sa = ior[c] * sin(thetaWp);
      float v;
      if (sa < 1.0) {
        float thetaA = asin(clamp(sa, 0.0, 1.0));
        vec3 skyc = sky(thetaA, azim, sunDir, sink);
        // Fresnel-ish: transmission falls hard approaching the critical angle
        float trans = 1.0 - smoothstep(0.965, 1.0, sa);
        v = (c == 0 ? skyc.r : (c == 1 ? skyc.g : skyc.b)) * trans;
      } else {
        // total internal reflection: the surface mirrors the deep back down
        v = (c == 2 ? 0.012 : 0.008) + 0.006 * noise(pc * 6.0 - t * 0.1 + uSeed);
      }
      if (c == 0) col.r = v; else if (c == 1) col.g = v; else col.b = v;
    }

    // glitter: wave facets flashing the sun's image down the sun's azimuth
    float sunSide = max(0.0, dot(azim, sunDir));
    float facets = pow(0.5 + 0.5 * sin(phase * 44.0 + t * 3.0 + uSeed * 7.0), 8.0);
    float glitter = facets * pow(sunSide, 3.0) * smoothstep(0.65, 0.95, thetaWp / 0.85)
                  * (1.0 - smoothstep(1.0, 1.15, ior.g * sin(thetaWp)));
    col += vec3(1.0, 0.85, 0.6) * glitter * uGlimmer * 0.8 * (1.0 - sink * 0.85);

    // the water between: sinking blues everything, murk swallows the rim
    vec3 waterTint = mix(vec3(1.0), vec3(0.35, 0.55, 0.75), 0.35 + 0.5 * sink);
    col *= waterTint * (1.0 - 0.75 * sink);
    col += vec3(0.006, 0.012, 0.018) * (1.0 - 0.5 * sink);  // ambient scatter
    col = mix(col, vec3(0.035, 0.055, 0.075) * (1.0 - 0.6 * sink), uFog * 0.5 * smoothstep(0.4, 1.1, thetaW));

    // marine snow drifting across the whole view, lit only inside the window
    float motes = step(0.9985, hash(floor(pc * 110.0 + vec2(0.0, t * 2.0)) + uSeed));
    col += vec3(0.5, 0.6, 0.65) * motes * 0.25 * (1.0 - smoothstep(0.9, 1.05, ior.g * sin(thetaWp)));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSnell(): VisualLayer {
  const pass = new ShaderPass({
    name: 'snell',
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

export const snellModule: VisualModule = {
  descriptor,
  create: createSnell,
};
