import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mulberry32,
  hashToSeed,
  deriveStream,
  uniformInt,
  uniformReal,
  weightedCategorical,
  paretoInt,
  normal,
  exponential,
  zipf,
  recencyWeighted,
  assignPersona,
} from './index.js';
import type { PersonaSet } from './persona.js';

const N = 50000;

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ============================================================
// Determinism
// ============================================================
describe('determinism', () => {
  it('same seed produces identical sequence across runs', () => {
    const run1: number[] = [];
    const prng1 = mulberry32(12345);
    for (let i = 0; i < 1000; i++) run1.push(prng1.next());

    const run2: number[] = [];
    const prng2 = mulberry32(12345);
    for (let i = 0; i < 1000; i++) run2.push(prng2.next());

    expect(run1).toEqual(run2);
  });

  it('different seeds produce different sequences', () => {
    const seq1: number[] = [];
    const prng1 = mulberry32(12345);
    for (let i = 0; i < 100; i++) seq1.push(prng1.next());

    const seq2: number[] = [];
    const prng2 = mulberry32(54321);
    for (let i = 0; i < 100; i++) seq2.push(prng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('clone produces identical independent sequence', () => {
    const prng1 = mulberry32(99);
    for (let i = 0; i < 50; i++) prng1.next();

    const prng2 = prng1.clone();
    const seqA: number[] = [];
    for (let i = 0; i < 50; i++) seqA.push(prng1.next());

    const seqB: number[] = [];
    for (let i = 0; i < 50; i++) seqB.push(prng2.next());

    expect(seqA).toEqual(seqB);
  });
});

// ============================================================
// hashToSeed
// ============================================================
describe('hashToSeed', () => {
  it('same string produces same hash', () => {
    expect(hashToSeed('hello')).toBe(hashToSeed('hello'));
  });

  it('different strings produce different hashes', () => {
    expect(hashToSeed('hello')).not.toBe(hashToSeed('world'));
  });

  it('empty string produces a valid number', () => {
    expect(typeof hashToSeed('')).toBe('number');
    expect(hashToSeed('')).toBeGreaterThanOrEqual(0);
  });

  it('deterministic across calls (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h1 = hashToSeed(s);
        const h2 = hashToSeed(s);
        return h1 === h2;
      }),
    );
  });
});

// ============================================================
// Sub-stream independence (CRITICAL)
// ============================================================
describe('sub-stream independence', () => {
  it('streams from different namespaces are independent', () => {
    const streamA = deriveStream(42, 'users', 'email', '0');
    const streamB = deriveStream(42, 'orders', 'total', '5');

    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 1000; i++) seqA.push(streamA.next());
    for (let i = 0; i < 1000; i++) seqB.push(streamB.next());

    expect(seqA).not.toEqual(seqB);
  });

  it('same namespace produces same sequence', () => {
    const a1 = deriveStream(42, 'users', 'email', '0');
    const a2 = deriveStream(42, 'users', 'email', '0');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 100; i++) seq1.push(a1.next());
    for (let i = 0; i < 100; i++) seq2.push(a2.next());

    expect(seq1).toEqual(seq2);
  });

  it('changing row count of one stream never affects another stream', () => {
    const scenarioA = () => {
      const ordersStream = deriveStream(1, 'orders', 'total');
      const vals: number[] = [];
      for (let i = 0; i < 5; i++) {
        vals.push(ordersStream.next());
      }
      const usersStream = deriveStream(1, 'users', 'email');
      for (let i = 0; i < 3; i++) {
        vals.push(usersStream.next());
      }
      return vals;
    };

    const scenarioB = () => {
      const ordersStream = deriveStream(1, 'orders', 'total');
      const vals: number[] = [];
      for (let i = 0; i < 10; i++) {
        vals.push(ordersStream.next());
      }
      const usersStream = deriveStream(1, 'users', 'email');
      for (let i = 0; i < 3; i++) {
        vals.push(usersStream.next());
      }
      return vals;
    };

    const resultA = scenarioA();
    const resultB = scenarioB();

    for (let i = 0; i < 3; i++) {
      expect(resultA[5 + i]).toBe(resultB[10 + i]);
    }
  });
});

