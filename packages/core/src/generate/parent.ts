import { deriveStream } from '../distributions/prng.js';
import type { PRNG } from '../distributions/prng.js';
import { uniformInt } from '../distributions/uniform.js';
import { paretoInt } from '../distributions/pareto.js';
import { exponential } from '../distributions/exponential.js';
import { normal } from '../distributions/normal.js';
import { zipf } from '../distributions/zipf.js';
import type { DistributionSpec, GenerationPlan, ParentTimelineCtx } from '../config/types.js';
import type { TableSchema } from '../types/index.js';

export interface RowFkBinding {
  childRowIndex: number;
  bindings: Record<string, unknown>; // FK column → parent PK value
}

export interface ParentAssignmentResult {
  totalCount: number;
  bindings: RowFkBinding[];
}

function sampleDistribution(dist: number | DistributionSpec, prng: PRNG): number {
  if (typeof dist === 'number') return dist;
  const { kind, params } = dist;
  switch (kind) {
    case 'paretoInt':
    case 'pareto':
      return paretoInt(prng, (params.min as number) ?? 1, (params.max as number) ?? 100, (params.alpha as number) ?? 1.16);
    case 'uniformInt':
      return uniformInt(prng, (params.min as number) ?? 0, (params.max as number) ?? 100);
    case 'exponential':
      return Math.round(exponential(prng, (params.rate as number) ?? 1));
    case 'normal':
      return Math.max(0, Math.round(normal(prng, (params.mean as number) ?? 0, (params.stdDev as number) ?? 1)));
    case 'zipf':
      return zipf(prng, (params.n as number) ?? 100, (params.s as number) ?? 1);
    default:
      return Math.round(prng.next() * 10);
  }
}

function isSelfRefFK(tableSchema: TableSchema, fk: { referencedTable: string }): boolean {
  return fk.referencedTable === tableSchema.name;
}

export function assignParents(
  tableName: string,
  tableSchema: TableSchema,
  tablePlan: GenerationPlan['tables'][string],
  pkCache: Map<string, unknown[]>,
  rootSeed: number,
  personaCascades?: Map<string, number[]>,
  parentTimelineCtx?: Map<number, ParentTimelineCtx>,
): ParentAssignmentResult {
  const childFKs = tableSchema.foreignKeys.filter(
    (fk) => !isSelfRefFK(tableSchema, fk),
  );

  if (childFKs.length === 0) {
    const total = sampleDistribution(tablePlan.count, deriveStream(String(rootSeed), tableName, '__count__'));
    return { totalCount: Math.max(1, total), bindings: [] };
  }

  if (childFKs.length >= 2) {
    return assignJunction(tableName, tableSchema, tablePlan, pkCache, rootSeed, childFKs);
  }

  const fk = childFKs[0]!;
  const fkCol = fk.columns[0]!;
  const parentTable = fk.referencedTable;
  const parentPKs = pkCache.get(parentTable);
  if (!parentPKs || parentPKs.length === 0) {
    return { totalCount: 0, bindings: [] };
  }

  // Determine the timeline span for churn tapering from the parent's plan
  let parentEndMs = 0;
  let parentStartMs = 0;
  if (parentTimelineCtx) {
    const allCtx = [...parentTimelineCtx.values()];
    if (allCtx.length > 0) {
      parentStartMs = Math.min(...allCtx.map((c) => c.acquiredAt));
      parentEndMs = parentStartMs + allCtx.reduce((max, c) => Math.max(max, (c.churnedAt ?? c.acquiredAt) - c.acquiredAt), 0);
    }
  }

  const countPerParent = tablePlan.countPerParent ?? {};
  const dist = countPerParent[parentTable] ?? 1;
  const cascades = personaCascades?.get(parentTable);

  const bindings: RowFkBinding[] = [];
  let childRowIdx = 0;

  for (let pi = 0; pi < parentPKs.length; pi++) {
    const parentPrng = deriveStream(String(rootSeed), tableName, '__parent__', parentTable, String(pi));
    let count = sampleDistribution(dist, parentPrng);

    if (cascades && cascades[pi] !== undefined) {
      count = Math.round(count * cascades[pi]);
    }

    // NEW: churn tapering — reduce child count for churned parents
    if (parentTimelineCtx && parentEndMs > parentStartMs) {
      const parentCtx = parentTimelineCtx.get(pi);
      if (parentCtx?.churnedAt) {
        const activeFraction = (parentCtx.churnedAt - parentCtx.acquiredAt) / (parentEndMs - parentStartMs);
        count = Math.max(1, Math.round(count * Math.min(1, activeFraction)));
      }
    }

    for (let ci = 0; ci < count; ci++) {
      bindings.push({
        childRowIndex: childRowIdx++,
        bindings: { [fkCol]: parentPKs[pi] },
      });
    }
  }

  return { totalCount: Math.max(1, childRowIdx), bindings };
}

function assignJunction(
  tableName: string,
  _tableSchema: TableSchema,
  tablePlan: GenerationPlan['tables'][string],
  pkCache: Map<string, unknown[]>,
  rootSeed: number,
  childFKs: Array<{ columns: string[]; referencedTable: string }>,
): ParentAssignmentResult {
  const countPerParent = tablePlan.countPerParent ?? {};

  const fk1 = childFKs[0]!;
  const fk2 = childFKs[1]!;
  const col1 = fk1.columns[0]!;
  const col2 = fk2.columns[0]!;
  const parent1PKs = pkCache.get(fk1.referencedTable) ?? [];
  const parent2PKs = pkCache.get(fk2.referencedTable) ?? [];

  if (parent1PKs.length === 0 || parent2PKs.length === 0) {
    return { totalCount: 0, bindings: [] };
  }

  const fanOutDist = countPerParent[fk1.referencedTable] ?? countPerParent[fk2.referencedTable] ?? { kind: 'uniformInt', params: { min: 1, max: 5 } };

  const seen = new Set<string>();
  const bindings: RowFkBinding[] = [];
  let childRowIdx = 0;

  const availableParent2 = [...parent2PKs];

  for (let pi = 0; pi < parent1PKs.length; pi++) {
    const prng = deriveStream(String(rootSeed), tableName, '__junction__', String(pi));
    const fanOut = sampleDistribution(fanOutDist, prng);

    for (let fi = 0; fi < fanOut; fi++) {
      if (availableParent2.length === 0) break;

      const idx = uniformInt(prng, 0, availableParent2.length - 1);
      const pk2 = availableParent2[idx];
      const pk1 = parent1PKs[pi];
      const pairKey = `${String(pk1)}|${String(pk2)}`;

      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      bindings.push({
        childRowIndex: childRowIdx++,
        bindings: { [col1]: pk1, [col2]: pk2 },
      });

      if (availableParent2.length > parent2PKs.length * 0.5) {
        availableParent2.splice(idx, 1);
      }
    }
  }

  return { totalCount: Math.max(1, childRowIdx), bindings };
}
