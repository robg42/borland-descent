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
  id: 'physarum',
  label: 'Colony',
  techniqueFamily: 'agent simulation',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.15, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    // route a slow LFO here: how widely the colony feels ahead of itself —
    // tight capillaries at 0, open searching webs at 1
    { key: 'sense', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'scene' },
    // how long the roads stay warm — the colony's working memory
    { key: 'decay', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // route audio.onset here: the whole colony surges and lays brighter trail
    { key: 'feed', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // which colony this is; CHANGING it re-scatters the organism live
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 11, group: 'scene' },
  ],
  capabilities: {
    feedback: true, // agent state AND trail map ping-pong across frames
    points: true, // deposit renders the agents as literal points
  },
};

// Colony — the slime mould (physarum lineage): twenty-five thousand blind
// agents, each knowing only the smell of the trails ahead of it, together
// drawing ONE organism — roads that thicken with use, starve when abandoned,
// and reroute around nothing at all. Nobody drew the network; it is the
// after-image of twenty-five thousand journeys. Sense sets how far the
// colony feels ahead of itself (tight capillaries to open webs), decay is
// its working memory, and a transient makes the whole organism surge. The
// arc starves it: trails cool faster than they are laid, the network thins
// to its trunk routes, then to ghosts.

const AGENTS_SIDE = 256; // 256² = 65 536 agents
const TRAIL_RES = 384;

// One texel per agent: (x, y, heading, spare). Positions live in [0,1) trail space.
const agentSeedFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform float uSeed;
  varying vec2 vUv;
  void main(){
    vec2 h = hash2(vUv * 61.7 + uSeed);
    vec2 h2 = hash2(vUv.yx * 47.3 - uSeed);
    // scatter in a loose disc so the colony has to find its own edges
    float ang = h.x * 6.2831853;
    float rad = 0.05 + 0.38 * sqrt(h.y);
    vec2 pos = fract(vec2(0.5) + rad * vec2(cos(ang), sin(ang)));
    gl_FragColor = vec4(pos, h2.x * 6.2831853, 0.0);
  }
`;

const agentUpdateFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform sampler2D uAgents;
  uniform sampler2D uTrail;
  uniform float uTime, uSpeed, uSense, uDark, uSeed;
  varying vec2 vUv;

  // nutrient wells: four unseen feeding grounds wandering the bath on
  // minutes-long orbits. They are what stops the colony optimising itself
  // down to one super-road — there is always somewhere else worth going,
  // so the network keeps trunk routes BETWEEN wells and reconfigures as
  // they drift (the Tokyo-rail experiment, for ever).
  float wells(vec2 p){
    float w = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 c = vec2(0.5) + 0.33 * vec2(sin(uTime * 0.031 + fi * 1.7 + uSeed),
                                       cos(uTime * 0.024 + fi * 2.9 - uSeed));
      vec2 d = p - c;
      d -= floor(d + 0.5); // toroidal distance
      w += exp(-dot(d, d) * 120.0);
    }
    return w;
  }

  // saturating sense: past a point a hotter road smells no stronger — without
  // this cap the whole colony condenses into one rotating mill
  float smell(vec2 p){ return min(texture2D(uTrail, fract(p)).r, 1.2) + wells(p) * 0.3; }

  void main(){
    vec4 a = texture2D(uAgents, vUv);
    vec2 pos = a.xy;
    float heading = a.z;

    // three sensors ahead — the only sense the agent has
    float sd = mix(0.006, 0.022, uSense);   // sensor distance
    float sa = mix(0.35, 0.75, uSense);     // sensor spread (radians)
    float f = smell(pos + sd * vec2(cos(heading), sin(heading)));
    float l = smell(pos + sd * vec2(cos(heading + sa), sin(heading + sa)));
    float r = smell(pos + sd * vec2(cos(heading - sa), sin(heading - sa)));

    // the Jones dynamics: rotate BY the sensor angle — steering and sensing
    // matched is what lets separate journeys condense into shared roads
    float turn = sa;
    float rnd = hash(vUv * 131.1 + fract(uTime) * 17.0 + uSeed);
    float jitter = (rnd - 0.5) * 0.3;
    if (f >= l && f >= r) heading += jitter;                   // keep on
    else if (l > r) heading += turn + jitter;                  // bear left
    else heading -= turn + jitter;                             // bear right
    // the rare stray: an agent that abandons the road entirely — the noise
    // that keeps the network exploring instead of milling
    if (rnd > 0.985) heading += (hash(vUv.yx * 91.7 + uTime) - 0.5) * 3.14159;

    // each agent has its own gait; starving colonies all move slower
    float gait = 0.75 + 0.5 * hash(vUv * 53.9);
    float step = uSpeed * gait * (1.0 - 0.55 * uDark);
    pos = fract(pos + step * vec2(cos(heading), sin(heading)));

    // rebirth: a sliver of the colony reincarnates somewhere new each frame —
    // the hubs can keep their citizens, but the dark is never left unexplored
    // and fresh filaments are always being drawn
    if (hash(vUv * 211.3 + fract(uTime * 0.37) * 29.0 + uSeed) > 0.9965) {
      pos = hash2(vUv * 97.7 + fract(uTime * 0.61) * 13.0 + uSeed);
      heading = hash(pos * 331.1) * 6.2831853;
    }

    gl_FragColor = vec4(pos, heading, 0.0);
  }
`;

