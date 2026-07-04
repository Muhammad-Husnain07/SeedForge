import type { DatabaseSchema } from '../types/index.js';
import type { GenerationPlan, DistributionSpec } from '../config/types.js';
import type { PostWriteResult, ValidationEntry, VerifyOptions } from './types.js';

function entry(
  table: string,
  column: string | undefined,
  rule: ValidationEntry['rule'],
  status: ValidationEntry['status'],
  message?: string,
): ValidationEntry {
  return { table, column, rule, status, message };
}

function passEntry(table: string, column: string | undefined, rule: ValidationEntry['rule']): ValidationEntry {
  return { table, column, rule, status: 'pass' };
}

function getDistributionUpperBound(dist: number | DistributionSpec): number {
  if (typeof dist === 'number') return dist;
  switch (dist.kind) {
    case 'uniformInt':
    case 'paretoInt':
    case 'pareto':
      return (dist.params.max as number) ?? 100;
    case 'exponential':
      return 50;
    default:
      return 10;
  }
}

function computeExpectedCounts(
  plan: GenerationPlan,
  schema: DatabaseSchema,
  actualRowCounts: Map<string, number>,
): Map<string, number> {
  const expected = new Map<string, number>();
  const schemaMap = new Map(schema.tables.map((t) => [t.name, t]));

  for (const [tableName, tablePlan] of Object.entries(plan.tables)) {
    const tableSchema = schemaMap.get(tableName);
    if (!tableSchema) continue;

    const nonSelfFKs = tableSchema.foreignKeys.filter((fk) => fk.referencedTable !== tableName);
    const hasCountPerParent =
      tablePlan.countPerParent && Object.keys(tablePlan.countPerParent).length > 0;

    if (nonSelfFKs.length > 0 && hasCountPerParent) {
      let total = 0;
      for (const [parentName, dist] of Object.entries(tablePlan.countPerParent)) {
        const parentCount = actualRowCounts.get(parentName) ?? 0;
        const perParent = getDistributionUpperBound(dist);
        total += parentCount * perParent;
      }
      expected.set(tableName, Math.max(1, total));
    } else {
      const c = getDistributionUpperBound(tablePlan.count);
      expected.set(tableName, c);
    }
  }

  return expected;
}

function sampleArray<T>(arr: T[], sampleSize: number): T[] {
  if (arr.length <= sampleSize) return [...arr];
  const indices = new Set<number>();
  while (indices.size < sampleSize) {
    indices.add(Math.floor(Math.random() * arr.length));
  }
  return [...indices].map((i) => arr[i]!);
}

function detectJunctionTable(tableSchema: DatabaseSchema['tables'][number]): boolean {
  if (tableSchema.foreignKeys.length !== 2) return false;
  const fkCols = new Set(tableSchema.foreignKeys.flatMap((fk) => fk.columns));
  const pkSet = new Set(tableSchema.primaryKey);
  const isCompositePk = tableSchema.primaryKey.length >= 2;
  const fkFormPk = isCompositePk && fkCols.size === pkSet.size &&
    [...fkCols].every((c) => pkSet.has(c));
  if (!fkFormPk) return false;
  const keyCols = new Set([...tableSchema.primaryKey, ...tableSchema.foreignKeys.flatMap((fk) => fk.columns)]);
  const timestampCols = new Set(['created_at', 'createdAt', 'updated_at', 'updatedAt']);
  for (const col of tableSchema.columns) {
    if (keyCols.has(col.name)) continue;
    if (timestampCols.has(col.name)) continue;
    return false;
  }
  return true;
}

