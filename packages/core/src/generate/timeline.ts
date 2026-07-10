import type { PRNG } from '../distributions/prng.js';
import type { GrowthModel, SeasonalityConfig, TimelineConfig } from '../config/types.js';

export interface TimelineInfo {
  startMs: number;
  endMs: number;
  durationMs: number;
  totalMonths: number;
  growthModel: GrowthModel;
}
export function computeTimelineInfo(
  config: TimelineConfig,
  refDate?: number,
): TimelineInfo {
  const startMs = new Date(config.start).getTime();
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid timeline start date: ${config.start}`);
  }
  const endMs = config.end
    ? new Date(config.end).getTime()
    : (refDate ?? Date.now());
  if (Number.isNaN(endMs)) {
    throw new Error(`Invalid timeline end date: ${config.end ?? 'now'}`);
  }
  if (endMs <= startMs) {
    throw new Error('Timeline end must be after start');
  }
  const durationMs = endMs - startMs;
  const totalMonths = durationMs / (86400000 * 30.436875);
  return { startMs, endMs, durationMs, totalMonths, growthModel: config.growth };
}
export function cumulativeGrowth(info: TimelineInfo, t: number): number {
  const tClamped = Math.max(0, Math.min(1, t));
  const model = info.growthModel;
  switch (model.type) {
    case 'compound': {
      const r = model.monthlyRate;
      const T = info.totalMonths;
      const base = Math.pow(1 + r, T);
      return (Math.pow(1 + r, tClamped * T) - 1) / (base - 1);
    }
    case 'linear': {
      const g = model.totalGrowth;
      const num = 2 * tClamped + (g - 1) * tClamped * tClamped;
      const den = g + 1;
      return num / den;
    }
    case 'scurve': {
      const k = model.steepness ?? 5;
      const t0 = model.inflectionPoint ?? 0.5;
      const sig = (x: number) => 1 / (1 + Math.exp(-k * (x - t0)));
      const s0 = sig(0);
      const s1 = sig(1);
      return (sig(tClamped) - s0) / (s1 - s0);
    }
  }
}
export function inverseCDF(info: TimelineInfo, q: number): number {
  const qClamped = Math.max(1e-10, Math.min(1 - 1e-10, q));
  const model = info.growthModel;
  switch (model.type) {
    case 'compound': {
      const r = model.monthlyRate;
      const T = info.totalMonths;
      const base = Math.pow(1 + r, T);
      return Math.log(1 + qClamped * (base - 1)) / Math.log(1 + r) / T;
    }
    case 'linear': {
      const g = model.totalGrowth;
      if (Math.abs(g - 1) < 1e-10) return qClamped;
      const t = (-1 + Math.sqrt(1 + (g * g - 1) * qClamped)) / (g - 1);
      return Math.max(0, Math.min(1, t));
    }
    case 'scurve': {
      const k = model.steepness ?? 5;
      const t0 = model.inflectionPoint ?? 0.5;
      const raw = t0 + Math.log(qClamped / (1 - qClamped)) / k;
      return Math.max(0, Math.min(1, raw));
    }
  }
}
export function rowTimestamp(
  rowIndex: number,
  totalRows: number,
  timeline: TimelineInfo,
  prng: PRNG,
): number {
  const baseFrac = totalRows > 1 ? rowIndex / (totalRows - 1) : 0.5;
  const jitter = (prng.next() - 0.5) / totalRows;
  const q = Math.max(0, Math.min(1, baseFrac + jitter));
  const t = inverseCDF(timeline, q);
  return timeline.startMs + t * timeline.durationMs;
}
export function churnTimestamp(
  acquiredAt: number,
  monthlyRate: number,
  timelineEndMs: number,
  prng: PRNG,
): number {
  const u = prng.next();
  const lifetimeMs = u === 0 ? 0 : -Math.log(u) / monthlyRate * 86400000 * 30.436875;
  const churnedAt = acquiredAt + lifetimeMs;
  return Math.min(churnedAt, timelineEndMs);
}
export function seasonalMultiplier(
  date: Date,
  seasonality: SeasonalityConfig,
): number {
  if (seasonality.type === 'custom') {
    return seasonality.fn?.(date) ?? 1;
  }
  if (seasonality.type === 'preset' && seasonality.name === 'ecommerce-holiday') {
    const month = date.getMonth();
    if (month === 10) return 1.8;
    if (month === 11) return 2.0;
    if (month === 0) return 0.7;
    if (month === 1) return 0.85;
    if (month === 9) return 0.8;
    return 1.0;
  }
  return 1;
}
export function computeRowCount(
  timeline: TimelineInfo,
  configCount?: number | unknown,
): number {
  if (typeof configCount === 'number') return Math.max(1, configCount);
  const model = timeline.growthModel;
  switch (model.type) {
    case 'compound': {
      const baseMonthly = 1;
      let total = 0;
      for (let m = 0; m < Math.ceil(timeline.totalMonths); m++) {
        total += baseMonthly * Math.pow(1 + model.monthlyRate, m);
      }
      return Math.max(1, Math.round(total));
    }
    case 'linear': {
      const avg = (1 + model.totalGrowth) / 2;
      return Math.max(1, Math.round(avg * Math.ceil(timeline.totalMonths)));
    }
    case 'scurve': {
      return Math.max(1, Math.round(Math.ceil(timeline.totalMonths) * 1.0));
    }
  }
}