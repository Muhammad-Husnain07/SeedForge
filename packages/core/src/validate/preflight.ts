import type { DatabaseSchema, TableSchema } from '../types/index.js';
import type { GenerationPlan, DistributionSpec } from '../config/types.js';
import type { GeneratorSpec } from '../semantic/types.js';
import type { RelationshipGraph } from '../graph/graph.js';
import type { PreFlightResult, ValidationEntry, PreFlightOptions } from './types.js';

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

function estimateDistinctValues(generator: GeneratorSpec): number | null {
  const { kind, params } = generator;

  switch (kind) {
    case 'uuid':
      return Infinity;

    case 'bounded-integer':
    case 'uniformInt': {
      const min = (params.min as number) ?? 0;
      const max = (params.max as number) ?? 100;
      return max - min + 1;
    }

    case 'paretoInt':
    case 'pareto': {
      const min = (params.min as number) ?? 1;
      const max = (params.max as number) ?? 100;
      return max - min + 1;
    }

    case 'boolean':
    case 'boolean-skewed':
      return 2;

    case 'weighted-categorical': {
      const values = params.values as Record<string, number> | undefined;
      if (values) return Object.keys(values).length;
      const enumVals = params.enumValues as string[] | undefined;
      if (enumVals) return enumVals.length;
      return null;
    }

    case 'faker': {
      const method = params.method as string | undefined;
      if (method === 'string.alphanumeric') {
        const length = (params.length as number) ?? 8;
        const casing = params.casing as string | undefined;
        const alphabetSize = casing === 'upper' ? 36 : 62;
        return Math.min(Math.pow(alphabetSize, length), Number.MAX_SAFE_INTEGER);
      }
      if (method === 'number.int') {
        const min = (params.min as number) ?? 0;
        const max = (params.max as number) ?? 100;
        return max - min + 1;
      }
      return null;
    }

    case 'recent-timestamp':
    case 'dependent-timestamp':
      return 1_000_000;

    case 'uniformReal':
    case 'log-normal-currency':
    case 'lat-lng-pair':
      return Infinity;

    default:
      return null;
  }
}

function getGeneratorValues(generator: GeneratorSpec): string[] | null {
  if (generator.kind !== 'weighted-categorical') return null;

  const values = generator.params.values;
  const enumVals = generator.params.enumValues as string[] | undefined;

  if (values !== undefined) {
    if (Array.isArray(values)) {
      return values as string[];
    }
    if (typeof values === 'object' && values !== null) {
      return Object.keys(values);
    }
  }

  if (enumVals) return enumVals;

  return null;
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

function computeTableCounts(plan: GenerationPlan, schema: DatabaseSchema): Map<string, number> {
  const counts = new Map<string, number>();
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
        const parentCount = counts.get(parentName) ?? 10;
        const perParent = getDistributionUpperBound(dist);
        total += parentCount * perParent;
      }
      counts.set(tableName, Math.max(1, total));
    } else {
      const c = getDistributionUpperBound(tablePlan.count);
      counts.set(tableName, c);
    }
  }

  return counts;
}