// ============================================================
// uniformInt
// ============================================================
describe('uniformInt', () => {
  it('produces values in [min, max]', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        const prng = mulberry32(42);
        const val = uniformInt(prng, min, max);
        return val >= min && val <= max;
      }),
    );
  });

  it('empirical mean is close to (min+max)/2', () => {
    const prng = deriveStream(42, 'uniformInt', 'test');
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += uniformInt(prng, 0, 100);
    }
    const empMean = sum / N;
    expect(empMean).toBeGreaterThan(48);
    expect(empMean).toBeLessThan(52);
  });

  it('when min === max, always returns that value', () => {
    fc.assert(
      fc.property(fc.integer(), (v) => {
        const prng = mulberry32(99);
        return uniformInt(prng, v, v) === v;
      }),
    );
  });
});

// ============================================================
// uniformReal
// ============================================================
describe('uniformReal', () => {
  it('produces values in [min, max]', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), (a, b) => {
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        const prng = mulberry32(42);
        const val = uniformReal(prng, min, max);
        if (min === max) return val === min;
        return val >= min && val < max;
      }),
    );
  });

  it('empirical mean is close to (min+max)/2', () => {
    const prng = deriveStream(42, 'uniformReal', 'test');
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += uniformReal(prng, -10, 10);
    }
    const empMean = sum / N;
    expect(empMean).toBeGreaterThan(-0.5);
    expect(empMean).toBeLessThan(0.5);
  });
});

// ============================================================
// weightedCategorical
// ============================================================
describe('weightedCategorical', () => {
  it('returns one of the keys', () => {
    const prng = deriveStream(42, 'weighted', 'keys');
    for (let i = 0; i < 100; i++) {
      const val = weightedCategorical(prng, { a: 1, b: 2, c: 3 });
      expect(['a', 'b', 'c']).toContain(val);
    }
  });

  it('empirical frequencies match weights within tolerance', () => {
    const prng = deriveStream(42, 'weighted', 'freq');
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < N; i++) {
      const val = weightedCategorical(prng, { a: 1, b: 3, c: 6 });
      counts[val]!++;
    }
    const total = N;
    expect(counts.a! / total).toBeGreaterThan(0.08);
    expect(counts.a! / total).toBeLessThan(0.12);
    expect(counts.b! / total).toBeGreaterThan(0.28);
    expect(counts.b! / total).toBeLessThan(0.32);
    expect(counts.c! / total).toBeGreaterThan(0.58);
    expect(counts.c! / total).toBeLessThan(0.62);
  });

  it('throws on empty weights', () => {
    expect(() => weightedCategorical(mulberry32(0), {})).toThrow();
  });
});

// ============================================================
// paretoInt
// ============================================================
describe('paretoInt', () => {
  it('produces values in [min, max]', () => {
    const prng = deriveStream(42, 'pareto', 'range');
    for (let i = 0; i < 1000; i++) {
      const val = paretoInt(prng, 1, 100, 2);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(100);
    }
  });

  it('empirical median is less than mean (80/20 skew)', () => {
    const prng = deriveStream(42, 'pareto', 'skew');
    const vals: number[] = [];
    for (let i = 0; i < N; i++) {
      vals.push(paretoInt(prng, 1, 100, 1.5));
    }
    vals.sort((a, b) => a - b);
    const empMedian = vals[Math.floor(vals.length / 2)]!;
    const empMean = mean(vals);
    expect(empMedian).toBeLessThan(empMean);
  });

  it('throws on invalid alpha', () => {
    expect(() => paretoInt(mulberry32(0), 1, 10, 0)).toThrow();
    expect(() => paretoInt(mulberry32(0), 1, 10, -1)).toThrow();
  });
});

// ============================================================
// normal
// ============================================================
describe('normal', () => {
  it('empirical mean is close to specified mean', () => {
    const prng = deriveStream(42, 'normal', 'mean');
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += normal(prng, 50, 10);
    }
    const empMean = sum / N;
    expect(empMean).toBeGreaterThan(49);
    expect(empMean).toBeLessThan(51);
  });

  it('empirical stddev is close to specified stddev', () => {
    const prng = deriveStream(42, 'normal', 'std');
    const vals: number[] = [];
    for (let i = 0; i < N; i++) {
      vals.push(normal(prng, 0, 15));
    }
    const m = mean(vals);
    const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
    const empStd = Math.sqrt(variance);
    expect(empStd).toBeGreaterThan(13.5);
    expect(empStd).toBeLessThan(16.5);
  });

  it('stddev=0 always returns mean', () => {
    const prng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(normal(prng, 5, 0)).toBe(5);
    }
  });
});

