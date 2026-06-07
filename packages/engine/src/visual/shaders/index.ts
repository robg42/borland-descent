import { createOceanicField } from './oceanicField';
import type { VisualLayer, VisualLayerFactory } from './types';

/** Registry of visual layer modules by id. Scenes select their world by these keys. */
const FACTORIES: Record<string, VisualLayerFactory> = {
  oceanicField: createOceanicField,
};

export function createLayer(moduleId: string): VisualLayer {
  const factory = FACTORIES[moduleId] ?? createOceanicField;
  return factory();
}

export type { VisualLayer, VisualLayerFactory } from './types';
