import { describe, it, expect, vi } from 'vitest';
import { registerGenerator, getGenerator, generatorRegistry } from './registry.js';
import { loadPlugins, callPluginHook } from './loader.js';
import type { SeedForgePlugin, FieldGenerator } from './types.js';

describe('generatorRegistry', () => {
  it('register and get a plugin generator', () => {
    const gen: FieldGenerator = () => 'test-value';
    gen.compatibleTypes = ['string'];

    registerGenerator('test-kind', gen);

    expect(generatorRegistry.has('test-kind')).toBe(true);
    expect(getGenerator('test-kind')).toBe(gen);
    expect(generatorRegistry.knownKinds()).toContain('test-kind');
  });

  it('returns undefined for unknown kind', () => {
    expect(getGenerator('nonexistent')).toBeUndefined();
  });

  it('lists all known kinds', () => {
    const before = generatorRegistry.knownKinds().length;
    registerGenerator('test-kind-2', () => 'v');
    expect(generatorRegistry.knownKinds().length).toBe(before + 1);
  });
});

describe('loadPlugins', () => {
  it('returns empty result for no plugins', async () => {
    const result = await loadPlugins(undefined);
    expect(result.plugins).toEqual([]);
    expect(result.hookGeneratorsRegistered).toBe(false);
  });

  it('returns empty result for empty array', async () => {
    const result = await loadPlugins([]);
    expect(result.plugins).toEqual([]);
  });

  it('throws clear error for non-existent plugin package', async () => {
    await expect(loadPlugins(['non-existent-plugin-package-xyz'])).rejects.toThrow(
      /Failed to load plugin/,
    );
  });
});

describe('callPluginHook', () => {
  it('calls hook on all plugins in order', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const p1: SeedForgePlugin = { name: 'p1', beforeGenerate: fn1 };
    const p2: SeedForgePlugin = { name: 'p2', beforeGenerate: fn2 };

    const plan = {} as Record<string, unknown>;
    callPluginHook([{ plugin: p1, source: 'p1' }, { plugin: p2, source: 'p2' }], 'beforeGenerate', plan);

    expect(fn1).toHaveBeenCalledWith(plan);
    expect(fn2).toHaveBeenCalledWith(plan);
  });

  it('handles missing hooks gracefully', () => {
    const p: SeedForgePlugin = { name: 'test' };
    expect(() =>
      callPluginHook([{ plugin: p, source: 'test' }], 'beforeGenerate', {}),
    ).not.toThrow();
  });
});

describe('FieldGenerator metadata', () => {
  it('supports compatibleTypes and estimateDistinct metadata', () => {
    const gen: FieldGenerator = () => 'v';
    gen.compatibleTypes = ['string', 'integer'];
    gen.estimateDistinct = (_params, _count) => 100;

    registerGenerator('meta-test', gen);
    const retrieved = getGenerator('meta-test')!;
    expect(retrieved.compatibleTypes).toEqual(['string', 'integer']);
    expect(retrieved.estimateDistinct!({}, 0)).toBe(100);
  });
});