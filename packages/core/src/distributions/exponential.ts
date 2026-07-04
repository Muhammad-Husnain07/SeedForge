import type { PRNG } from './prng.js';

export function exponential(prng: PRNG, rate: number): number {
  if (rate <= 0) throw new Error('exponential: rate must be positive');

  const u = prng.next();
  return -Math.log(1 - u || 1e-16) / rate;
}
