import { describe, it, expect } from 'vitest';
import plugin from './index.js';
import type { GeneratorRegistry, PRNG } from '@seed-forge/core';

const mockPrng: PRNG = {
  next() { return 0.5; },
  nextInt() { return 42; },
};

function createMockRegistry(): GeneratorRegistry {
  const map = new Map<string, unknown>();
  return {
    register(kind: string, gen: unknown) { map.set(kind, gen); },
    get(kind: string) { return map.get(kind); },
    has(kind: string) { return map.has(kind); },
    knownKinds() { return [...map.keys()]; },
  };
}

describe('@seed-forge/plugin-geo', () => {
  it('has the correct plugin name', () => {
    expect(plugin.name).toBe('@seed-forge/plugin-geo');
    expect(plugin.version).toBe('0.1.0');
  });

  it('registers the geo.city generator', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);

    expect(registry.has('geo.city')).toBe(true);
  });

  it('produces internally-consistent city tuples', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);

    const gen = registry.get('geo.city') as (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG) => unknown;
    const result = gen({}, {}, mockPrng) as Record<string, unknown>;

    expect(result).toHaveProperty('city');
    expect(result).toHaveProperty('region');
    expect(result).toHaveProperty('country');
    expect(result).toHaveProperty('countryCode');
    expect(result).toHaveProperty('latitude');
    expect(result).toHaveProperty('longitude');

    // Verify consistency: lat and lng are numbers in valid ranges
    expect(typeof result.latitude).toBe('number');
    expect(typeof result.longitude).toBe('number');
    expect(result.latitude as number).toBeGreaterThanOrEqual(-90);
    expect(result.latitude as number).toBeLessThanOrEqual(90);
    expect(result.longitude as number).toBeGreaterThanOrEqual(-180);
    expect(result.longitude as number).toBeLessThanOrEqual(180);

    // City and country are non-empty strings
    expect((result.city as string).length).toBeGreaterThan(0);
    expect((result.country as string).length).toBeGreaterThan(0);
  });

  it('filters by country when specified', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);

    const gen = registry.get('geo.city') as (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG) => unknown;

    // Run several times to verify all results are from Japan
    for (let i = 0; i < 10; i++) {
      const result = gen({ country: 'Japan', countryCode: 'JP' }, {}, mockPrng) as Record<string, unknown>;
      expect(result.country).toBe('Japan');
    }
  });

  it('returns same city for same seed', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);
    const gen = registry.get('geo.city') as (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG) => unknown;

    // Same seed with same prng state should give same city
    const result1 = gen({}, {}, { next: () => 0.123, nextInt: () => 1 });
    const result2 = gen({}, {}, { next: () => 0.123, nextInt: () => 1 });
    expect(result1).toEqual(result2);
  });

  it('declares compatible types as string and float', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);
    const gen = registry.get('geo.city') as { compatibleTypes?: string[] };

    expect(gen.compatibleTypes).toContain('string');
    expect(gen.compatibleTypes).toContain('float');
  });

  it('estimateDistinct returns number of cities', () => {
    const registry = createMockRegistry();
    plugin.registerGenerators!(registry);
    const gen = registry.get('geo.city') as { estimateDistinct?: (params: Record<string, unknown>, count: number) => number | null };

    const est = gen.estimateDistinct!({}, 100);
    expect(est).toBeGreaterThan(0);
    expect(typeof est).toBe('number');
  });
});