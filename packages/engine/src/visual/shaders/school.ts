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
  id: 'school',
  label: 'School',
  techniqueFamily: 'flock',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.25, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    // route a slow LFO here: how tightly the school holds itself together
    { key: 'shoal', kind: 'unipolar', min: 0, max: 1, default: 0.55, group: 'scene' },
    // route audio.onset here: something strikes at the school and it BURSTS
    { key: 'startle', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // which school this is — re-scatters the fish live
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 5, group: 'scene' },
  ],
  capabilities: {
    feedback: true, // fish state and a density map ping-pong across frames
    points: true, // the fish are literal points
  },
};

// School — the flock: sixteen thousand fish, each holding station against its
// thousand neighbours by the only rules fish know — swim with the water, stay
// with the school, never touch. The mass breathes, sheets and bends around
// nothing; a transient is a STRIKE from something unseen, and the school does
// the thing schools do: it detonates outward in a silver flash and then,
// slowly, remembers itself. Fish read as flecks of catchlight — bright when
// they turn fast (the flash of a flank), near-invisible cruising. The arc
// thins and slows them until a few stragglers hang in the dark.

const AGENTS_SIDE = 128; // 128² = 16 384 fish
const DENSITY_RES = 192;

const seedFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uSeed;
  varying vec2 vUv;
  void main(){
    vec2 h = hash2(vUv * 73.1 + uSeed);
    vec2 h2 = hash2(vUv.yx * 39.7 - uSeed);
    // the school starts as a loose ball just off-centre
    float ang = h.x * 6.2831853;
    float rad = 0.16 * sqrt(h.y);
    vec2 pos = vec2(0.5, 0.55) + rad * vec2(cos(ang), sin(ang));
    vec2 vel = (h2 - 0.5) * 0.001;
    gl_FragColor = vec4(pos, vel);
  }
`;

const updateFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform sampler2D uAgents;
  uniform sampler2D uDensity;
  uniform float uTime, uFlow, uShoal, uStartle, uDark, uSeed;
  varying vec2 vUv;

  float density(vec2 p){ return texture2D(uDensity, fract(p)).r; }

  void main(){
    vec4 a = texture2D(uAgents, vUv);
    vec2 pos = a.xy;
    vec2 vel = a.zw;

    // the water: a slow curl field every fish swims inside
    float e = 0.02;
    float t = uTime;
    float p1 = fbm3(pos * 2.3 + vec2(0.0, e) + t * 0.03 + uSeed);
    float p2 = fbm3(pos * 2.3 - vec2(0.0, e) + t * 0.03 + uSeed);
    float p3 = fbm3(pos * 2.3 + vec2(e, 0.0) + t * 0.03 + uSeed);
    float p4 = fbm3(pos * 2.3 - vec2(e, 0.0) + t * 0.03 + uSeed);
    vec2 water = vec2(p1 - p2, p4 - p3) / (2.0 * e) * 0.00007;

    // the school's heart wanders; every fish leans toward it (cohesion)
    vec2 heart = vec2(0.5) + vec2(0.24 * sin(t * 0.041 + uSeed) + 0.08 * sin(t * 0.11),
                                  0.22 * cos(t * 0.033 - uSeed) + 0.07 * cos(t * 0.09));
    vec2 toHeart = heart - pos;
    toHeart -= floor(toHeart + 0.5);
    vel += toHeart * 0.00055 * (0.3 + uShoal);

    // separation: swim down the crowd gradient — never touch
    float eD = 1.0 / ${DENSITY_RES.toFixed(1)};
    vec2 grad = vec2(density(pos + vec2(eD, 0.0)) - density(pos - vec2(eD, 0.0)),
                     density(pos + vec2(0.0, eD)) - density(pos - vec2(0.0, eD)));
    vel -= grad * 0.0004 * (1.2 - uShoal * 0.7);

    // the strike: while the envelope is open a predator dashes through the
    // heart's neighbourhood and the school detonates away from it
    if (uStartle > 0.02) {
      vec2 pred = heart + 0.2 * vec2(sin(t * 1.7 + uSeed * 3.0), cos(t * 2.3 - uSeed));
      vec2 dP = pos - pred;
      dP -= floor(dP + 0.5);
      float r2 = dot(dP, dP) + 0.002;
      vel += dP / r2 * 0.00030 * uStartle;
    }

    vel += water;

    // speed law: fish neither stall nor rocket; the arc slows the whole school
    float cruise = (0.0016 + uFlow * 0.0022) * (1.0 - 0.5 * uDark);
    float sp = length(vel);
    float target = clamp(sp, cruise * 0.55, cruise * (1.0 + uStartle * 1.8));
    vel = sp > 1e-6 ? vel / sp * mix(sp, target, 0.5) : vel;

    pos = fract(pos + vel);
    gl_FragColor = vec4(pos, vel);
  }
`;

