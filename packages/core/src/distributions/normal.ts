import type { PRNG } from './prng.js';

export function normal(prng: PRNG, mean: number, stddev: number): number {
  if (stddev < 0) throw new Error('normal: stddev must be non-negative');
  if (stddev === 0) return mean;

  const u1 = prng.next();
  const u2 = prng.next();

  const r = Math.sqrt(-2 * Math.log(u1 || 1e-16));
  const theta = 2 * Math.PI * u2;

  return r * Math.cos(theta) * stddev + mean;
}
