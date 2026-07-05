import type { FieldGenerator, GeneratorRegistry } from './types.js';

const _generators = new Map<string, FieldGenerator>();

export const generatorRegistry: GeneratorRegistry = {
  register(kind: string, generator: FieldGenerator): void {
    _generators.set(kind, generator);
  },

  get(kind: string): FieldGenerator | undefined {
    return _generators.get(kind);
  },

  has(kind: string): boolean {
    return _generators.has(kind);
  },

  knownKinds(): string[] {
    return [..._generators.keys()];
  },
};

export function registerGenerator(kind: string, generator: FieldGenerator): void {
  generatorRegistry.register(kind, generator);
}

export function getGenerator(kind: string): FieldGenerator | undefined {
  return generatorRegistry.get(kind);
}