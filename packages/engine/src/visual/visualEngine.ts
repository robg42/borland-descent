import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp } from '../core/curves';
import { macrosAt } from '../core/arc';
import { makePortRef } from '../core/ports';
import type { SignalRegistry } from '../core/registry';
import type { Patch, Scene, Scalar } from '../patch/schema';
import { createLayer, type VisualLayer } from './shaders';

export interface VisualEngineOptions {
  patch: Patch;
  scene: Scene;
  registry: SignalRegistry;
  container: HTMLElement;
  reducedMotion?: boolean;
}

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

/**
 * Layered compositor on Three.js. Phase 1: one generative full-screen shader layer
 * → bloom → grain → output, driven by an EXTERNAL rAF loop (the engine passes shared
 * transport time). DPR is capped; context-loss is handled. Layer uniforms, bloom
 * strength and grain amount are all registered as modulatable ports.
 */
export class VisualEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly container: HTMLElement;
  private readonly patch: Patch;
  private readonly layer: VisualLayer;
  private readonly bloom: UnrealBloomPass;
  private readonly grain: ShaderPass;
  private readonly resizeObserver: ResizeObserver;
  private contextLost = false;
  readonly reducedMotion: boolean;

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
  };

  constructor(opts: VisualEngineOptions) {
    this.container = opts.container;
    this.patch = opts.patch;
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x04070a, 1);
    this.renderer.setPixelRatio(dpr);

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.container.appendChild(canvas);

    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);

    // 1. the scene's generative shader layer
    const layerNode = opts.patch.visualGraph.layers[0];
    const moduleId = layerNode?.moduleId ?? opts.scene.shaderModuleId;
    this.layer = createLayer(moduleId);
    this.composer.addPass(this.layer.pass);
    this.layer.registerPorts(layerNode?.id ?? 'field', opts.registry, layerNode?.params ?? {});
    this.layer.setResolution(w, h);

    // 2. bloom
    const bloomNode = findNode(opts.patch.visualGraph.postChain, 'bloom');
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      num(bloomNode, 'strength', 0.8),
      num(bloomNode, 'radius', 0.4),
      num(bloomNode, 'threshold', 0.85),
    );
    this.composer.addPass(this.bloom);
    opts.registry.addInput(makePortRef('bloom', 'strength'), {
      kind: 'unipolar',
      base: this.bloom.strength,
      min: 0,
      max: 3,
      write: (v) => {
        this.bloom.strength = clamp(v, 0, 3);
      },
    });

    // 3. grain (custom pass — avoids FilmPass scanlines, fully controllable)
    const grainNode = findNode(opts.patch.visualGraph.postChain, 'grain');
    this.grain = new ShaderPass(grainShader);
    this.grain.uniforms.uAmount!.value = num(grainNode, 'intensity', 0.05);
    this.composer.addPass(this.grain);
    opts.registry.addInput(makePortRef('grain', 'intensity'), {
      kind: 'unipolar',
      base: this.grain.uniforms.uAmount!.value as number,
      min: 0,
      max: 0.6,
      write: (v) => {
        this.grain.uniforms.uAmount!.value = clamp(v, 0, 0.6);
      },
    });

    // 4. output (tone-mapping + colour space — always last)
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  private size(): { w: number; h: number } {
    return {
      w: this.container.clientWidth || window.innerWidth,
      h: this.container.clientHeight || window.innerHeight,
    };
  }

  resize(): void {
    const { w, h } = this.size();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.layer.setResolution(w, h);
  }

  /** Apply arc macros to the visual feel (brief §6: surface luminous, centre dark). */
  applyArc(position: number): void {
    this.layer.setArc(macrosAt(this.patch.dna.arc, position).darkness);
  }

  render(timeSeconds: number, deltaSeconds: number): void {
    if (this.contextLost) return;
    this.layer.update(timeSeconds);
    this.grain.uniforms.uTime!.value = timeSeconds;
    this.composer.render(deltaSeconds);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.layer.dispose();
    this.bloom.dispose();
    this.grain.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.parentNode?.removeChild(canvas);
  }
}

function findNode(
  nodes: { id: string; params: Record<string, Scalar> }[],
  id: string,
): Record<string, Scalar> | undefined {
  return nodes.find((n) => n.id === id)?.params;
}
function num(params: Record<string, Scalar> | undefined, key: string, fallback: number): number {
  const v = params?.[key];
  return typeof v === 'number' ? v : fallback;
}
