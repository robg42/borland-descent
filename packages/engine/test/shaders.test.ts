/// <reference types="node" />
/**
 * Static validation of every visual module's GLSL fragment shader.
 *
 * TypeScript cannot see inside the template literals, so a truncated or
 * half-refactored shader compiles fine and only fails at runtime when the
 * module is selected in the studio. That happened in the shared-GLSL-chunk
 * refactor (ae6bf60): akten/anadol/crespo lost their main() and hobbs lost
 * its local fbm/palette helpers while keeping the calls (repaired in d5631f6
 * and e1d7521). These checks make that class of breakage fail `npm test`.
 *
 * The shader sources are read straight from the module files with node fs
 * (this is a test, not engine code — the tone/three/zod-only rule applies to
 * src). Extraction relies on the repo convention that every fragment shader
 * is a `const <name>Fragment… = /* glsl *\/ \`…\`` literal whose only
 * interpolation is ${glslCommon}; anything else fails loudly below so the
 * convention cannot drift silently.
 *
 * This is a token-level pass, not a GLSL parser: good enough to catch a
 * missing main(), a call to a helper that no longer exists, or a reference
 * to an undeclared uniform. If a shader legitimately uses a built-in that is
 * not listed here, add it to GLSL_BUILTINS.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { glslCommon } from '../src/visual/shaders/glsl/common';

const SHADER_DIR = fileURLToPath(new URL('../src/visual/shaders', import.meta.url));

/** Every shader module file — index/types re-export, glsl/ holds the chunks. */
const MODULE_FILES = readdirSync(SHADER_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts')
  .sort();

/** `const somethingFragment / fragmentShader = /* glsl *\/ `…`;` — GLSL never
 *  contains a backtick, so the lazy body match is safe. */
const FRAGMENT_LITERAL = /const\s+(\w*[fF]ragment\w*)\s*=\s*\/\*\s*glsl\s*\*\/\s*`([^`]*)`/g;

interface ShaderSource {
  file: string;
  name: string;
  glsl: string;
}

function extractFragmentShaders(file: string): ShaderSource[] {
  const ts = readFileSync(join(SHADER_DIR, file), 'utf8');
  const shaders: ShaderSource[] = [];
  for (const m of ts.matchAll(FRAGMENT_LITERAL)) {
    const name = m[1]!;
    const glsl = m[2]!.replaceAll('${glslCommon}', glslCommon);
    const leftover = /\$\{[^}]*\}/.exec(glsl);
    if (leftover) {
      throw new Error(
        `${file} › ${name}: unresolved interpolation ${leftover[0]} — ` +
          `teach shaders.test.ts to substitute it before validating`,
      );
    }
    shaders.push({ file, name, glsl });
  }
  return shaders;
}

const stripComments = (glsl: string): string =>
  glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// GLSL ES built-ins (1.00 plus the ES3 ones we may adopt) — callable without
// being defined in the shader.
const GLSL_BUILTINS = new Set([
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp',
  'mix', 'step', 'smoothstep', 'round', 'trunc', 'modf', 'isnan', 'isinf',
  'length', 'distance', 'dot', 'cross', 'normalize',
  'faceforward', 'reflect', 'refract',
  'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
  'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
  'equal', 'notEqual', 'any', 'all', 'not',
  'texture2D', 'texture2DProj', 'texture2DLod', 'textureCube', 'textureCubeLod',
  'texture', 'textureLod', 'texelFetch',
  'dFdx', 'dFdy', 'fwidth',
]);

const TYPE_CONSTRUCTORS = new Set([
  'float', 'int', 'uint', 'bool',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
  'mat2', 'mat3', 'mat4',
]);

// keywords that can precede a `(` without being a call
const CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return']);

/** Names defined in the shader itself: functions and function-like macros. */
function definedFunctions(glsl: string): Set<string> {
  const defined = new Set<string>();
  for (const m of glsl.matchAll(/\b(?:void|float|int|uint|bool|[ibu]?vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g)) {
    defined.add(m[1]!);
  }
  for (const m of glsl.matchAll(/#define\s+([A-Za-z_]\w*)\s*\(/g)) {
    defined.add(m[1]!);
  }
  return defined;
}

/** Uniform names declared anywhere in the shader (comma lists, arrays). */
function declaredUniforms(glsl: string): Set<string> {
  const declared = new Set<string>();
  for (const m of glsl.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([^;]+);/g)) {
    for (const piece of m[1]!.split(',')) {
      const name = piece.replace(/\[[^\]]*\]/g, '').trim();
      if (name) declared.add(name);
    }
  }
  return declared;
}

describe('visual module fragment shaders (static GLSL validation)', () => {
  it('finds the shader modules on disk', () => {
    expect(MODULE_FILES.length).toBeGreaterThan(0);
  });

  for (const file of MODULE_FILES) {
    const shaders = extractFragmentShaders(file);

    describe(file, () => {
      // A module whose fragment literal stops matching the convention would
      // otherwise silently drop out of every check below.
      it('contains at least one /* glsl */ fragment shader literal', () => {
        expect(shaders.length).toBeGreaterThan(0);
      });

      for (const { name, glsl } of shaders) {
        const body = stripComments(glsl);

        it(`${name}: has exactly one void main() and writes gl_FragColor`, () => {
          const mains = body.match(/\bvoid\s+main\s*\(/g) ?? [];
          expect(mains, 'expected exactly one "void main" — a truncated shader has none').toHaveLength(1);
          expect(body).toMatch(/\bgl_FragColor\s*=/);
        });

        it(`${name}: every called function is defined, a glslCommon helper, or a built-in`, () => {
          const defined = definedFunctions(body);
          const unknown = new Set<string>();
          for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
            const called = m[1]!;
            if (
              !defined.has(called) &&
              !GLSL_BUILTINS.has(called) &&
              !TYPE_CONSTRUCTORS.has(called) &&
              !CALL_KEYWORDS.has(called)
            ) {
              unknown.add(called);
            }
          }
          expect(
            [...unknown],
            'called but never defined — a stripped local helper, or a missing ${glslCommon}',
          ).toEqual([]);
        });

        it(`${name}: every uniform referenced is declared`, () => {
          const declared = declaredUniforms(body);
          const undeclared = new Set<string>();
          // repo convention: uniforms are uCamelCase — nothing else uses that shape
          for (const m of body.matchAll(/\bu[A-Z]\w*\b/g)) {
            if (!declared.has(m[0])) undeclared.add(m[0]);
          }
          expect([...undeclared], 'referenced but not declared as a uniform').toEqual([]);
        });
      }
    });
  }
});