// ============================================================
// exponential
// ============================================================
describe('exponential', () => {
  it('produces non-negative values', () => {
    const prng = deriveStream(42, 'exp', 'nonneg');
    for (let i = 0; i < 1000; i++) {
      expect(exponential(prng, 2)).toBeGreaterThanOrEqual(0);
    }
  });

  it('empirical mean is close to 1/rate', () => {
    const rate = 0.5;
    const prng = deriveStream(42, 'exp', 'mean');
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += exponential(prng, rate);
    }
    const empMean = sum / N;
    const expectedMean = 1 / rate;
    expect(empMean).toBeGreaterThan(expectedMean * 0.95);
    expect(empMean).toBeLessThan(expectedMean * 1.05);
  });
});

// ============================================================
// zipf
// ============================================================
describe('zipf', () => {
  it('produces values in [1, n]', () => {
    const prng = deriveStream(42, 'zipf', 'range');
    for (let i = 0; i < 1000; i++) {
      const val = zipf(prng, 10, 1);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('rank 1 appears more often than rank 2', () => {
    const prng = deriveStream(42, 'zipf', 'rank');
    const counts = Array.from<number>({ length: 10 }, () => 0);
    for (let i = 0; i < N; i++) {
      const val = zipf(prng, 10, 1);
      counts[val - 1]++;
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[5]);
  });
});

// ============================================================
// recencyWeighted
// ============================================================
describe('recencyWeighted', () => {
  it('produces dates within the specified window', () => {
    const prng = deriveStream(42, 'recency', 'range');
    const now = Date.now();
    const msWindow = 30 * 86400000;
    for (let i = 0; i < 100; i++) {
      const d = recencyWeighted(prng, 30, 'uniform');
      expect(d.getTime()).toBeGreaterThanOrEqual(now - msWindow);
      expect(d.getTime()).toBeLessThanOrEqual(now);
    }
  });

  it('recent skew has median closer to now than uniform', () => {
    const prngUniform = deriveStream(42, 'recency', 'uniform');
    const uniformDates: number[] = [];
    for (let i = 0; i < N; i++) {
      uniformDates.push(recencyWeighted(prngUniform, 100, 'uniform').getTime());
    }
    uniformDates.sort((a, b) => a - b);
    const uniformMedian = uniformDates[Math.floor(uniformDates.length / 2)]!;

    const prngRecent = deriveStream(42, 'recency', 'recent');
    const recentDates: number[] = [];
    for (let i = 0; i < N; i++) {
      recentDates.push(recencyWeighted(prngRecent, 100, 'recent').getTime());
    }
    recentDates.sort((a, b) => a - b);
    const recentMedian = recentDates[Math.floor(recentDates.length / 2)]!;

    expect(recentMedian).toBeGreaterThan(uniformMedian);
  });
});

// ============================================================
// persona
// ============================================================
describe('persona', () => {
  const personaSet: PersonaSet = {
    personas: [
      { name: 'power_user', selectionWeight: 0.2, overrides: [], cascades: { orders: 5 } },
      { name: 'standard', selectionWeight: 0.5, overrides: [] },
      { name: 'lurker', selectionWeight: 0.3, overrides: [] },
    ],
  };

  it('assigns a valid persona', () => {
    const prng = deriveStream(42, 'persona', 'assign');
    for (let i = 0; i < 100; i++) {
      const p = assignPersona(prng, personaSet);
      expect(p).not.toBeNull();
      expect(['power_user', 'standard', 'lurker']).toContain(p!.name);
    }
  });

  it('empirical frequencies match selection weights', () => {
    const prng = deriveStream(42, 'persona', 'freq');
    const counts: Record<string, number> = { power_user: 0, standard: 0, lurker: 0 };
    for (let i = 0; i < N; i++) {
      const p = assignPersona(prng, personaSet);
      if (p) counts[p.name]!++;
    }
    const total = N;
    expect(counts.power_user! / total).toBeGreaterThan(0.18);
    expect(counts.power_user! / total).toBeLessThan(0.22);
    expect(counts.standard! / total).toBeGreaterThan(0.48);
    expect(counts.standard! / total).toBeLessThan(0.52);
    expect(counts.lurker! / total).toBeGreaterThan(0.28);
    expect(counts.lurker! / total).toBeLessThan(0.32);
  });

  it('returns null for empty persona set', () => {
    const prng = mulberry32(42);
    expect(assignPersona(prng, { personas: [] })).toBeNull();
  });
});
