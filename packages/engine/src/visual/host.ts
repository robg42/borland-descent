import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, lerp } from '../core/curves';
import { makePortRef } from '../core/ports';
import type { SignalRegistry } from '../core/registry';
import type { Scalar } from '../patch/schema';
import { createLayer, type VisualLayer } from './shaders';

/**
 * The single shared renderer host (VISUAL-REBUILD V1, closes REVIEW H3). ONE
 * WebGLRenderer + ONE EffectComposer for the whole engine; a scene contributes
 * its layer module rather than a whole pipeline. A crossfade renders the
 * outgoing and incoming layers into two pooled render targets and mixes them in
 * a blend pass — one bloom, one grain, one output, regardless of scene count —
 * instead of two stacked canvases at double cost. Per-scene post grades
 * (bloom strength/radius/threshold, grain) lerp across the fade.
 */

const grainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0.25 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uTime; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float g = rnd(vUv + fract(uTime)) * 2.0 - 1.0;
      // scale grain by luminance so blacks stay clean (film-like, not TV static)
      gl_FragColor = vec4(c.rgb + g * uAmount * (0.15 + luma), c.a);
    }
  `,
};

const blendShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, // unused; composer contract
    tA: { value: null as THREE.Texture | null },
    tB: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
  },
  vertexShader: grainShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA; uniform sampler2D tB; uniform float uMix; varying vec2 vUv;
    void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uMix); }
  `,
};

/** A scene's post grade — defaults come from the global postChain nodes. */
export interface PostGrade {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  grainIntensity: number;
}

export interface MountArgs {
  /** Module id (scene.shaderModuleId). */
  moduleId: string;
  /** The stable layer node id the matrix routes against (usually 'field'). */
  nodeId: string;
  /** The registry this scene's ports register into. */
  registry: SignalRegistry;
  /** Global layer-node params merged under scene.visualParams. */
  params: Record<string, Scalar>;
  grade: PostGrade;
}

interface Slot {
  layer: VisualLayer;
  grade: PostGrade;
}

export interface VisualHostOptions {
  container: HTMLElement;
  reducedMotion?: boolean;
}

