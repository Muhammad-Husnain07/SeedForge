import type { PRNG } from './prng.js';

export function zipf(prng: PRNG, n: number, s: number): number {
  if (s <= 0) throw new Error('zipf: s must be positive');
  if (n < 1) throw new Error('zipf: n must be >= 1');

  const partialSums = new Float64Array(n);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += 1 / (i ** s);
    partialSums[i - 1] = total;
  }

  const roll = prng.next() * total;

  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (partialSums[mid]! < roll) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo + 1;
}
