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
  id: 'trench',
  label: 'Trench',
  techniqueFamily: 'raymarched volume',
  params: [
    { key: 'fog', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'flow', kind: 'unipolar', min: 0, max: 1, default: 0.35, group: 'field' },
    { key: 'depth', kind: 'unipolar', min: 0, max: 1, default: 0.4, group: 'field' },
    // route a slow LFO here: the walls breathe — ledges swell and recede
    { key: 'wall', kind: 'unipolar', min: 0, max: 1, default: 0.5, group: 'scene' },
    // route masterMeter.level here: the light from the surface plays and dies
    { key: 'shafts', kind: 'unipolar', min: 0, max: 1, default: 0.55, group: 'scene' },
    // which trench this is — a different canyon every seed
    { key: 'seed', kind: 'scalar', min: 0, max: 100, default: 29, group: 'scene' },
  ],
};

// Trench — the raymarched volume: the roster's first TRUE 3D space. A camera
// sinking without end between two canyon walls displaced by slow noise —
// ledges arrive out of the murk above, pass, and dissolve below. Light is a
// memory of the surface: shafts falling from a ceiling you can no longer
// see, scattered into the water and eaten by depth. Wall makes the rock
// breathe; depth narrows the canyon; flow is the rate of sinking. The arc
// finishes what physics started: the shafts die, the fog closes, and the
// walls become presences you feel more than see. Marched at half resolution
// into a private target (48 steps), then composited — phone-budget 3D.

const MARCH_SCALE = 0.5;

const marchFragment = /* glsl */ `
  precision highp float;
  ${glslCommon}
  uniform vec2 uResolution;
  uniform float uTime, uFog, uFlow, uDepth, uDark, uWall, uShafts, uSeed;
  varying vec2 vUv;

  // the canyon: two walls displaced by layered noise — ledges, buttresses, silt
  float map(vec3 p){
    float widthHalf = mix(1.5, 0.7, uDepth);
    float ledges = fbm3(p.yz * 0.35 + uSeed) - 0.5;
    float detail = fbm3(vec2(p.y * 1.7 + p.x, p.z * 1.7 - uSeed)) - 0.5;
    float d = widthHalf - abs(p.x)
            + ledges * 2.0 * uWall
            + detail * 0.40 * uWall;
    return d;
  }

  vec3 normalAt(vec3 p){
    vec2 e = vec2(0.04, 0.0);
    return normalize(vec3(
      map(p + e.xyy) - map(p - e.xyy),
      map(p + e.yxy) - map(p - e.yxy),
      map(p + e.yyx) - map(p - e.yyx)));
  }

  // light shafts falling from above, banded in x/z, eaten by darkness
  float shaftLight(vec3 p, float sink){
    float bands = 0.5 + 0.5 * sin(p.x * 1.6 + p.z * 0.7 + fbm3(vec2(p.z * 0.4, p.x * 0.4 + uSeed)) * 4.0);
    bands = 0.35 + 1.05 * pow(bands, 2.0);
    // the light is a standing memory of the surface — it dims with the arc,
    // not with the sink, or an endless descent would go black in a minute
    return bands * uShafts * (1.0 - 0.85 * uDark) * (0.9 + 0.1 * sin(sink * 0.2));
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 pc = (vUv - 0.5) * vec2(aspect, 1.0);

    // the sink: the camera falls for ever; the world is periodic in y via noise
    float sink = uTime * (0.25 + uFlow * 0.9);
    // ride nearer one wall, gazing across the canyon and slightly down — the
    // far wall gives distance, the near wall gives speed
    float sway = sin(uTime * 0.05 + uSeed) * 0.2;
    vec3 ro = vec3(-mix(0.9, 0.35, uDepth) + sway * 0.3, -sink, 0.0);
    vec3 rd = normalize(vec3(pc.x + 0.30, pc.y - 0.22, 1.0));

    // sphere-trace the walls
    float t = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 48; i++) {
      vec3 p = ro + rd * t;
      float d = map(p);
      if (d < 0.012 * t) { hit = t; break; }
      t += max(d * 0.75, 0.02);
      if (t > 26.0) break;
    }

    float density = mix(0.05, 0.16, uFog) + 0.08 * uDark;
    vec3 water = vec3(0.006, 0.012, 0.018) * (1.0 - 0.5 * uDark);
    vec3 col = water;

    // in-scatter: march a few fog samples along the ray, lit by the shafts
    float reach = (hit > 0.0) ? hit : 26.0;
    float scat = 0.0;
    for (int i = 0; i < 8; i++) {
      float ft = reach * (float(i) + 0.5) / 8.0;
      vec3 fp = ro + rd * ft;
      scat += shaftLight(fp, sink) * exp(-ft * density) * (reach / 8.0);
    }
    col += vec3(0.10, 0.22, 0.24) * scat * 0.30;

    if (hit > 0.0) {
      vec3 p = ro + rd * hit;
      vec3 n = normalAt(p);
      // rock lit by the falling light, wrapped so faces reading sideways
      // still catch some — legibility over strict physics in the murk
      float wrap = clamp(n.y * 0.5 + 0.75, 0.0, 1.0);
      float glance = pow(1.0 - abs(dot(n, rd)), 2.0);
      float lit = wrap * shaftLight(p, sink) + glance * 0.15;
      float silt = fbm3(p.zy * 3.1 + uSeed) * 0.5 + 0.5;
      vec3 rock = mix(vec3(0.045, 0.056, 0.062), vec3(0.13, 0.14, 0.13), silt);
      // flecks of settled bioluminescence catch on the ledges
      float flecks = step(0.985, hash(floor(p.zy * 22.0) + floor(uSeed)))
                   * clamp(n.y * 0.5 + 0.5, 0.0, 1.0) * (1.0 - 0.6 * uDark);
      vec3 wallCol = rock * (0.5 + 6.0 * lit)
                   + vec3(0.25, 0.50, 0.46) * flecks * 0.7;
      float visibility = exp(-hit * density);
      col = mix(col, wallCol, visibility);
    }

    col *= 1.35;                             // exposure — the murk must read
    col *= 1.0 - 0.35 * uDark;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const compositeFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  varying vec2 vUv;
  void main(){ gl_FragColor = texture2D(uScene, vUv); }
`;

/**
 * Raymarch at half resolution into a private target, then composite to the
 * writeBuffer — the march cost scales with the small target, the composer
 * contract stays intact, and the soft upscale suits the murk.
 */
class TrenchPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uFog: { value: 0.35 },
    uFlow: { value: 0.35 },
    uDepth: { value: 0.4 },
    uWall: { value: 0.5 },
    uShafts: { value: 0.55 },
    uSeed: { value: 29 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  private target: THREE.WebGLRenderTarget | null = null;

  private readonly marchMaterial = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: glslVertex,
    fragmentShader: marchFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly compositeMaterial = new THREE.ShaderMaterial({
    uniforms: { uScene: { value: null } },
    vertexShader: glslVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.marchMaterial);

  setResolution(width: number, height: number): void {
    (this.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
    const w = Math.max(2, Math.round(width * MARCH_SCALE));
    const h = Math.max(2, Math.round(height * MARCH_SCALE));
    if (this.target && this.target.width === w && this.target.height === h) return;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (!this.target) this.setResolution(2, 2);
    this.quad.material = this.marchMaterial;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);

    this.compositeMaterial.uniforms.uScene!.value = this.target!.texture;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.target?.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}

export function createTrench(): VisualLayer {
  const pass = new TrenchPass();

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

export const trenchModule: VisualModule = {
  descriptor,
  create: createTrench,
};
