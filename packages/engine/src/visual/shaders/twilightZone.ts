import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import type { VisualLayer } from './types';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Last Light (mesopelagic): a single pale violet cone fails from top-centre — the
// last surface light the descent will ever see — revealed mostly by the marine
// snow that flares as it falls through it, like dust in a projector beam. Three
// grid-hash snow planes give a depth-of-field eye (soft bokeh near, crisp mid,
// dim dust far), and one vast soft silhouette crosses the lower frame over a
// minute or so, kept ghost-faint by construction. No fbm wash — its budget pays
// for the cone and the beast. Violet/heliotrope throughout; the green channel
// stays lowest everywhere so the scene never drifts toward teal.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uFog, uFlow, uDepth, uDark;
  uniform float uLume, uPresence;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // analytic volumetric wedge hung from an apex just off-screen above top-centre:
  // angular falloff x gaussian length attenuation x one octave of shimmer in the
  // angle/length domain (light through a moving surface far overhead, ~10 s period).
  // The arc retracts its reach so the beam visibly abandons the lower frame.
  float cone(vec2 p, float aspect, float t, float dark){
    vec2 d = p - vec2(0.5 * aspect, 1.30);
    float len = length(d);
    float ang = atan(d.x, -d.y);                  // 0 = straight down
    float halfA = 0.16 + 0.05 * uFog;             // fog widens the scatter
    float edge  = 1.0 - smoothstep(halfA * 0.25, halfA, abs(ang));
    float reach = mix(1.45, 0.85, dark);          // the dying of the light
    float fall  = exp(-(len * len) / (reach * reach));
    float ray   = 0.75 + 0.25 * noise(vec2(ang * 22.0, len * 2.0 - t * 0.35));
    return edge * fall * ray;
  }

  // one depth-of-field snow plane: cell scale = density, blur = disc softness,
  // spd = fall rate. The early return is coherent per grid cell, so it is cheap.
  float snow(vec2 p, float t, float scale, float blur, float spd, float seed){
    vec2 g = p * scale;
    g.y += t * spd;                               // motes sink
    g.x += sin(t * 0.22 + seed) * 0.35;           // slow lateral drift
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash(id + seed);
    if (h < 0.62) return 0.0;                     // sparse — most cells empty
    vec2  c = vec2(0.2 + 0.6 * hash(id + seed + 3.1), 0.2 + 0.6 * h);
    float r = mix(0.05, 0.16, h);
    return (1.0 - smoothstep(r * 0.5, r + blur, length(f - c))) * (0.25 + 0.75 * h);
  }

  // soft 3-ellipse smooth-min silhouette; the wide edge is the distance blur.
  // Head-right is baked in — there is only ever the one creature.
  float beast(vec2 p, vec2 pos, float s){
    vec2 q = (p - pos) / s;
    float body = length(q * vec2(1.0, 2.6)) - 0.55;
    float tail = length((q - vec2(-0.85, 0.07)) * vec2(1.3, 3.4)) - 0.30;
    float fin  = length((q - vec2( 0.15,-0.38)) * vec2(2.6, 1.5)) - 0.18;
    float k = 0.25, h1 = clamp(0.5 + 0.5 * (tail - body) / k, 0.0, 1.0);
    float d = mix(tail, body, h1) - k * h1 * (1.0 - h1);
    float h2 = clamp(0.5 + 0.5 * (fin - d) / k, 0.0, 1.0);
    d = mix(fin, d, h2) - k * h2 * (1.0 - h2);
    return 1.0 - smoothstep(-0.02, 0.10, d);
  }

  void main(){
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2  p = vec2(vUv.x * aspect, vUv.y);
    float t = uTime * (0.5 + uFlow);

    // indigo water column — violet-grey up top, near-void below; depth hauls the
    // black floor upward, compressing the lit zone toward the top of the frame
    vec3 col = mix(vec3(0.135, 0.118, 0.220), vec3(0.016, 0.012, 0.045),
                   smoothstep(0.05, 0.95, (1.0 - vUv.y) * (0.8 + 0.5 * uDepth)));
    col += uFog * 0.10 * vec3(0.30, 0.26, 0.42);  // ambient violet scatter

    // the lone silhouette crosses the lower-left over ~80 s; the phase constant
    // (+0.42) places it in frame at t = 0, head-right, for the still composition.
    // Ghost-faint by construction: presence is biased low near the scene's
    // entry/exit window (the abyssal scene owns vast presence) and the shading
    // is capped so even presence = 1 stays barely darker than the field.
    float ts = uTime * 0.012 * (0.5 + uFlow);
    float bm = beast(p, vec2(fract(ts + 0.42) * (aspect + 1.2) - 0.6,
                             0.38 + 0.06 * sin(uTime * 0.05)), 0.46);
    float window = smoothstep(0.50, 0.55, uDark) * (1.0 - smoothstep(0.58, 0.63, uDark));
    float occl = bm * uPresence * (1.0 - uFog * 0.5) * mix(0.55, 1.0, window);
    col *= 1.0 - 0.20 * occl;                     // at most ~20% darker — an absence

    // the dying cone — gated and shortened by the arc, breathing with uLume;
    // by handover it is a guttering stub at the very top of the frame
    float gate = 1.0 - smoothstep(0.30, 0.95, uDark);
    float cn = cone(p, aspect, t, uDark) * uLume * gate;
    col += cn * vec3(0.55, 0.49, 0.78) * 0.55;    // heliotrope scatter (#8C7DC7)

    // three snow planes; far dust thins behind the beast (it reads as an absence);
    // every mote flares inside the cone — the beam is rendered by what it catches
    float farD  = snow(p, t, 60.0, 0.010, 0.55, 27.0) * 0.35 * (1.0 - occl);
    float midD  = snow(p, t, 26.0, 0.015, 0.95, 13.0) * 0.85;  // the in-focus plane
    float nearD = snow(p, t,  9.0, 0.120, 1.60,  1.0) * 0.45;  // soft bokeh discs
    col += (farD + midD + nearD) * (1.0 + cn * 3.0) * vec3(0.79, 0.74, 0.93);

    // the scene's own grade: arc floor, then a vignette anchored just above
    // centre so the beam's heart holds the thumbnail
    col *= mix(1.0, 0.40, uDark * uDark);
    col *= mix(0.70, 1.0, 1.0 - smoothstep(0.15, 1.25, length(vUv - vec2(0.5, 0.55))));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createTwilightZone(): VisualLayer {
  const pass = new ShaderPass({
    name: 'twilightZone',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFog: { value: 0.45 },
      uFlow: { value: 0.3 },
      uDepth: { value: 0.5 },
      uDark: { value: 0.5 },
      uLume: { value: 0.55 },
      uPresence: { value: 0.35 },
    },
    vertexShader,
    fragmentShader,
  });

  const uniform = (name: string): THREE.IUniform => pass.uniforms[name]!;

  function bind(registry: SignalRegistry, nodeId: string, port: string, name: string, base: number): void {
    const u = uniform(name);
    u.value = base;
    registry.addInput(makePortRef(nodeId, port), {
      kind: 'unipolar',
      base,
      min: 0,
      max: 1,
      write: (v) => {
        u.value = clamp(v, 0, 1);
      },
    });
  }

  return {
    pass,
    registerPorts(nodeId, registry, params) {
      bind(registry, nodeId, 'fog', 'uFog', num(params.fog, 0.45));
      bind(registry, nodeId, 'flow', 'uFlow', num(params.flow, 0.3));
      bind(registry, nodeId, 'depth', 'uDepth', num(params.depth, 0.5));
      bind(registry, nodeId, 'lume', 'uLume', num(params.lume, 0.55));
      bind(registry, nodeId, 'presence', 'uPresence', num(params.presence, 0.35));
    },
    update(timeSec) {
      uniform('uTime').value = timeSec;
    },
    setResolution(width, height) {
      (uniform('uResolution').value as THREE.Vector2).set(width, height);
    },
    // The arc is structural here, not a brightness dial: uDark retracts the
    // cone's gaussian reach (mix(1.45, 0.85, dark)), closes the master gate on
    // the beam and its snow-flare, deepens the gradient floor toward true void,
    // and shapes the presence window so the silhouette surfaces mid-residency
    // and submerges again before the handover to the abyss.
    setArc(darkness) {
      uniform('uDark').value = clamp(darkness, 0, 1);
    },
    dispose() {
      pass.dispose();
    },
  };
}

function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