// Deposit: each agent stamps one texel of pheromone onto the trail map. The
// vertex's `position.xy` (three's built-in attribute — also what the renderer
// derives the draw count from) carries the agent's texel address, not a
// location: the location is fetched from the state map.
const depositVertex = /* glsl */ `
  uniform sampler2D uAgents;
  void main(){
    vec2 p = texture2D(uAgents, position.xy).xy;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`;
const depositFragment = /* glsl */ `
  precision highp float;
  uniform float uDeposit;
  void main(){ gl_FragColor = vec4(uDeposit, 0.0, 0.0, 1.0); }
`;

// Diffuse + decay: the pheromone spreads a little and cools.
const trailFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTrail;
  uniform vec2 uTexel;
  uniform float uDecay, uDark;
  varying vec2 vUv;
  void main(){
    float s = 0.0;
    s += texture2D(uTrail, vUv + vec2(-uTexel.x, -uTexel.y)).r;
    s += texture2D(uTrail, vUv + vec2(0.0, -uTexel.y)).r;
    s += texture2D(uTrail, vUv + vec2(uTexel.x, -uTexel.y)).r;
    s += texture2D(uTrail, vUv + vec2(-uTexel.x, 0.0)).r;
    s += texture2D(uTrail, vUv).r;
    s += texture2D(uTrail, vUv + vec2(uTexel.x, 0.0)).r;
    s += texture2D(uTrail, vUv + vec2(-uTexel.x, uTexel.y)).r;
    s += texture2D(uTrail, vUv + vec2(0.0, uTexel.y)).r;
    s += texture2D(uTrail, vUv + vec2(uTexel.x, uTexel.y)).r;
    // the arc cools the roads faster than the colony can warm them
    float keep = uDecay * (1.0 - 0.25 * uDark);
    gl_FragColor = vec4((s / 9.0) * keep, 0.0, 0.0, 1.0);
  }
