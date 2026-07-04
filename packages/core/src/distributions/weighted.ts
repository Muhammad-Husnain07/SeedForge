import type { PRNG } from './prng.js';

export function weightedCategorical(
  prng: PRNG,
  weights: Record<string, number>,
): string {
  const keys = Object.keys(weights);
  if (keys.length === 0) {
    throw new Error('weightedCategorical: empty weights');
  }

  const total = keys.reduce((sum, k) => sum + weights[k]!, 0);
  if (total <= 0) {
    throw new Error('weightedCategorical: total weight must be positive');
  }

  let cumulative = 0;
  const cdf: { key: string; threshold: number }[] = [];
  for (const key of keys) {
    cumulative += (weights[key] ?? 0) / total;
    cdf.push({ key, threshold: cumulative });
  }

  const roll = prng.next();
  for (const entry of cdf) {
    if (roll < entry.threshold) return entry.key;
  }

  return keys[keys.length - 1]!;
}
