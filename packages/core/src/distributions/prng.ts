export interface PRNG {
  next(): number;
  nextInt(): number;
  clone(): PRNG;
}

export function mulberry32(seed: number): PRNG {
  let state = seed >>> 0;

  return {
    next(): number {
      state = (state + 0x6D2B79F5) | 0;
      let t = (state ^ (state >>> 15)) | 0;
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    nextInt(): number {
      return (this.next() * 4294967296) >>> 0;
    },

    clone(): PRNG {
      const cloned = mulberry32(state);
      return cloned;
    },
  };
}

export function hashToSeed(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Derives an independent sub-stream PRNG from a root seed and a namespace path.
 *
 * Why sub-streams instead of a single global stream?
 * ---------------------------------------------------
 * If generation used one sequential global stream, changing table A's row
 * count would shift every value generated for table B onward, silently
 * breaking reproducibility whenever anyone tweaks one table's size.
 * Namespaced sub-streams make each table/column's output depend only on
 * the seed plus its own name — not on what else was generated before it.
 *
 * Each call returns a fresh, independent PRNG whose entire sequence is
 * deterministically determined by (rootSeed + namespace). No amount of
 * consumption from one stream affects any other stream.
 */
export function deriveStream(
  rootSeed: string | number,
  ...namespace: string[]
): PRNG {
  const base = typeof rootSeed === 'number' ? String(rootSeed) : rootSeed;
  const combined = base + '\0' + namespace.join('\0');
  return mulberry32(hashToSeed(combined));
}
