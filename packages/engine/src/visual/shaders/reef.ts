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
  id: 'reef',
  label: 'Reef',
  techniqueFamily: 'reaction–diffusion',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'field' },
    // route a slow LFO here: where on the Pearson band the chemistry sits —
    // solitary spots at 0, branching coral at 1
    { key: 'growth', kind: 'unipolar', min: 0, max: 1, default: 0.6, group: 'scene' },
    // route audio.onset here: a spore settles and a new colony grows from it
    { key: 'spore', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // route fft.high here: light plays on the living growth fronts
    { key: 'glint', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'scene' },
  ],
  capabilities: {
    feedback: true, // self-managed ping-pong — the sim lives in two private targets
  },
};

// Reef — reaction–diffusion (Gray–Scott lineage): the first module in the
// roster that REMEMBERS. Two chemicals feed and consume each other in a
// 256² bath that ping-pongs between frames, and the picture is not drawn but
// GROWN — colonies branch, collide and heal, and no frame can be recomputed
// from a clock because the pattern is its own history. Growth moves the
// chemistry along the Pearson band from solitary spots to branching coral; a
// transient drops a spore that becomes a new colony. The arc starves the
// bath: the feed rate falls with the dark and the reef dissolves from its
// thinnest branches inward — a decay you cannot rewind.

const SIM_RES = 256;

const simFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform float uGrowth, uSpore, uDark, uSeedTick;
  varying vec2 vUv;

  void main(){
    vec2 c = texture2D(uPrev, vUv).rg;
    // 9-point Laplacian; RepeatWrapping makes the bath a torus
    vec2 lap = -c
      + 0.20 * texture2D(uPrev, vUv + vec2( uTexel.x, 0.0)).rg
      + 0.20 * texture2D(uPrev, vUv + vec2(-uTexel.x, 0.0)).rg
      + 0.20 * texture2D(uPrev, vUv + vec2(0.0,  uTexel.y)).rg
      + 0.20 * texture2D(uPrev, vUv + vec2(0.0, -uTexel.y)).rg
      + 0.05 * texture2D(uPrev, vUv + uTexel).rg
      + 0.05 * texture2D(uPrev, vUv - uTexel).rg
      + 0.05 * texture2D(uPrev, vUv + vec2(uTexel.x, -uTexel.y)).rg
      + 0.05 * texture2D(uPrev, vUv + vec2(-uTexel.x, uTexel.y)).rg;

    // the Pearson band: solitary spots -> branching coral; the dark starves it
    float feed = mix(0.030, 0.058, uGrowth) * (1.0 - 0.90 * uDark);
    float kill = mix(0.057, 0.062, uGrowth);

    float A = c.r, B = c.g;
    float reaction = A * B * B;
    A = clamp(A + (1.00 * lap.x - reaction + feed * (1.0 - A)), 0.0, 1.0);
    B = clamp(B + (0.50 * lap.y + reaction - (kill + feed) * B), 0.0, 1.0);

    // a spore settles while the envelope is open, at a spot the tick chooses
    if (uSpore > 0.02) {
      vec2 sp = fract(vec2(sin(uSeedTick * 12.9898), sin(uSeedTick * 78.233)) * 43758.5453);
      float d2 = dot(vUv - sp, vUv - sp);
      B = min(B + uSpore * 0.30 * exp(-d2 * 1400.0), 1.0);
    }

    gl_FragColor = vec4(A, B, 0.0, 1.0);
  }
`;

const seedFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  varying vec2 vUv;

  void main(){
    // a full bath of A with a few settled patches of B to grow from
    float n = noise(vUv * 7.0) * 0.7 + noise(vUv * 19.0) * 0.3;
    float B = smoothstep(0.72, 0.80, n) * 0.5;
    float d2 = dot(vUv - 0.5, vUv - 0.5);
    B += 0.5 * exp(-d2 * 900.0);
    gl_FragColor = vec4(1.0, min(B, 1.0), 0.0, 1.0);
  }
`;

const displayFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uState;
  uniform vec2 uResolution;
  uniform vec2 uTexel;
  uniform float uTime, uFog, uDepth, uDark, uGlint;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    // depth leans into the bath; the torus wraps whatever the crop asks for
    vec2 st = (vUv - 0.5) * vec2(aspect, 1.0) * mix(1.05, 0.55, uDepth) + 0.5;

    float B = texture2D(uState, st).g;
    float bx = texture2D(uState, st + vec2(uTexel.x, 0.0)).g
             - texture2D(uState, st - vec2(uTexel.x, 0.0)).g;
    float by = texture2D(uState, st + vec2(0.0, uTexel.y)).g
             - texture2D(uState, st - vec2(0.0, uTexel.y)).g;
    float front = length(vec2(bx, by));

    // the grown mass, lit shallowly from the upper left
    float body = smoothstep(0.10, 0.34, B);
    float shade = clamp(0.62 + 6.0 * (-bx * 0.7 + by * 0.7), 0.25, 1.35);

    // light plays on the living edge; a slow shimmer sweeps the fronts
    float shimmer = 0.6 + 0.4 * sin(uTime * 0.4 + (st.x + st.y) * 18.0);
    float glow = front * 5.0 * uGlint * shimmer;

    vec3 water = vec3(0.007, 0.012, 0.016);
    vec3 bone = vec3(0.50, 0.44, 0.36);
    vec3 teal = vec3(0.16, 0.40, 0.38);
    vec3 col = water
             + bone * body * shade * (1.0 - 0.70 * uDark)
             + teal * glow * (1.0 - 0.55 * uDark);
    col += uFog * 0.035 * vec3(0.16, 0.22, 0.25);
    col *= 1.0 - 0.40 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSimTarget(): THREE.WebGLRenderTarget {
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

/**
 * A self-contained feedback pass: two private 256² half-float targets ping-pong
 * the Gray–Scott state (a few steps per frame), then a display material maps
 * the state to the screen. The composer contract is honoured — the pass renders
 * into writeBuffer (or the screen), so it slots into the steady chain and the
 * crossfade path exactly like a ShaderPass.
 */
class ReefPass extends Pass {
  /** Shared uniform objects — the descriptor binder writes straight into these. */
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.2 },
    uFlow: { value: 0.45 },
    uDepth: { value: 0.5 },
    uGrowth: { value: 0.6 },
    uSpore: { value: 0 },
    uGlint: { value: 0.35 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private readonly simTexel = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);
  private simA = makeSimTarget();
  private simB = makeSimTarget();
  private seeded = false;

  private readonly simMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: null },
      uTexel: { value: this.simTexel },
      uGrowth: this.uniforms.uGrowth!,
      uSpore: this.uniforms.uSpore!,
      uDark: this.uniforms.uDark!,
      uSeedTick: { value: 0 },
    },
    vertexShader: glslVertex,
    fragmentShader: simFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly seedMaterial = new THREE.ShaderMaterial({
    vertexShader: glslVertex,
    fragmentShader: seedFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly displayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uState: { value: null },
      uTexel: { value: this.simTexel },
      uTime: this.uniforms.uTime!,
      uFog: this.uniforms.uFog!,
      uDepth: this.uniforms.uDepth!,
      uDark: this.uniforms.uDark!,
      uGlint: this.uniforms.uGlint!,
      uResolution: this.uniforms.uResolution!,
    },
    vertexShader: glslVertex,
    fragmentShader: displayFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.seedMaterial);

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (!this.seeded) {
      this.quad.material = this.seedMaterial;
      renderer.setRenderTarget(this.simA);
      this.quad.render(renderer);
      this.seeded = true;
    }

    // flow is growth speed: how many chemistry steps each frame carries
    const flow = this.uniforms.uFlow!.value as number;
    const steps = 1 + Math.round(clamp(flow, 0, 1) * 5);
    this.quad.material = this.simMaterial;
    for (let i = 0; i < steps; i++) {
      this.simMaterial.uniforms.uPrev!.value = this.simA.texture;
      renderer.setRenderTarget(this.simB);
      this.quad.render(renderer);
      const swap = this.simA;
      this.simA = this.simB;
      this.simB = swap;
    }

    this.quad.material = this.displayMaterial;
    this.displayMaterial.uniforms.uState!.value = this.simA.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  /** Advance the spore clock — a settled spore keeps its spot for ~1.4 s. */
  setTime(timeSec: number): void {
    this.uniforms.uTime!.value = timeSec;
    this.simMaterial.uniforms.uSeedTick!.value = Math.floor(timeSec * 0.7) + 1;
  }

  override dispose(): void {
    this.simA.dispose();
    this.simB.dispose();
    this.simMaterial.dispose();
    this.seedMaterial.dispose();
    this.displayMaterial.dispose();
    this.quad.dispose();
  }
}

export function createReef(): VisualLayer {
  const pass = new ReefPass();

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

export const reefModule: VisualModule = {
  descriptor,
  create: createReef,
};
