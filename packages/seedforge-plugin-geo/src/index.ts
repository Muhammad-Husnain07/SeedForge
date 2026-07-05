import type { SeedForgePlugin, PRNG } from '@seedforge/core';
import { CITIES } from './data.js';
import type { CityRecord } from './data.js';

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lookupCity(
  params: Record<string, unknown>,
  _row: Record<string, unknown>,
  prng: PRNG,
): unknown {
  const country = params.country as string | undefined;
  const countryCode = params.countryCode as string | undefined;

  let pool: CityRecord[] = CITIES;

  if (country) {
    pool = CITIES.filter((c) => c.country === country);
  } else if (countryCode) {
    pool = CITIES.filter((c) => c.countryCode === countryCode.toUpperCase());
  }

  if (pool.length === 0) {
    // Fallback: return a random city from the full list
    const idx = Math.floor(prng.next() * CITIES.length);
    const fallback = CITIES[idx]!;
    return {
      city: fallback.city,
      region: fallback.region,
      country: fallback.country,
      countryCode: fallback.countryCode,
      latitude: fallback.latitude,
      longitude: fallback.longitude,
    };
  }

  const idx = Math.floor(prng.next() * pool.length);
  const city = pool[idx]!;
  return {
    city: city.city,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    latitude: city.latitude,
    longitude: city.longitude,
  };
}

const plugin: SeedForgePlugin = {
  name: '@seedforge/plugin-geo',
  version: '0.1.0',

  registerGenerators(registry) {
    const gen = Object.assign(
      (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG) => {
        return lookupCity(params, row, prng);
      },
      {
        compatibleTypes: ['string', 'float'],
        estimateDistinct: (_params: Record<string, unknown>, _count: number) => {
          const country = _params.country as string | undefined;
          const countryCode = _params.countryCode as string | undefined;
          if (country) return CITIES.filter((c) => c.country === country).length;
          if (countryCode) return CITIES.filter((c) => c.countryCode === countryCode.toUpperCase()).length;
          return CITIES.length;
        },
      },
    );

    registry.register('geo.city', gen);
  },
};

export default plugin;