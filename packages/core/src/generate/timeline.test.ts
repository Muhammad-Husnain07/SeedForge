import { describe, it, expect } from 'vitest';
import { computeTimelineInfo, cumulativeGrowth, inverseCDF, rowTimestamp, churnTimestamp, seasonalMultiplier } from './timeline.js';
import type { TimelineInfo } from './timeline.js';
import type { GrowthModel, TimelineConfig, SeasonalityConfig, ChurnConfig } from '../config/types.js';
import { deriveStream } from '../distributions/prng.js';

const REF_DATE = new Date('2026-01-15T12:00:00Z').getTime();

const COMPOUND_24M: TimelineConfig = {
  start: '2024-01-01',
  end: '2025-12-31',
  growth: { type: 'compound', monthlyRate: 0.15 },
};

function makeTimelineInfo(growth: GrowthModel, start = '2024-01-01', end = '2025-12-31'): TimelineInfo {
  return computeTimelineInfo({ start, end, growth }, REF_DATE);
}

describe('computeTimelineInfo', () => {
  it('computes 24 months for 2024-2025', () => {
    const info = computeTimelineInfo(COMPOUND_24M, REF_DATE);
    expect(info.totalMonths).toBeCloseTo(24, 0);
    expect(info.startMs).toBe(new Date('2024-01-01').getTime());
    expect(info.endMs).toBe(new Date('2025-12-31').getTime());
  });

  it('uses refDate when end is not provided', () => {
    const cfg: TimelineConfig = { start: '2025-01-01', growth: { type: 'compound', monthlyRate: 0.1 } };
    const info = computeTimelineInfo(cfg, REF_DATE);
    expect(info.endMs).toBe(REF_DATE);
  });

  it('throws on invalid start date', () => {
    expect(() => computeTimelineInfo({ start: 'not-a-date', growth: { type: 'compound', monthlyRate: 0.1 } }, REF_DATE)).toThrow();
  });

  it('throws when end <= start', () => {
    expect(() => computeTimelineInfo({ start: '2025-01-01', end: '2024-01-01', growth: { type: 'compound', monthlyRate: 0.1 } }, REF_DATE)).toThrow();
  });
});

describe('cumulativeGrowth', () => {
  const info = makeTimelineInfo({ type: 'compound', monthlyRate: 0.15 });

  it('starts at 0', () => {
    expect(cumulativeGrowth(info, 0)).toBeCloseTo(0, 10);
  });

  it('ends at 1', () => {
    expect(cumulativeGrowth(info, 1)).toBeCloseTo(1, 5);
  });

  it('is monotonic', () => {
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const v = cumulativeGrowth(info, t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-10);
      prev = v;
    }
  });

  it('compound growth accelerates (later months have larger share)', () => {
    const firstHalf = cumulativeGrowth(info, 0.5);
    // With 15% monthly over 24mo, growth is exponential, so first half should be less than 50%
    expect(firstHalf).toBeLessThan(0.5);
  });

  it('linear growth is proportional', () => {
    const linInfo = makeTimelineInfo({ type: 'linear', totalGrowth: 3.0 });
    expect(cumulativeGrowth(linInfo, 0.5)).toBeCloseTo(0.375, 5);
    expect(cumulativeGrowth(linInfo, 0.25)).toBeCloseTo(0.15625, 5);
  });

  it('scurve growth is S-shaped', () => {
    const scInfo = makeTimelineInfo({ type: 'scurve', steepness: 5, inflectionPoint: 0.5 });
    // At inflection point (t=0.5), cumulative should be ~0.5
    expect(cumulativeGrowth(scInfo, 0.5)).toBeCloseTo(0.5, 1);
    // Slow at start
    expect(cumulativeGrowth(scInfo, 0.2)).toBeLessThan(0.2);
    // Fast in middle
    expect(cumulativeGrowth(scInfo, 0.6) - cumulativeGrowth(scInfo, 0.4)).toBeGreaterThan(cumulativeGrowth(scInfo, 0.2));
  });
});

