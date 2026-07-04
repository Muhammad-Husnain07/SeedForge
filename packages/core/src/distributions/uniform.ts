import type { PRNG } from './prng.js';

export function uniformInt(prng: PRNG, min: number, max: number): number {
  return Math.floor(prng.next() * (max - min + 1)) + min;
}

export function uniformReal(prng: PRNG, min: number, max: number): number {
  return prng.next() * (max - min) + min;
}
