import * as THREE from 'three';

export interface VisualEngineOptions {
  container: HTMLElement;
  reducedMotion?: boolean;
}

/**
 * Phase 0: mounts a Three.js WebGL renderer with a black scene and renders from an
 * EXTERNAL rAF loop (the engine drives it with shared transport time — no
 * setAnimationLoop). DPR is capped and context-loss handlers are wired from the
 * start (mobile reality). The layered shader compositor + EffectComposer post
 * chain arrive in Phase 1.
 */
export class VisualEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly container: HTMLElement;
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
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'low-power',
      alpha: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.container.appendChild(canvas);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  /** Called each frame by the engine with shared transport time. */
  render(_timeSeconds: number, _dt: number): void {
    if (this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.traverse((obj) => {
      const mesh = obj as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
    canvas.parentNode?.removeChild(canvas);
  }
}
