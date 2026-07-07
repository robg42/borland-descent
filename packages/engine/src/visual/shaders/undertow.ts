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
  id: 'undertow',
  label: 'Undertow',
  techniqueFamily: 'video feedback',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.2, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'field' },
    // route a slow LFO here: how hard the past is pulled down the tunnel
    { key: 'pull', kind: 'unipolar', min: 0, max: 1, default: 0.45, group: 'scene' },
    // route bassMeter.level here: the tunnel slowly wrings itself
    { key: 'twist', kind: 'bipolar', min: -1, max: 1, default: 0.25, group: 'scene' },
    // route audio.onset here: a flare of light enters and sinks for ever
    { key: 'flare', kind: 'unipolar', min: 0, max: 1, default: 0, group: 'scene' },
    // which undertow this is — a different figure, a different drift
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 3, group: 'scene' },
  ],
  capabilities: {
    feedback: true, // the frame itself is the state — echo ping-pong
  },
};

// Undertow — video feedback: the frame remembering itself. One luminous
// figure is drawn each frame; everything else on screen is that figure's own
// past, pulled down the tunnel, wrung by a slow twist, cooled toward deep
// water blue with every remembering. Nothing is modelled — the depth is made
// entirely of time. Pull is the strength of the undertow, twist wrings the
// column, echo lives in `depth` as how long the past survives, and a
// transient is a flare of light that enters once and sinks for ever. The arc
// shortens the memory: echoes die young, the tunnel closes in, until only
// the figure remains, alone, remembering nothing.

const feedbackFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform sampler2D uPrev;
  uniform vec2 uResolution;
  uniform float uTime, uFog, uFlow, uDepth, uDark, uPull, uTwist, uFlare, uSeed;
  varying vec2 vUv;

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);

    // the undertow: sample the past slightly outward and rotated — each frame
    // the whole of history shrinks one step further down the tunnel
    vec2 centre = vec2(0.5) + 0.06 * vec2(sin(uTime * 0.043 + uSeed), cos(uTime * 0.037 - uSeed));
    vec2 d = (vUv - centre) * vec2(aspect, 1.0);
    float zoom = 1.0 + mix(0.010, 0.038, uPull);
    float ang = uTwist * 0.014;
    float ca = cos(ang), sa = sin(ang);
    vec2 rd = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca) * zoom;
    vec2 puv = centre + rd / vec2(aspect, 1.0);

    // every remembering cools toward deep water; the arc shortens the memory
    float gain = mix(0.88, 0.97, uDepth) * (1.0 - 0.30 * uDark);
    vec3 tint = vec3(0.86, 0.93, 0.97);
    vec3 past = texture2D(uPrev, puv).rgb * gain * tint;
    // the past beyond the frame is dark water, not smeared edge pixels
    if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) past = vec3(0.0);

    // the figure drawn fresh each frame: a breathing ring sized to the frame's
    // shorter axis, warped by slow noise, with three faint attendants
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);
    float fit = 0.5 * min(aspect, 1.0);
    float t = uTime * (0.2 + uFlow * 0.6);
    float an = atan(pc.y, pc.x);
    // periodic in angle (noise fed unit-circle coords) — no seam at ±pi
    float warp = (fbm3(vec2(cos(an), sin(an)) * 1.4 + uSeed + t * 0.35) - 0.5) * 0.18
               + 0.05 * sin(an * 5.0 - t * 0.7);
    float ringR = fit * (0.62 + 0.08 * sin(t * 0.31) + warp);
    float band = abs(length(pc) - ringR);
    // the figure BEATS rather than burns — each pulse leaves one discrete
    // echo, so the past reads as a tunnel of rings instead of a smear
    float beat = 0.5 + 0.5 * pow(0.5 + 0.5 * sin(uTime * 2.6), 4.0);
    float ring = exp(-band * band * 14000.0) * beat;

    float glints = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ga = t * (0.21 + fi * 0.07) + fi * 2.094 + uSeed;
      vec2 gp = (ringR + fit * (0.22 + 0.08 * sin(t * 0.5 + fi))) * vec2(cos(ga), sin(ga));
      float gd = length(pc - gp);
      glints += exp(-gd * gd * 14000.0);
    }

    // composite, don't add: where the figure is, it REPLACES the past — the
    // ring stays its own colour and the echoes form behind it as it moves,
    // instead of stacking additively into blown white
    float bright = (1.0 - 0.55 * uDark) * (1.0 + uFlare * 2.2);
    float a = clamp(ring + glints * 0.8, 0.0, 1.0);
    vec3 inkCol = (vec3(0.48, 0.68, 0.66) * ring + vec3(0.68, 0.62, 0.46) * glints)
                / max(ring + glints, 1e-4);
    // translucent ink: the past stays visible through the fresh figure, so
    // the tunnel of echoes reads instead of being erased where they overlap
    vec3 col = mix(past, inkCol * bright, a * 0.8);
    col += uFog * 0.010 * vec3(0.10, 0.16, 0.20);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const displayFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform float uDark;
  varying vec2 vUv;
  void main(){
    vec3 col = texture2D(uScene, vUv).rgb;
    // a breath of base water so the void is never a dead black
    col += vec3(0.005, 0.009, 0.012) * (1.0 - 0.6 * uDark);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The frame is the state: two ping-pong targets at display size; each render
 *  re-draws history one step further down the tunnel, adds the fresh figure,
 *  and composites to the writeBuffer. */
class UndertowPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.2 },
    uFlow: { value: 0.4 },
    uDepth: { value: 0.45 },
    uPull: { value: 0.45 },
    uTwist: { value: 0.25 },
    uFlare: { value: 0 },
    uSeed: { value: 3 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private echoA: THREE.WebGLRenderTarget | null = null;
  private echoB: THREE.WebGLRenderTarget | null = null;

  private readonly feedbackMaterial = new THREE.ShaderMaterial({
    uniforms: { uPrev: { value: null }, ...this.uniforms },
    vertexShader: glslVertex,
    fragmentShader: feedbackFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly displayMaterial = new THREE.ShaderMaterial({
    uniforms: { uScene: { value: null }, uDark: this.uniforms.uDark! },
    vertexShader: glslVertex,
    fragmentShader: displayFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.feedbackMaterial);

  setResolution(width: number, height: number): void {
    (this.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (this.echoA && this.echoA.width === w && this.echoA.height === h) return;
    this.echoA?.dispose();
    this.echoB?.dispose();
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    };
    this.echoA = new THREE.WebGLRenderTarget(w, h, opts);
    this.echoB = new THREE.WebGLRenderTarget(w, h, opts);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (!this.echoA || !this.echoB) this.setResolution(2, 2);

    // one step of remembering: past (echoA) + fresh figure → echoB
    this.feedbackMaterial.uniforms.uPrev!.value = this.echoA!.texture;
    this.quad.material = this.feedbackMaterial;
    renderer.setRenderTarget(this.echoB);
    this.quad.render(renderer);
    const swap = this.echoA!;
    this.echoA = this.echoB;
    this.echoB = swap;

    this.displayMaterial.uniforms.uScene!.value = this.echoA!.texture;
    this.quad.material = this.displayMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.echoA?.dispose();
    this.echoB?.dispose();
    this.feedbackMaterial.dispose();
    this.displayMaterial.dispose();
    this.quad.dispose();
  }
}

export function createUndertow(): VisualLayer {
  const pass = new UndertowPass();

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bindDescriptorPorts(descriptor, pass, nodeId, registry, params);
    },
    update(timeSec) {
      pass.uniforms.uTime!.value = timeSec;
    },
    setResolution(width, height) {
      pass.setResolution(width, height);
    },
    setArc(darkness) {
      pass.uniforms.uDark!.value = clamp(darkness, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

export const undertowModule: VisualModule = {
  descriptor,
  create: createUndertow,
};
