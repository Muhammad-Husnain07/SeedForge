import type { PRNG } from './prng.js';

export function paretoInt(
  prng: PRNG,
  min: number,
  max: number,
  alpha: number,
): number {
  if (alpha <= 0) throw new Error('paretoInt: alpha must be positive');
  if (min > max) throw new Error('paretoInt: min must be <= max');
  if (min === max) return min;

  const u = prng.next();
  const scaleFactor = 1 - Math.pow(min / max, alpha);
  const x = min * Math.pow(1 - u * scaleFactor, -1 / alpha);
  const rounded = Math.round(x);
  return Math.max(min, Math.min(max, rounded));
}