export function validatePreFlight(
  plan: GenerationPlan,
  schema: DatabaseSchema,
  graph: RelationshipGraph,
  options?: PreFlightOptions,
): PreFlightResult {
  const entries: ValidationEntry[] = [];
  const schemaMap = new Map(schema.tables.map((t) => [t.name, t]));
  const tableCounts = computeTableCounts(plan, schema);
  const orderIndex = new Map(graph.insertionOrder.map((name, i) => [name, i]));

  for (const [tableName, tablePlan] of Object.entries(plan.tables)) {
    const tableSchema = schemaMap.get(tableName);
    if (!tableSchema) continue;

    const colMap = new Map(tableSchema.columns.map((c) => [c.name, c]));
    const resolvedMap = new Map(tablePlan.fields.map((f) => [f.column, f]));

    // ── Check 1: NOT NULL ────────────────────────────────────────────────
    for (const col of tableSchema.columns) {
      if (!col.nullable) {
        const np = options?.nullProbability ?? 0;
        if (np > 0) {
          entries.push(
            entry(
              tableName,
              col.name,
              'not-null',
              'fail',
              `Column '${tableName}.${col.name}' is NOT NULL but global nullProbability=${np} > 0 would inject nulls. Set nullProbability=0 or remove it.`,
            ),
          );
        } else {
          entries.push(passEntry(tableName, col.name, 'not-null'));
        }
      }
    }

    // ── Check 2: Enum / CHECK values ──────────────────────────────────────
    for (const col of tableSchema.columns) {
      const resolved = resolvedMap.get(col.name);
      if (!resolved) continue;

      const generator = resolved.generator;
      const allowedValues: string[] = [];

      if (col.logicalType === 'enum' && col.enumValues && col.enumValues.length > 0) {
        allowedValues.push(...col.enumValues);
      }

      if (col.logicalType === 'integer' && tableSchema.checkConstraints) {
        for (const cc of tableSchema.checkConstraints) {
          const inMatch = cc.expression.match(
            new RegExp(`\\b${col.name}\\s+IN\\s*\\(([^)]+)\\)`, 'i'),
          );
          if (inMatch) {
            const vals = inMatch[1]!.split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
            allowedValues.push(...vals);
          }
        }
      }

      if (allowedValues.length === 0) continue;

      const candidateValues = getGeneratorValues(generator);

      if (candidateValues !== null) {
        const badValues = candidateValues.filter((v) => !allowedValues.includes(v));
        if (badValues.length > 0) {
          entries.push(
            entry(
              tableName,
              col.name,
              'enum-values',
              'fail',
              `Column '${tableName}.${col.name}' has allowed values [${allowedValues.join(', ')}] but generator '${generator.kind}' produces values [${badValues.join(', ')}] which are not in the allowed set.`,
            ),
          );
        } else {
          entries.push(passEntry(tableName, col.name, 'enum-values'));
        }
      } else {
        // For bounded-integer against enum/check, check min/max against allowed
        if (
          (generator.kind === 'bounded-integer' || generator.kind === 'uniformInt') &&
          col.logicalType === 'integer' &&
          allowedValues.length > 0
        ) {
          const genMin = (generator.params.min as number) ?? 0;
          const genMax = (generator.params.max as number) ?? 100;
          const numericAllowed = allowedValues.map(Number).filter((n) => !isNaN(n));
          if (numericAllowed.length > 0) {
            const allowedMin = Math.min(...numericAllowed);
            const allowedMax = Math.max(...numericAllowed);
            if (genMin < allowedMin || genMax > allowedMax) {
              entries.push(
                entry(
                  tableName,
                  col.name,
                  'enum-values',
                  'fail',
                  `Column '${tableName}.${col.name}' has allowed values [${allowedValues.join(', ')}] but generator '${generator.kind}' produces range [${genMin}..${genMax}] which extends outside the allowed set.`,
                ),
              );
            } else {
              entries.push(passEntry(tableName, col.name, 'enum-values'));
            }
          }
        }
      }
    }

    // ── Check 3: Unique cardinality ───────────────────────────────────────
    const rowCount = tableCounts.get(tableName) ?? 10;

    for (const col of tableSchema.columns) {
      const isUnique =
        col.isUnique ||
        tableSchema.uniqueConstraints.some(
          (uc) => uc.length === 1 && uc[0] === col.name,
        );
      if (!isUnique) continue;

      const resolved = resolvedMap.get(col.name);

      let generator: GeneratorSpec;
      if (resolved) {
        generator = resolved.generator;
      } else {
        continue;
      }

      const est = estimateDistinctValues(generator);

      if (est !== null && est < rowCount) {
        const ratio = est / rowCount;
        const status: ValidationEntry['status'] = ratio < 0.1 ? 'fail' : 'warn';
        entries.push(
          entry(
            tableName,
            col.name,
            'unique-cardinality',
            status,
            `Column '${tableName}.${col.name}' has a unique constraint but its generator '${generator.kind}' produces only ~${est} distinct values, yet ${rowCount} rows are requested. This will likely cause a unique constraint violation at generation time.`,
          ),
        );
      } else {
        entries.push(passEntry(tableName, col.name, 'unique-cardinality'));
      }
    }

    // ── Check 4: FK insertion order ──────────────────────────────────────
    for (const fk of tableSchema.foreignKeys) {
      if (fk.referencedTable === tableName) continue; // self-referential

      const refIdx = orderIndex.get(fk.referencedTable);
      const tableIdx = orderIndex.get(tableName);

      if (refIdx === undefined || tableIdx === undefined) continue;

      if (refIdx >= tableIdx) {
        entries.push(
          entry(
            tableName,
            fk.columns[0],
            'fk-ordering',
            'fail',
            `Foreign key '${tableName}.${fk.columns[0]}' references '${fk.referencedTable}' which appears at position ${refIdx}, after '${tableName}' at position ${tableIdx} in the insertion order. The referenced table must be generated first.`,
          ),
        );
      } else {
        entries.push(
          passEntry(tableName, fk.columns[0], 'fk-ordering'),
        );
      }
    }
  }

  const valid = !entries.some((e) => e.status === 'fail');
  return { valid, entries };
}
