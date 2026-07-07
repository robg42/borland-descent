import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp } from '../../core/curves';
import {
  bindDescriptorPorts,
  type VisualModule,
  type VisualModuleDescriptor,
} from '../moduleDescriptor';
import type { VisualLayer } from './types';
import { glslCommon, glslVertex } from './glsl/common';

export const descriptor: VisualModuleDescriptor = {
  id: 'gyre',
  label: 'Gyre',
  techniqueFamily: 'advected dye',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route bassMeter.level here: the hidden stirrers put their backs into it
    { key: 'stir', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // route audio.onset here: a burst of fresh dye enters the water
    { key: 'plume', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // which water this is; CHANGING it clears the bath and the record restarts
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 37, group: 'scene' },
  ],
  capabilities: {
    feedback: true, // the dye field is the state — advection ping-pong
  },
};

// Gyre — advected dye: two inks fed continuously into a slow rotating sea and
// STIRRED, frame over frame, for ever. This is not a texture that looks like
// fluid; it is fluid memory — every curl of the field stretches the inks into
// finer and finer filaments until teal and bone lie in sheets a pixel apart,
// the way cream folds into coffee. The velocity is divergence-free by
// construction (a curl field), so the inks never pile up or vanish — they can
// only fold. Stir drives the two hidden vortices; a transient releases a
// plume of fresh dye; the arc starves the sources and thins the water until
// the last filaments dissolve.

const SIM_RES = 384;

const advectFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform sampler2D uDye;
  uniform float uTime, uFlow, uDepth, uDark, uStir, uPlume, uSeed, uSeedTick;
  varying vec2 vUv;

  // streamfunction: slow layered noise — its curl is the sea's own motion
  float psi(vec2 p, float t){
    return fbm3(p * mix(1.6, 4.0, uDepth) + vec2(t * 0.04, -t * 0.03) + uSeed);
  }

  vec2 velocity(vec2 p, float t){
    float e = 0.01;
    // curl of the streamfunction: rotational, divergence-free
    float dpy = psi(p + vec2(0.0, e), t) - psi(p - vec2(0.0, e), t);
    float dpx = psi(p + vec2(e, 0.0), t) - psi(p - vec2(e, 0.0), t);
    vec2 v = vec2(dpy, -dpx) / (2.0 * e) * 0.010;

    // two hidden stirrers on slow opposing orbits
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float w = (fi < 0.5 ? 1.0 : -1.0);
      vec2 c = vec2(0.5) + 0.26 * vec2(sin(t * 0.05 * w + fi * 3.1 + uSeed),
                                       cos(t * 0.041 * w - fi * 1.7 + uSeed));
      vec2 d = p - c;
      d -= floor(d + 0.5);
      float r2 = dot(d, d) + 0.004;
      v += w * vec2(-d.y, d.x) / r2 * 0.0008 * uStir;
    }
    return v;
  }

  void main(){
    float t = uTime;
    float pace = 0.6 + uFlow * 1.6;

    // semi-Lagrangian advection: fetch the dye from where the water came from
    vec2 from = vUv - velocity(vUv, t) * pace;
    vec2 dye = texture2D(uDye, from).rg;

    // the inks are fed from two slow-orbiting sources; the arc starves them
    float feedGain = (1.0 - 0.9 * uDark) * (1.0 + uPlume * 3.0);
    vec2 cA = vec2(0.5) + 0.33 * vec2(sin(t * 0.021 + uSeed), cos(t * 0.017 + uSeed));
    vec2 cB = vec2(0.5) - 0.33 * vec2(cos(t * 0.019 - uSeed), sin(t * 0.023 - uSeed));
    vec2 dA = vUv - cA; dA -= floor(dA + 0.5);
    vec2 dB = vUv - cB; dB -= floor(dB + 0.5);
    dye.r += exp(-dot(dA, dA) * 500.0) * 0.09 * feedGain;
    dye.g += exp(-dot(dB, dB) * 500.0) * 0.08 * feedGain;

    // a transient's plume lands at a spot the tick chooses
    if (uPlume > 0.02) {
      vec2 sp = fract(vec2(sin(uSeedTick * 12.9898), sin(uSeedTick * 78.233)) * 43758.5453);
      vec2 dP = vUv - sp; dP -= floor(dP + 0.5);
      dye += vec2(0.6, 0.35) * uPlume * exp(-dot(dP, dP) * 700.0) * 0.08;
    }

    // dissipation: the water thins the inks; faster as the arc falls
    dye *= 0.996 - 0.004 * uDark;

    gl_FragColor = vec4(min(dye, vec2(1.4)), 0.0, 1.0);
  }