export function verifyPostWrite(
  plan: GenerationPlan,
  schema: DatabaseSchema,
  rowsByTable: Record<string, Record<string, unknown>[]>,
  options?: VerifyOptions,
): PostWriteResult {
  const entries: ValidationEntry[] = [];
  const sampleSize = options?.sampleSize ?? 50;
  const schemaMap = new Map(schema.tables.map((t) => [t.name, t]));

  // ── Check 1: Row counts ────────────────────────────────────────────────
  const actualRowCounts = new Map<string, number>();
  for (const [tableName] of Object.entries(plan.tables)) {
    actualRowCounts.set(tableName, (rowsByTable[tableName] ?? []).length);
  }

  const expectedCounts = computeExpectedCounts(plan, schema, actualRowCounts);

  for (const [tableName] of Object.entries(plan.tables)) {
    const expected = expectedCounts.get(tableName) ?? 0;
    const actual = actualRowCounts.get(tableName) ?? 0;

    if (actual !== expected) {
      entries.push(
        entry(
          tableName,
          undefined,
          'row-count',
          'fail',
          `Table '${tableName}' expected ${expected} rows but got ${actual}.`,
        ),
      );
    } else {
      entries.push(passEntry(tableName, undefined, 'row-count'));
    }
  }

  // ── Check 2: FK references ──────────────────────────────────────────────
  for (const tableSchema of schema.tables) {
    const nonSelfFKs = tableSchema.foreignKeys.filter(
      (fk) => fk.referencedTable !== tableSchema.name,
    );
    if (nonSelfFKs.length === 0) continue;

    const tableRows = rowsByTable[tableSchema.name] ?? [];

    for (const fk of nonSelfFKs) {
      const fkCol = fk.columns[0]!;
      const parentRows = rowsByTable[fk.referencedTable] ?? [];
      const parentPKCol = schemaMap.get(fk.referencedTable)?.primaryKey[0];
      if (!parentPKCol) {
        entries.push(
          entry(
            tableSchema.name,
            fkCol,
            'fk-reference',
            'fail',
            `Cannot verify FK '${tableSchema.name}.${fkCol}' -> '${fk.referencedTable}': parent table has no primary key.`,
          ),
        );
        continue;
      }

      const parentPKs = new Set(
        parentRows.map((r) => JSON.stringify(r[parentPKCol])),
      );

      const sample = sampleArray(tableRows, sampleSize);
      let brokenCount = 0;

      for (const row of sample) {
        const val = row[fkCol];
        if (val == null) {
          const colSchema = tableSchema.columns.find((c) => c.name === fkCol);
          if (colSchema && !colSchema.nullable) {
            brokenCount++;
          }
          continue;
        }
        if (!parentPKs.has(JSON.stringify(val))) {
          brokenCount++;
        }
      }

      if (brokenCount > 0) {
        entries.push(
          entry(
            tableSchema.name,
            fkCol,
            'fk-reference',
            'fail',
            `Table '${tableSchema.name}' column '${fkCol}' has ${brokenCount} unresolvable FK references in a sample of ${sample.length} (referencing '${fk.referencedTable}').`,
          ),
        );
      } else {
        entries.push(passEntry(tableSchema.name, fkCol, 'fk-reference'));
      }
    }
  }

  // ── Check 3: Junction table orphans ─────────────────────────────────────
  for (const tableSchema of schema.tables) {
    if (!detectJunctionTable(tableSchema)) continue;

    const tableRows = rowsByTable[tableSchema.name] ?? [];

    for (const fk of tableSchema.foreignKeys) {
      const fkCol = fk.columns[0]!;
      const parentRows = rowsByTable[fk.referencedTable] ?? [];
      const parentPKCol = schemaMap.get(fk.referencedTable)?.primaryKey[0];
      if (!parentPKCol) continue;

      const parentPKs = new Set(
        parentRows.map((r) => JSON.stringify(r[parentPKCol])),
      );

      const sample = sampleArray(tableRows, sampleSize);
      let orphanCount = 0;

      for (const row of sample) {
        const val = row[fkCol];
        if (val != null && !parentPKs.has(JSON.stringify(val))) {
          orphanCount++;
        }
      }

      if (orphanCount > 0) {
        entries.push(
          entry(
            tableSchema.name,
            fkCol,
            'junction-orphan',
            'fail',
            `Junction table '${tableSchema.name}' column '${fkCol}' has ${orphanCount} orphaned values in a sample of ${sample.length} (referencing '${fk.referencedTable}').`,
          ),
        );
      } else {
        entries.push(passEntry(tableSchema.name, fkCol, 'junction-orphan'));
      }
    }
  }

  const valid = !entries.some((e) => e.status === 'fail');
  return { valid, entries };
}
