import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { clamp } from '../core/curves';
import { makePortRef } from '../core/ports';
import type { SignalRegistry } from '../core/registry';
import type { Scalar } from '../patch/schema';
import type { VisualLayer } from './shaders/types';

/**
 * The visual-module contract (VISUAL-REBUILD V1). Every module exports a STATIC
 * descriptor of its parameters; the registry bindings, the studio panels, patch
 * validation and the routing-target list are all GENERATED from it. Adding a
 * module means one file exporting { descriptor, create } plus a registry line —
 * the control and audio plumbing are never touched (the rebuild's invariant).
 */

export interface ModuleParamSpec {
  /** Port name under the layer node (field.<key>) and the patch param key. */
  key: string;
  /** GLSL uniform; defaults to `u` + capitalised key (e.g. flow → uFlow). */
  uniform?: string;
  kind: 'unipolar' | 'bipolar' | 'scalar';
  min: number;
  max: number;
  default: number;
  /** Studio label; defaults to the key. */
  label?: string;
  /** Studio grouping (e.g. 'field', 'event', 'grade'). */
  group?: string;
}

export interface VisualModuleDescriptor {
  id: string;
  label: string;
  /** One of the roster's technique families — for docs and the studio picker. */
  techniqueFamily: string;
  params: ModuleParamSpec[];
  capabilities?: {
    /** Needs a ping-pong render target from the host pool (trails/feedback). */
    feedback?: boolean;
    /** Renders three.js Points/instanced geometry rather than a fullscreen quad. */
    points?: boolean;
  };
}

export interface VisualModule {
  descriptor: VisualModuleDescriptor;
  create: () => VisualLayer;
}

const uniformNameOf = (p: ModuleParamSpec): string =>
  p.uniform ?? 'u' + p.key.charAt(0).toUpperCase() + p.key.slice(1);

function numOr(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

/**
 * Build the initial uniform map for a descriptor-driven ShaderPass: every param
 * at its default, plus the host-supplied trio every layer carries.
 */
export function descriptorUniforms(
  descriptor: VisualModuleDescriptor,
  extra: Record<string, { value: unknown }> = {},
): Record<string, { value: unknown }> {
  const uniforms: Record<string, { value: unknown }> = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDark: { value: 0 },
    ...extra,
  };
  for (const p of descriptor.params) uniforms[uniformNameOf(p)] = { value: p.default };
  return uniforms;
}

/** Anything holding a uniform map — a ShaderPass, or a custom Pass (e.g. a
 *  feedback/ping-pong module) exposing the uniform objects its materials share. */
export interface UniformHost {
  uniforms: Record<string, { value: unknown }>;
}

/**
 * The generic binder: register every descriptor param as a modulatable input
 * port writing its uniform, seeded from the merged patch/scene params. Replaces
 * the per-module bind() boilerplate the seven scene shaders used to carry.
 */
export function bindDescriptorPorts(
  descriptor: VisualModuleDescriptor,
  pass: UniformHost,
  nodeId: string,
  registry: SignalRegistry,
  params: Record<string, Scalar>,
): void {
  for (const p of descriptor.params) {
    const u = pass.uniforms[uniformNameOf(p)];
    if (!u) continue; // a param the shader chose not to surface — skip, never throw
    const base = clamp(numOr(params[p.key], p.default), p.min, p.max);
    u.value = base;
    registry.addInput(makePortRef(nodeId, p.key), {
      kind: p.kind,
      base,
      min: p.min,
      max: p.max,
      write: (v) => {
        u.value = clamp(v, p.min, p.max);
      },
    });
  }
}

export type { Pass };