// density deposit: each fish marks where it is (same trick as the colony)
const depositVertex = /* glsl */ `
  uniform sampler2D uAgents;
  void main(){
    vec2 p = texture2D(uAgents, position.xy).xy;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 2.0;
  }
`;
const depositFragment = /* glsl */ `
  precision highp float;
  void main(){ gl_FragColor = vec4(0.35, 0.0, 0.0, 1.0); }
`;

const blurFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uDensity;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main(){
    float s = 0.0;
    s += texture2D(uDensity, vUv + vec2(-uTexel.x, 0.0)).r;
    s += texture2D(uDensity, vUv + vec2(uTexel.x, 0.0)).r;
    s += texture2D(uDensity, vUv + vec2(0.0, -uTexel.y)).r;
    s += texture2D(uDensity, vUv + vec2(0.0, uTexel.y)).r;
    s += texture2D(uDensity, vUv).r * 2.0;
    gl_FragColor = vec4(s / 6.0 * 0.55, 0.0, 0.0, 1.0); // fast decay: near-instant census
  }
`;

const backgroundFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform vec2 uResolution;
  uniform float uTime, uFog, uDark;
  varying vec2 vUv;
  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    // open water: a faint column of light from above, murk below
    float godlight = exp(-abs(pc.x + 0.1 * sin(uTime * 0.05)) * 3.0)
                   * smoothstep(-0.6, 0.55, pc.y) * (1.0 - 0.85 * uDark);
    vec3 col = vec3(0.007, 0.012, 0.018)
             + vec3(0.030, 0.055, 0.062) * godlight
             + uFog * 0.025 * vec3(0.12, 0.18, 0.21);
    col *= 1.0 - 0.45 * uDark;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// the fish themselves: a fleck whose brightness is its turning flash
const fishVertex = /* glsl */ `
  uniform sampler2D uAgents;
  uniform vec2 uView; // zoom (x) and dark-thinning threshold (y)
  varying float vFlash;
  varying float vKeep;
  void main(){
    vec4 a = texture2D(uAgents, position.xy);
    // catchlight: speed reads as the silver flash of a turning flank
    vFlash = clamp(length(a.zw) * 900.0 - 0.9, 0.05, 2.2);
    // the arc thins the school — some fish simply are not there any more
    float h = fract(sin(dot(position.xy, vec2(127.1, 311.7))) * 43758.5453);
    vKeep = step(h, uView.y);
    vec2 centred = (a.xy - 0.5) * uView.x + 0.5;
    gl_Position = vec4(centred * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 2.0;
  }
`;
const fishFragment = /* glsl */ `
  precision highp float;
  uniform float uDark;
  varying float vFlash;
  varying float vKeep;
  void main(){
    if (vKeep < 0.5) discard;
    vec2 d = gl_PointCoord - 0.5;
    float body = exp(-dot(d, d) * 9.0);
    vec3 cruise = vec3(0.09, 0.16, 0.18);
    vec3 flash = vec3(0.62, 0.72, 0.74);
    vec3 col = mix(cruise, flash, clamp(vFlash - 0.2, 0.0, 1.0));
    gl_FragColor = vec4(col * body * vFlash * (1.0 - 0.45 * uDark), 1.0);
  }
`;

function makeAgentTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(AGENTS_SIDE, AGENTS_SIDE, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
  });
}

function makeDensityTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(DENSITY_RES, DENSITY_RES, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.RepeatWrapping;
  return rt;
}

/** Fish state ping-pongs through the swim shader; a blurred census map gives
 *  every fish its crowd gradient; the render pass draws water then composites
 *  the school as additive catchlight points. Composer contract as ReefPass. */
class SchoolPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.25 },
    uFlow: { value: 0.45 },
    uDepth: { value: 0.4 },
    uShoal: { value: 0.55 },
    uStartle: { value: 0 },
    uSeed: { value: 5 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private agentsA = makeAgentTarget();
  private agentsB = makeAgentTarget();
  private densityA = makeDensityTarget();
  private densityB = makeDensityTarget();
  private seeded = false;
  private lastSeed = NaN;

  private readonly seedMaterial = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: 5 } },
    vertexShader: glslVertex,
    fragmentShader: seedFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly updateMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAgents: { value: null },
      uDensity: { value: null },
      uTime: this.uniforms.uTime!,
      uFlow: this.uniforms.uFlow!,
      uShoal: this.uniforms.uShoal!,
      uStartle: this.uniforms.uStartle!,
      uDark: this.uniforms.uDark!,
      uSeed: this.uniforms.uSeed!,
    },
    vertexShader: glslVertex,
    fragmentShader: updateFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly depositMaterial = new THREE.ShaderMaterial({
    uniforms: { uAgents: { value: null } },
    vertexShader: depositVertex,
    fragmentShader: depositFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  private readonly blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDensity: { value: null },
      uTexel: { value: new THREE.Vector2(1 / DENSITY_RES, 1 / DENSITY_RES) },
    },
    vertexShader: glslVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly backgroundMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: this.uniforms.uTime!,
      uFog: this.uniforms.uFog!,
      uDark: this.uniforms.uDark!,
      uResolution: this.uniforms.uResolution!,
    },
    vertexShader: glslVertex,
    fragmentShader: backgroundFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly fishMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAgents: { value: null },
      uView: { value: new THREE.Vector2(1, 1) },
      uDark: this.uniforms.uDark!,
    },
    vertexShader: fishVertex,
    fragmentShader: fishFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.seedMaterial);
  private readonly pointScene = new THREE.Scene();
  private readonly pointCamera = new THREE.Camera();
  private readonly pointGeometry: THREE.BufferGeometry;
  private readonly points: THREE.Points;

  constructor() {
    super();
    const refs = new Float32Array(AGENTS_SIDE * AGENTS_SIDE * 3);
    let k = 0;
    for (let y = 0; y < AGENTS_SIDE; y++) {
      for (let x = 0; x < AGENTS_SIDE; x++) {
        refs[k++] = (x + 0.5) / AGENTS_SIDE;
        refs[k++] = (y + 0.5) / AGENTS_SIDE;
        refs[k++] = 0;
      }
    }
    this.pointGeometry = new THREE.BufferGeometry();
    this.pointGeometry.setAttribute('position', new THREE.BufferAttribute(refs, 3));
    this.points = new THREE.Points(this.pointGeometry, this.depositMaterial);
    this.points.frustumCulled = false;
    this.pointScene.add(this.points);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    const seed = this.uniforms.uSeed!.value as number;
    if (seed !== this.lastSeed) {
      this.lastSeed = seed;
      this.seedMaterial.uniforms.uSeed!.value = seed;
      this.seeded = false;
    }
    if (!this.seeded) {
      this.quad.material = this.seedMaterial;
      renderer.setRenderTarget(this.agentsA);
      this.quad.render(renderer);
      renderer.setRenderTarget(this.densityA);
      renderer.clear();
      this.seeded = true;
    }

    // 1. the school swims: sense the census, lean to the heart, never touch
    this.updateMaterial.uniforms.uAgents!.value = this.agentsA.texture;
    this.updateMaterial.uniforms.uDensity!.value = this.densityA.texture;
    this.quad.material = this.updateMaterial;
    renderer.setRenderTarget(this.agentsB);
    this.quad.render(renderer);
    const swapA = this.agentsA;
    this.agentsA = this.agentsB;
    this.agentsB = swapA;

    // 2. fresh census: blur-decay the old map, then every fish marks itself
    this.blurMaterial.uniforms.uDensity!.value = this.densityA.texture;
    this.quad.material = this.blurMaterial;
    renderer.setRenderTarget(this.densityB);
    this.quad.render(renderer);
    this.depositMaterial.uniforms.uAgents!.value = this.agentsA.texture;
    this.points.material = this.depositMaterial;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.pointScene, this.pointCamera);
    renderer.autoClear = autoClear;
    const swapD = this.densityA;
    this.densityA = this.densityB;
    this.densityB = swapD;

    // 3. draw the water, then the school over it as catchlight
    const dark = this.uniforms.uDark!.value as number;
    const depth = this.uniforms.uDepth!.value as number;
    (this.fishMaterial.uniforms.uView!.value as THREE.Vector2).set(
      1.0 + depth * 1.2, // depth leans into the school
      1.0 - dark * 0.7, // the arc thins it
    );
    this.quad.material = this.backgroundMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.fishMaterial.uniforms.uAgents!.value = this.agentsA.texture;
    this.points.material = this.fishMaterial;
    renderer.autoClear = false;
    renderer.render(this.pointScene, this.pointCamera);
    renderer.autoClear = autoClear;
  }

  setTime(timeSec: number): void {
    this.uniforms.uTime!.value = timeSec;
  }

  override dispose(): void {
    this.agentsA.dispose();
    this.agentsB.dispose();
    this.densityA.dispose();
    this.densityB.dispose();
    this.seedMaterial.dispose();
    this.updateMaterial.dispose();
    this.depositMaterial.dispose();
    this.blurMaterial.dispose();
    this.backgroundMaterial.dispose();
    this.fishMaterial.dispose();
    this.pointGeometry.dispose();
    this.quad.dispose();
  }
}

export function createSchool(): VisualLayer {
  const pass = new SchoolPass();

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

export const schoolModule: VisualModule = {
  descriptor,
  create: createSchool,
};