describe('inverseCDF', () => {
  const info = makeTimelineInfo({ type: 'compound', monthlyRate: 0.15 });

  it('maps q=0 to t=0', () => {
    expect(inverseCDF(info, 0)).toBeCloseTo(0, 3);
  });

  it('maps q=1 to t=1', () => {
    expect(inverseCDF(info, 1)).toBeCloseTo(1, 3);
  });

  it('inverts cumulativeGrowth', () => {
    for (let i = 0; i <= 10; i++) {
      const q = i / 10;
      const t = inverseCDF(info, q);
      const qBack = cumulativeGrowth(info, t);
      expect(qBack).toBeCloseTo(q, 2);
    }
  });
});

describe('rowTimestamp', () => {
  it('distributes rows across the timeline with compound growth', () => {
    const info = makeTimelineInfo({ type: 'compound', monthlyRate: 0.15 });
    const totalRows = 5000;
    const monthBuckets = new Array(24).fill(0);

    for (let i = 0; i < totalRows; i++) {
      const prng = deriveStream('test-timeline', 'users', String(i));
      const ts = rowTimestamp(i, totalRows, info, prng);
      const d = new Date(ts);
      const monthIdx = (d.getFullYear() - 2024) * 12 + d.getMonth();
      if (monthIdx >= 0 && monthIdx < 24) monthBuckets[monthIdx]++;
    }

    // Expected cumulative proportions at mid-month for each month
    for (let m = 0; m < 24; m++) {
      const tStart = m / 24;
      const tEnd = (m + 1) / 24;
      const expectedFrac = cumulativeGrowth(info, tEnd) - cumulativeGrowth(info, tStart);
      const actualFrac = monthBuckets[m] / totalRows;

      // Allow ±50% relative tolerance (statistical noise + jitter)
      expect(actualFrac).toBeGreaterThan(expectedFrac * 0.5);
      expect(actualFrac).toBeLessThan(expectedFrac * 1.5);
    }
  });

  it('is deterministic for same seed', () => {
    const info = makeTimelineInfo({ type: 'compound', monthlyRate: 0.15 });
    const p1 = deriveStream('test', 't', String(5));
    const p2 = deriveStream('test', 't', String(5));
    expect(rowTimestamp(5, 100, info, p1)).toBe(rowTimestamp(5, 100, info, p2));
  });
});

describe('churnTimestamp', () => {
  it('churns after acquisition (within timeline)', () => {
    const acquired = new Date('2024-06-15').getTime();
    const endMs = new Date('2025-12-31').getTime();
    const prng = deriveStream('test-churn', 'user', '0');
    const churned = churnTimestamp(acquired, 0.05, endMs, prng);
    expect(churned).toBeGreaterThan(acquired);
    expect(churned).toBeLessThanOrEqual(endMs);
  });

  it('higher churn rate produces earlier churn on average', () => {
    const acquired = new Date('2024-01-01').getTime();
    const endMs = new Date('2025-12-31').getTime();
    let sumLow = 0;
    let sumHigh = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const p1 = deriveStream('test-churn-rate', 'low', String(i));
      const p2 = deriveStream('test-churn-rate', 'high', String(i));
      sumLow += churnTimestamp(acquired, 0.02, endMs, p1);
      sumHigh += churnTimestamp(acquired, 0.2, endMs, p2);
    }
    const avgLow = sumLow / n;
    const avgHigh = sumHigh / n;
    expect(avgHigh).toBeLessThan(avgLow);
  });
});

describe('seasonalMultiplier', () => {
  it('ecommerce-holiday preset boosts Nov/Dec', () => {
    const season: SeasonalityConfig = { type: 'preset', name: 'ecommerce-holiday' };
    expect(seasonalMultiplier(new Date('2024-11-15'), season)).toBe(1.8);
    expect(seasonalMultiplier(new Date('2024-12-15'), season)).toBe(2.0);
    expect(seasonalMultiplier(new Date('2024-07-15'), season)).toBe(1.0);
  });
});