export class VisualHost {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly container: HTMLElement;
  private readonly bloom: UnrealBloomPass;
  private readonly grain: ShaderPass;
  private readonly blend: ShaderPass;
  private readonly output: OutputPass;
  private readonly resizeObserver: ResizeObserver;
  private rtA: THREE.WebGLRenderTarget | null = null;
  private rtB: THREE.WebGLRenderTarget | null = null;
  private active: Slot | null = null;
  private incoming: Slot | null = null;
  private fadeMix = 0;
  private contextLost = false;
  readonly reducedMotion: boolean;

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
  };

  constructor(opts: VisualHostOptions) {
    this.container = opts.container;
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x04070a, 1);
    this.renderer.setPixelRatio(this.dpr());

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (typeof getComputedStyle !== 'undefined' && getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.container.appendChild(canvas);

    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.dpr());
    this.composer.setSize(w, h);

    this.blend = new ShaderPass(blendShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.85);
    this.grain = new ShaderPass(grainShader);
    this.output = new OutputPass();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  private dpr(): number {
    return Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2);
  }

  private size(): { w: number; h: number } {
    return {
      w: this.container.clientWidth || window.innerWidth,
      h: this.container.clientHeight || window.innerHeight,
    };
  }

  /** Mount the ACTIVE scene's layer (initial mount or after a completed fade). */
  mountActive(args: MountArgs): void {
    this.active?.layer.dispose();
    this.active = this.makeSlot(args);
    this.applyGrade(this.active.grade);
    this.setChainSteady();
  }

  /** Mount the INCOMING scene's layer for a crossfade (renders at uMix 0). */
  mountIncoming(args: MountArgs): void {
    this.incoming?.layer.dispose();
    this.incoming = this.makeSlot(args);
    this.fadeMix = 0;
    this.ensureTargets();
    this.setChainFade();
  }

  private makeSlot(args: MountArgs): Slot {
    const layer = createLayer(args.moduleId);
    const { w, h } = this.size();
    layer.setResolution(w, h);
    layer.registerPorts(args.nodeId, args.registry, args.params);
    this.registerGradePorts(args.registry, args.grade);
    return { layer, grade: args.grade };
  }

  /** bloom.strength / grain.intensity stay addressable ports per scene registry. */
  private registerGradePorts(registry: SignalRegistry, grade: PostGrade): void {
    registry.addInput(makePortRef('bloom', 'strength'), {
      kind: 'unipolar',
      base: grade.bloomStrength,
      min: 0,
      max: 3,
      write: (v) => {
        this.bloom.strength = clamp(v, 0, 3);
      },
    });
    registry.addInput(makePortRef('grain', 'intensity'), {
      kind: 'unipolar',
      base: grade.grainIntensity,
      min: 0,
      max: 0.6,
      write: (v) => {
        this.grain.uniforms.uAmount!.value = clamp(v, 0, 0.6);
      },
    });
  }

  /** Advance the crossfade (0..1): blend uniform + lerped post grade. */
  setFadeMix(t: number): void {
    if (!this.incoming || !this.active) return;
    this.fadeMix = clamp(t, 0, 1);
    this.blend.uniforms.uMix!.value = this.fadeMix;
    const a = this.active.grade;
    const b = this.incoming.grade;
    this.bloom.strength = lerp(a.bloomStrength, b.bloomStrength, this.fadeMix);
    this.bloom.radius = lerp(a.bloomRadius, b.bloomRadius, this.fadeMix);
    this.bloom.threshold = lerp(a.bloomThreshold, b.bloomThreshold, this.fadeMix);
    this.grain.uniforms.uAmount!.value = lerp(a.grainIntensity, b.grainIntensity, this.fadeMix);
  }

  /** Hand over: the incoming layer becomes active; the outgoing is disposed. */
  completeFade(): void {
    if (!this.incoming) return;
    this.active?.layer.dispose();
    this.active = this.incoming;
    this.incoming = null;
    this.applyGrade(this.active.grade);
    this.setChainSteady();
  }

  /** Abandon an in-flight fade — keep the outgoing scene. */
  abortFade(): void {
    this.incoming?.layer.dispose();
    this.incoming = null;
    if (this.active) this.applyGrade(this.active.grade);
    this.setChainSteady();
  }

  private applyGrade(g: PostGrade): void {
    this.bloom.strength = g.bloomStrength;
    this.bloom.radius = g.bloomRadius;
    this.bloom.threshold = g.bloomThreshold;
    this.grain.uniforms.uAmount!.value = g.grainIntensity;
  }

  private setChainSteady(): void {
    this.composer.passes.length = 0;
    if (this.active) this.composer.addPass(this.active.layer.pass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grain);
    this.composer.addPass(this.output);
  }

  private setChainFade(): void {
    this.composer.passes.length = 0;
    this.composer.addPass(this.blend);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grain);
    this.composer.addPass(this.output);
  }

  private ensureTargets(): void {
    if (this.rtA) return;
    const { w, h } = this.size();
    const dpr = this.dpr();
    const opts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(w * dpr, h * dpr, opts);
    this.rtB = new THREE.WebGLRenderTarget(w * dpr, h * dpr, opts);
  }

  /** Apply the arc's darkness to whichever layers are live. */
  setArc(darkness: number): void {
    this.active?.layer.setArc(darkness);
    this.incoming?.layer.setArc(darkness);
  }

  render(timeSeconds: number, deltaSeconds: number): void {
    if (this.contextLost || !this.active) return;
    this.active.layer.update(timeSeconds);
    if (this.incoming && this.rtA && this.rtB) {
      // Fade: each layer renders once into its pooled target, the blend pass
      // mixes them, and the single post chain grades the result.
      this.incoming.layer.update(timeSeconds);
      this.active.layer.pass.renderToScreen = false;
      this.incoming.layer.pass.renderToScreen = false;
      this.active.layer.pass.render(this.renderer, this.rtA, this.rtA, deltaSeconds, false);
      this.incoming.layer.pass.render(this.renderer, this.rtB, this.rtB, deltaSeconds, false);
      this.blend.uniforms.tA!.value = this.rtA.texture;
      this.blend.uniforms.tB!.value = this.rtB.texture;
    }
    this.composer.render(deltaSeconds);
  }

  resize(): void {
    const { w, h } = this.size();
    const dpr = this.dpr(); // re-read: zoom/display moves change it (REVIEW M6)
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.rtA?.setSize(w * dpr, h * dpr);
    this.rtB?.setSize(w * dpr, h * dpr);
    this.active?.layer.setResolution(w, h);
    this.incoming?.layer.setResolution(w, h);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.active?.layer.dispose();
    this.incoming?.layer.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.blend.dispose();
    this.bloom.dispose();
    this.grain.dispose();
    this.output.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.parentNode?.removeChild(canvas);
  }
}
