import { deriveStream } from '../distributions/prng.js';
import type { GeneratorSpec } from '../semantic/types.js';
import type { TableSchema } from '../types/index.js';
import { generateFieldValue } from './fields.js';
import type { GenerationError } from './types.js';
import { GenerationError } from './types.js';
import type { GenerationPlan } from '../config/types.js';

function makeConstraintKey(constraintCols: string[], row: Record<string, unknown>): string {
  return constraintCols.map((c) => `${c}::${JSON.stringify(row[c])}`).join('|');
}

export interface UniqueContext {
  existingKeys: Map<string, Set<string>>;
}

export function checkUnique(
  row: Record<string, unknown>,
  uniqueConstraints: string[][],
  ctx: UniqueContext,
): string[][] | null {
  const violated: string[][] = [];
  for (const constraint of uniqueConstraints) {
    const key = makeConstraintKey(constraint, row);
    const storeKey = [...constraint].sort().join('+');
    const set = ctx.existingKeys.get(storeKey);
    if (set && set.has(key)) {
      violated.push(constraint);
    }
  }
  return violated.length > 0 ? violated : null;
}

export function registerUnique(
  row: Record<string, unknown>,
  uniqueConstraints: string[][],
  ctx: UniqueContext,
): void {
  for (const constraint of uniqueConstraints) {
    const key = makeConstraintKey(constraint, row);
    const storeKey = [...constraint].sort().join('+');
    let set = ctx.existingKeys.get(storeKey);
    if (!set) {
      set = new Set();
      ctx.existingKeys.set(storeKey, set);
    }
    set.add(key);
  }
}

export interface UniqueRetryResult {
  row: Record<string, unknown>;
  accepted: boolean;
}

export function enforceUniqueRow(
  row: Record<string, unknown>,
  uniqueConstraints: string[][],
  ctx: UniqueContext,
  columnRegistry: Array<{ name: string; generator: GeneratorSpec }>,
  pkCache: Map<string, unknown[]>,
  tableSchema: TableSchema,
  tablePlan: GenerationPlan['tables'][string],
  genCtx: { table: string; rowIndex: number; rootSeed: number },
  retryLimit: number,
): UniqueRetryResult {
  let violation = checkUnique(row, uniqueConstraints, ctx);
  if (!violation) {
    return { row, accepted: true };
  }

  const colsInViolation = new Set<string>();
  for (const v of violation) {
    for (const c of v) colsInViolation.add(c);
  }

  for (let attempt = 0; attempt < retryLimit; attempt++) {
    for (const col of colsInViolation) {
      const reg = columnRegistry.find((r) => r.name === col);
      if (!reg) continue;
      const retryPrng = deriveStream(
        String(genCtx.rootSeed),
        genCtx.table,
        '__row__',
        String(genCtx.rowIndex),
        '__unique__',
        col,
        String(attempt),
      );
      row[col] = generateFieldValue(
        reg.generator,
        row,
        retryPrng,
        pkCache,
        tableSchema,
        tablePlan,
        { table: genCtx.table, rowIndex: genCtx.rowIndex },
      );
    }

    violation = checkUnique(row, uniqueConstraints, ctx);
    if (!violation) {
      return { row, accepted: true };
    }
  }

  const colList = [...colsInViolation].join(', ');
  throw new GenerationError(
    genCtx.table,
    colList,
    `unique constraint violation on ${genCtx.table}(${colList}) after ${retryLimit} retries; ` +
    `the requested cardinality may be too large for the available unique values`,
  );
}