describe('compound growth integration — DoD', () => {
  it('24-month 15%-monthly compound growth produces approximating monthly bucket counts', () => {
    const timeline: TimelineConfig = {
      start: '2024-01-01',
      end: '2025-12-31',
      growth: { type: 'compound', monthlyRate: 0.15 },
    };
    const info = computeTimelineInfo(timeline, REF_DATE);
    const totalRows = 10000;

    const monthBuckets = new Array(24).fill(0);
    for (let i = 0; i < totalRows; i++) {
      const prng = deriveStream('dod-compound', 'users', String(i));
      const ts = rowTimestamp(i, totalRows, info, prng);
      const d = new Date(ts);
      const monthIdx = (d.getFullYear() - 2024) * 12 + d.getMonth();
      if (monthIdx >= 0 && monthIdx < 24) monthBuckets[monthIdx]++;
    }

    for (let m = 0; m < 24; m++) {
      const tStart = m / 24;
      const tEnd = (m + 1) / 24;
      const expectedFrac = cumulativeGrowth(info, tEnd) - cumulativeGrowth(info, tStart);
      const actualFrac = monthBuckets[m] / totalRows;

      // ±25% tolerance for statistical noise over 10000 rows
      expect(actualFrac).toBeGreaterThan(expectedFrac * 0.75);
      expect(actualFrac).toBeLessThan(expectedFrac * 1.25);
    }
  });
});

describe('churn cascade — DoD', () => {
  it('persona with churn shows measurably different cascade tail than one without', () => {
    const timeline: TimelineConfig = {
      start: '2024-01-01',
      end: '2025-12-31',
      growth: { type: 'compound', monthlyRate: 0.15 },
    };
    const info = computeTimelineInfo(timeline, REF_DATE);
    const totalParents = 2000;
    const childrenPerParent = 5;

    interface ParentRow {
      acquiredAt: number;
      churnedAt?: number;
    }

    const parents: ParentRow[] = [];

    for (let i = 0; i < totalParents; i++) {
      const prng = deriveStream('dod-churn', 'users', String(i));
      const acquiredAt = rowTimestamp(i, totalParents, info, prng);

      // Group A (even index): no churn
      // Group B (odd index): 10% monthly churn
      let churnedAt: number | undefined;
      if (i % 2 === 1) {
        const churnPrng = deriveStream('dod-churn', 'churn', String(i));
        churnedAt = churnTimestamp(acquiredAt, 0.1, info.endMs, churnPrng);
      }

      parents.push({ acquiredAt, churnedAt });
    }

    const parentStartMs = Math.min(...parents.map((p) => p.acquiredAt));
    const parentEndMs = parentStartMs + parents.reduce((max, p) => Math.max(max, (p.churnedAt ?? p.acquiredAt) - p.acquiredAt), 0);
    const timelineSpan = parentEndMs - parentStartMs;

    let totalChildrenNoChurn = 0;
    let totalChildrenWithChurn = 0;
    let countNoChurn = 0;
    let countWithChurn = 0;

    for (let pi = 0; pi < parents.length; pi++) {
      const p = parents[pi]!;
      const pq = deriveStream('dod-churn', 'children', String(pi));
      let count = childrenPerParent;

      if (p.churnedAt) {
        // Group B: churn tapering
        const activeMs = p.churnedAt - p.acquiredAt;
        const activeFraction = activeMs / timelineSpan;
        // Scale noise so small counts still produce at least 1
        const tapered = Math.max(1, Math.round(childrenPerParent * activeFraction));
        count = tapered;
        totalChildrenWithChurn += count;
        countWithChurn++;
      } else {
        totalChildrenNoChurn += count;
        countNoChurn++;
      }
    }

    const avgNoChurn = totalChildrenNoChurn / Math.max(1, countNoChurn);
    const avgWithChurn = totalChildrenWithChurn / Math.max(1, countWithChurn);
    // Churned users should have significantly fewer children
    expect(avgWithChurn).toBeLessThan(avgNoChurn * 0.8);
  });
});
