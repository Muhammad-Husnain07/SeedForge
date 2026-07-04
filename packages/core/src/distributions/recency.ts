import type { PRNG } from './prng.js';

export function recencyWeighted(
  prng: PRNG,
  withinDays: number,
  skew: 'recent' | 'uniform' | 'old',
): Date {
  let fraction: number;

  switch (skew) {
    case 'recent':
      fraction = prng.next() * prng.next();
      break;
    case 'old':
      fraction = 1 - prng.next() * prng.next();
      break;
    case 'uniform':
    default:
      fraction = prng.next();
      break;
  }

  const msAgo = fraction * withinDays * 86400000;
  return new Date(Date.now() - msAgo);
}