`;

const displayFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTrail;
  uniform vec2 uResolution;
  uniform float uTime, uFog, uDepth, uDark;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 st = (vUv - 0.5) * vec2(aspect, 1.0) * mix(1.15, 0.55, uDepth) + 0.5;
    float t = texture2D(uTrail, fract(st)).r;

    // the network read as bioluminescence, mapped around the field's resting
    // mean (~0.1): the ambient haze is the colony's breath, veins are roads
    // above the mean, nodes the junctions running several times hotter
    float haze = clamp(t * 1.2, 0.0, 0.22);
    float veins = smoothstep(0.09, 0.50, t);
    float nodes = smoothstep(0.70, 2.0, t);
    vec3 water = vec3(0.006, 0.010, 0.014);
    vec3 vein = vec3(0.10, 0.34, 0.32);
    vec3 node = vec3(0.72, 0.66, 0.50);
    vec3 col = water
             + vein * (haze + veins) * (1.0 - 0.65 * uDark)
             + node * nodes * (1.0 - 0.50 * uDark);
    col += uFog * 0.030 * vec3(0.14, 0.20, 0.22);
    col *= 1.0 - 0.40 * uDark;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeTarget(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.RepeatWrapping;
  return rt;
}

function makeAgentTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(AGENTS_SIDE, AGENTS_SIDE, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
  });
}

/**
 * Three coupled feedback systems inside one Pass: agent state (160² texels,
 * one agent each) ping-pongs through the sense/turn/step shader; the agents
 * stamp pheromone into the trail map as literal GL points; the trail diffuses,
 * decays and feeds back into the agents' senses next frame. The composer
 * contract is honoured — the display render lands in writeBuffer or on screen.
 */
class PhysarumPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.15 },
    uFlow: { value: 0.45 },
    uDepth: { value: 0.4 },
    uSense: { value: 0.45 },
    uDecay: { value: 0.5 },
    uFeed: { value: 0 },
    uSeed: { value: 11 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private agentsA = makeAgentTarget();
  private agentsB = makeAgentTarget();
  private trailA = makeTarget(TRAIL_RES);
  private trailB = makeTarget(TRAIL_RES);
  private seeded = false;
  private lastSeed = NaN;

  private readonly seedMaterial = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: 11 } },
    vertexShader: glslVertex,
    fragmentShader: agentSeedFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly updateMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAgents: { value: null },
      uTrail: { value: null },
      uTime: this.uniforms.uTime!,
      uSpeed: { value: 0.002 },
      uSense: this.uniforms.uSense!,
      uDark: this.uniforms.uDark!,
      uSeed: this.uniforms.uSeed!,
    },
    vertexShader: glslVertex,
    fragmentShader: agentUpdateFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly trailMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTrail: { value: null },
      uTexel: { value: new THREE.Vector2(1 / TRAIL_RES, 1 / TRAIL_RES) },
      uDecay: { value: 0.96 },
      uDark: this.uniforms.uDark!,
    },
    vertexShader: glslVertex,
    fragmentShader: trailFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly displayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTrail: { value: null },
      uResolution: this.uniforms.uResolution!,
      uTime: this.uniforms.uTime!,
      uFog: this.uniforms.uFog!,
      uDepth: this.uniforms.uDepth!,
      uDark: this.uniforms.uDark!,
    },
    vertexShader: glslVertex,
    fragmentShader: displayFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly depositMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAgents: { value: null },
      uDeposit: { value: 0.22 },
    },
    vertexShader: depositVertex,
    fragmentShader: depositFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.seedMaterial);
  private readonly depositScene = new THREE.Scene();
  private readonly depositCamera = new THREE.Camera();
  private readonly depositGeometry: THREE.BufferGeometry;

  constructor() {
    super();
    // one vertex per agent, its texel address packed into position.xy
    const refs = new Float32Array(AGENTS_SIDE * AGENTS_SIDE * 3);
    let k = 0;
    for (let y = 0; y < AGENTS_SIDE; y++) {
      for (let x = 0; x < AGENTS_SIDE; x++) {
        refs[k++] = (x + 0.5) / AGENTS_SIDE;
        refs[k++] = (y + 0.5) / AGENTS_SIDE;
        refs[k++] = 0;
      }
    }
    this.depositGeometry = new THREE.BufferGeometry();
    this.depositGeometry.setAttribute('position', new THREE.BufferAttribute(refs, 3));
    // the addresses are not spatial — never let the frustum cull them
    const points = new THREE.Points(this.depositGeometry, this.depositMaterial);
    points.frustumCulled = false;
    this.depositScene.add(points);
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
      // raze the trail map with the colony
      renderer.setRenderTarget(this.trailA);
      renderer.clear();
      renderer.setRenderTarget(this.trailB);
      renderer.clear();
      this.seeded = true;
    }

    const flow = clamp(this.uniforms.uFlow!.value as number, 0, 1);
    const feed = clamp(this.uniforms.uFeed!.value as number, 0, 1);
    // high persistence is what keeps a WEB alive: the field holds gradient
    // history everywhere, so no single road can win the whole colony
    this.updateMaterial.uniforms.uSpeed!.value = 0.002 + flow * 0.002;
    this.trailMaterial.uniforms.uDecay!.value =
      0.97 + clamp(this.uniforms.uDecay!.value as number, 0, 1) * 0.025;
    this.depositMaterial.uniforms.uDeposit!.value = 0.012 * (1.0 + feed * 1.6);

    // 1. agents sense the latest trail and step
    this.updateMaterial.uniforms.uAgents!.value = this.agentsA.texture;
    this.updateMaterial.uniforms.uTrail!.value = this.trailA.texture;
    this.quad.material = this.updateMaterial;
    renderer.setRenderTarget(this.agentsB);
    this.quad.render(renderer);
    const swapA = this.agentsA;
    this.agentsA = this.agentsB;
    this.agentsB = swapA;

    // 2. the trail spreads and cools
    this.trailMaterial.uniforms.uTrail!.value = this.trailA.texture;
    this.quad.material = this.trailMaterial;
    renderer.setRenderTarget(this.trailB);
    this.quad.render(renderer);

    // 3. every agent stamps pheromone onto the cooled map (additive points)
    this.depositMaterial.uniforms.uAgents!.value = this.agentsA.texture;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.depositScene, this.depositCamera);
    renderer.autoClear = autoClear;
    const swapT = this.trailA;
    this.trailA = this.trailB;
    this.trailB = swapT;

    // 4. read the organism to the screen
    this.displayMaterial.uniforms.uTrail!.value = this.trailA.texture;
    this.quad.material = this.displayMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  setTime(timeSec: number): void {
    this.uniforms.uTime!.value = timeSec;
  }

  override dispose(): void {
    this.agentsA.dispose();
    this.agentsB.dispose();
    this.trailA.dispose();
    this.trailB.dispose();
    this.seedMaterial.dispose();
    this.updateMaterial.dispose();
    this.trailMaterial.dispose();
    this.displayMaterial.dispose();
    this.depositMaterial.dispose();
    this.depositGeometry.dispose();
    this.quad.dispose();
  }
}

export function createPhysarum(): VisualLayer {
  const pass = new PhysarumPass();

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

export const physarumModule: VisualModule = {
  descriptor,
  create: createPhysarum,
};
