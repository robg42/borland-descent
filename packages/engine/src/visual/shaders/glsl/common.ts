/**
 * Shared GLSL utility functions injected into fragment shaders.
 * Inject via template-literal interpolation: `${glslCommon} ...rest of shader`.
 *
 * Provides:
 *   hash(vec2)  → float      sin-hash, uniform [0,1]
 *   hash2(vec2) → vec2       two-component sin-hash
 *   noise(vec2) → float      bilinear value noise, smooth [0,1]
 *   fbm(vec2, int) → float   fractal Brownian motion (variable octaves)
 *   fbm3(vec2)  → float      3-octave shorthand (most common usage)
 *   fbm5(vec2)  → float      5-octave shorthand
 */
export const glslCommon = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  vec2  hash2(vec2 p){
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm3(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float fbm5(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/** Standard full-screen vertex shader — shared across all scene layers. */
export const glslVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