`;

const displayFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDye;
  uniform vec2 uResolution;
  uniform vec2 uTexel;
  uniform float uTime, uFog, uDark;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 st = (vUv - 0.5) * vec2(aspect, 1.0) * 0.92 + 0.5;
    vec2 dye = texture2D(uDye, st).rg;

    // the folds self-shadow: the total dye's gradient reads as relief
    float tx = texture2D(uDye, st + vec2(uTexel.x, 0.0)).r + texture2D(uDye, st + vec2(uTexel.x, 0.0)).g
             - texture2D(uDye, st - vec2(uTexel.x, 0.0)).r - texture2D(uDye, st - vec2(uTexel.x, 0.0)).g;
    float ty = texture2D(uDye, st + vec2(0.0, uTexel.y)).r + texture2D(uDye, st + vec2(0.0, uTexel.y)).g
             - texture2D(uDye, st - vec2(0.0, uTexel.y)).r - texture2D(uDye, st - vec2(0.0, uTexel.y)).g;
    float shade = clamp(1.0 + 1.6 * (-tx * 0.7 + ty * 0.7), 0.55, 1.45);

    vec3 water = vec3(0.008, 0.012, 0.017);
    vec3 teal = vec3(0.10, 0.36, 0.36);
    vec3 bone = vec3(0.52, 0.46, 0.34);
    // soft-knee mapping keeps thick ink from blowing out while thin veils read
    float a = dye.r / (0.55 + dye.r);
    float b = dye.g / (0.6 + dye.g);
    vec3 col = water + (teal * a * 1.9 + bone * b * 1.7) * shade * (1.0 - 0.65 * uDark);
    col += uFog * 0.030 * vec3(0.15, 0.21, 0.24);
    col *= 1.0 - 0.40 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeDyeTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(SIM_RES, SIM_RES, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.RepeatWrapping;
  return rt;
}

/** The dye field ping-pongs through the advection shader; the display maps the
 *  two inks to the screen. Composer contract as ReefPass. */
class GyrePass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.2 },
    uFlow: { value: 0.45 },
    uDepth: { value: 0.45 },
    uStir: { value: 0.5 },
    uPlume: { value: 0 },
    uSeed: { value: 37 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private dyeA = makeDyeTarget();
  private dyeB = makeDyeTarget();
  private lastSeed = NaN;

  private readonly advectMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDye: { value: null },
      uTime: this.uniforms.uTime!,
      uFlow: this.uniforms.uFlow!,
      uDepth: this.uniforms.uDepth!,
      uDark: this.uniforms.uDark!,
      uStir: this.uniforms.uStir!,
      uPlume: this.uniforms.uPlume!,
      uSeed: this.uniforms.uSeed!,
      uSeedTick: { value: 0 },
    },
    vertexShader: glslVertex,
    fragmentShader: advectFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly displayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDye: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
      uTime: this.uniforms.uTime!,
      uFog: this.uniforms.uFog!,
      uDark: this.uniforms.uDark!,
      uResolution: this.uniforms.uResolution!,
    },
    vertexShader: glslVertex,
    fragmentShader: displayFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.advectMaterial);

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    const seed = this.uniforms.uSeed!.value as number;
    if (seed !== this.lastSeed) {
      this.lastSeed = seed;
      renderer.setRenderTarget(this.dyeA);
      renderer.clear();
      renderer.setRenderTarget(this.dyeB);
      renderer.clear();
    }

    this.advectMaterial.uniforms.uDye!.value = this.dyeA.texture;
    this.quad.material = this.advectMaterial;
    renderer.setRenderTarget(this.dyeB);
    this.quad.render(renderer);
    const swap = this.dyeA;
    this.dyeA = this.dyeB;
    this.dyeB = swap;

    this.displayMaterial.uniforms.uDye!.value = this.dyeA.texture;
    this.quad.material = this.displayMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  setTime(timeSec: number): void {
    this.uniforms.uTime!.value = timeSec;
    this.advectMaterial.uniforms.uSeedTick!.value = Math.floor(timeSec * 0.7) + 1;
  }

  override dispose(): void {
    this.dyeA.dispose();
    this.dyeB.dispose();
    this.advectMaterial.dispose();
    this.displayMaterial.dispose();
    this.quad.dispose();
  }
}

export function createGyre(): VisualLayer {
  const pass = new GyrePass();

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bindDescriptorPorts(descriptor, pass, nodeId, registry, params);
    },
    update(timeSec) {
      pass.setTime(timeSec);
    },
    setResolution(width, height) {
      (pass.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
    },
    setArc(darkness) {
      pass.uniforms.uDark!.value = clamp(darkness, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

export const gyreModule: VisualModule = {
  descriptor,
  create: createGyre,
};
