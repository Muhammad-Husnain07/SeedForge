import type { RelationshipGraph } from '../graph/graph.js';
import type { DatabaseSchema } from '../types/index.js';
import type { TableSchema } from '../types/index.js';
import type { GenerationPlan, ResolvedField, ParentTimelineCtx } from '../config/types.js';
import type { GeneratorSpec } from '../semantic/types.js';
import { deriveStream } from '../distributions/prng.js';
import { assignPersona } from '../distributions/persona.js';
import type { Persona } from '../distributions/persona.js';
import type { GenerateOptions, GenerationBatch } from './types.js';
import { generateFieldValue } from './fields.js';
import { enforceUniqueRow, registerUnique } from './unique.js';
import type { UniqueContext } from './unique.js';
import { assignParents } from './parent.js';
import { computeTimelineInfo, rowTimestamp, churnTimestamp } from './timeline.js';

interface FieldEntry {
  name: string;
  generator: GeneratorSpec;
  dependsOn?: string;
}

function sortFieldsByDependency(fields: ResolvedField[]): FieldEntry[] {
  const entries: FieldEntry[] = fields.map((f) => {
    const dependsOn = (f.generator.params?.dependsOn as string | undefined) ?? undefined;
    return { name: f.column, generator: f.generator, dependsOn };
  });

  const sorted: FieldEntry[] = [];
  const remaining = [...entries];
  const inResult = new Set<string>();

  while (remaining.length > 0) {
    const batch = remaining.filter(
      (e) => !e.dependsOn || inResult.has(e.dependsOn),
    );
    if (batch.length === 0) {
      sorted.push(...remaining);
      break;
    }
    for (const b of batch) {
      sorted.push(b);
      inResult.add(b.name);
      const idx = remaining.indexOf(b);
      if (idx !== -1) remaining.splice(idx, 1);
    }
  }

  return sorted;
}

function nullableProbability(col: { nullable: boolean; logicalType: string }): number {
  if (!col.nullable) return 0;
  switch (col.logicalType) {
    case 'boolean': return 0.05;
    case 'string': return 0.15;
    case 'float': return 0.1;
    case 'integer': return 0.1;
    case 'timestamp': return 0.05;
    case 'date': return 0.05;
    case 'uuid': return 0.02;
    default: return 0.15;
  }
}

export async function* generate(
  graph: RelationshipGraph,
  plan: GenerationPlan,
  schema: DatabaseSchema,
  seed: number,
  options?: GenerateOptions,
): AsyncGenerator<GenerationBatch> {
  const batchSize = options?.batchSize ?? 1000;
  const retryLimit = options?.uniqueRetryLimit ?? 50;
  const nullProb = options?.nullProbability ?? undefined;
  const plugins = options?.plugins ?? [];

  // Deterministic timestamp generation
  const origDateNow = Date.now;
  if (options?.refDate != null) {
    Date.now = () => options.refDate!;
  }

  try {
    // beforeGenerate hook
    for (const { plugin } of plugins) {
      if (plugin.beforeGenerate) await plugin.beforeGenerate(plan);
    }

  const tableSchemaMap = new Map<string, TableSchema>();
  for (const t of schema.tables) tableSchemaMap.set(t.name, t);

  const pkCache = new Map<string, unknown[]>();
  const uniqueCtx: UniqueContext = { existingKeys: new Map() };

  const selfRefTables = new Set<string>();
  if (graph.cycles) {
    for (const cycle of graph.cycles) {
      if (cycle.length === 1) selfRefTables.add(cycle[0]!);
    }
  }

  const cascadeMap = new Map<string, Map<string, number[]>>();
  const parentTimelineCtxMap = new Map<string, Map<number, ParentTimelineCtx>>();

  for (const tableName of graph.insertionOrder) {
    const tableSchema = tableSchemaMap.get(tableName);
    const tablePlan = plan.tables[tableName];
    if (!tableSchema || !tablePlan) {
      continue;
    }

    const parentCascades = cascadeMap.get(tableName);
    const parentCtxForChildren = parentTimelineCtxMap.get(tableName);
    const assignments = assignParents(
      tableName,
      tableSchema,
      tablePlan,
      pkCache,
      seed,
      parentCascades,
      parentCtxForChildren,
    );

    const fieldOrder = sortFieldsByDependency(tablePlan.fields);
    const columnRegistry = fieldOrder.map((f) => ({ name: f.name, generator: f.generator }));

    const pkColumns = tableSchema.primaryKey;
    const pkColumn = pkColumns[0];
    const generatedPKs: unknown[] = [];

    const selfRefFK = tableSchema.foreignKeys.find(
      (fk) => fk.referencedTable === tableName,
    );
    const selfRefCol = selfRefFK?.columns[0];

    // NEW: pre-compute timeline info if configured
    const timelineInfo = tablePlan.timeline ? computeTimelineInfo(tablePlan.timeline, options?.refDate) : null;

    let buffer: Record<string, unknown>[] = [];

    for (let i = 0; i < assignments.totalCount; i++) {
      const row: Record<string, unknown> = {};

      if (assignments.bindings.length > i) {
        const binding = assignments.bindings[i]!;
        for (const [col, val] of Object.entries(binding.bindings)) {
          row[col] = val;
        }
      }

      let activePersona: Persona | null = null;
      let rowAcquiredAt: number | undefined;
      let rowChurnedAt: number | undefined;

      if (tablePlan.personas.length > 0) {
        const personaPrng = deriveStream(String(seed), tableName, '__persona__', String(i));
        activePersona = assignPersona(personaPrng, { personas: tablePlan.personas });

        if (activePersona?.cascades) {
          for (const [childTable, multiplier] of Object.entries(activePersona.cascades)) {
            if (!cascadeMap.has(tableName)) cascadeMap.set(tableName, new Map());
            const tableCascades = cascadeMap.get(tableName)!;
            if (!tableCascades.has(childTable)) tableCascades.set(childTable, []);
            const arr = tableCascades.get(childTable)!;
            while (arr.length <= i) arr.push(1);
            arr[i] = multiplier;
          }
        }
      }

      // NEW: timeline row positioning
      if (timelineInfo) {
        const tlPrng = deriveStream(String(seed), tableName, '__timeline__', String(i));
        rowAcquiredAt = rowTimestamp(i, assignments.totalCount, timelineInfo, tlPrng);
        const tsCol = tableSchema.columns.find((c) => c.name === 'created_at')?.name
          ?? tableSchema.columns.find((c) => c.name === 'createdAt')?.name;
        if (tsCol) row[tsCol] = new Date(rowAcquiredAt);
      }

      // NEW: churn computation
      const churnRate = activePersona?.churn?.monthlyRate ?? tablePlan.churn?.monthlyRate;
      if (churnRate && rowAcquiredAt) {
        const churnPrng = deriveStream(String(seed), tableName, '__churn__', String(i));
        rowChurnedAt = churnTimestamp(rowAcquiredAt, churnRate, timelineInfo!.endMs, churnPrng);
        const deactCol = tableSchema.columns.find((c) => c.name === 'deactivated_at')?.name
          ?? tableSchema.columns.find((c) => c.name === 'deleted_at')?.name
          ?? tableSchema.columns.find((c) => c.name === 'deactivatedAt')?.name;
        if (deactCol) row[deactCol] = new Date(rowChurnedAt);
      }

      // Store timeline context for children
      if (rowAcquiredAt) {
        if (!parentTimelineCtxMap.has(tableName)) parentTimelineCtxMap.set(tableName, new Map());
        const ctxMap = parentTimelineCtxMap.get(tableName)!;
        ctxMap.set(i, { acquiredAt: rowAcquiredAt, churnedAt: rowChurnedAt });
      }

      for (const field of fieldOrder) {
        if (row[field.name] !== undefined) continue;

        const personaOverride = activePersona?.overrides.find(
          (o) => o.field === field.name,
        );

        let generator: GeneratorSpec;
        if (personaOverride?.value !== undefined) {
          row[field.name] = personaOverride.value;
          continue;
        } else if (personaOverride?.generator) {
          generator = personaOverride.generator;
        } else {
          generator = field.generator;
        }

        const fieldPrng = deriveStream(
          String(seed),
          tableName,
          '__row__',
          String(i),
          field.name,
        );

        row[field.name] = generateFieldValue(
          generator,
          row,
          fieldPrng,
          pkCache,
          tableSchema,
          tablePlan,
          { table: tableName, rowIndex: i },
        );
      }

      for (const col of tableSchema.columns) {
        if (row[col.name] === undefined) {
          const np = nullProb ?? nullableProbability(col);
          if (np > 0) {
            const nullPrng = deriveStream(
              String(seed),
              tableName,
              '__nullable__',
              col.name,
              String(i),
            );
            if (nullPrng.next() < np) {
              row[col.name] = null;
            }
          }
        }
      }

      if (tablePlan.overrides && i < tablePlan.overrides.length) {
        const overrideRow = tablePlan.overrides[i]!;
        for (const [col, val] of Object.entries(overrideRow)) {
          row[col] = val;
        }
      }

      if (selfRefCol) {
        row[selfRefCol] = null;
      }

      const uniqueResult = enforceUniqueRow(
        row,
        tableSchema.uniqueConstraints,
        uniqueCtx,
        columnRegistry,
        pkCache,
        tableSchema,
        tablePlan,
        { table: tableName, rowIndex: i, rootSeed: seed },
        retryLimit,
      );

      const finalRow = uniqueResult.row;
      registerUnique(finalRow, tableSchema.uniqueConstraints, uniqueCtx);

      if (pkColumn) {
        const pkVal = finalRow[pkColumn];
        generatedPKs.push(pkVal);
      }

      buffer.push(finalRow);

      if (buffer.length >= batchSize) {
        const batch = { table: tableName, rows: buffer, phase: 'insert' as const };
        for (const { plugin } of plugins) {
          if (plugin.beforeInsert) await plugin.beforeInsert(tableName, buffer);
        }
        yield batch;
        for (const { plugin } of plugins) {
          if (plugin.afterInsert) await plugin.afterInsert(tableName, buffer);
        }
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      const batch = { table: tableName, rows: buffer, phase: 'insert' as const };
      for (const { plugin } of plugins) {
        if (plugin.beforeInsert) await plugin.beforeInsert(tableName, buffer);
      }
      yield batch;
      for (const { plugin } of plugins) {
        if (plugin.afterInsert) await plugin.afterInsert(tableName, buffer);
      }
    }

    pkCache.set(tableName, generatedPKs);
  }

  // afterGenerate hook — now passes metadata, not the full dataset
  let totalRows = 0;
  for (const pks of pkCache.values()) totalRows += pks.length;
  for (const { plugin } of plugins) {
    if (plugin.afterGenerate) await plugin.afterGenerate({ tables: [...tableSchemaMap.keys()], totalRows });
  }

  for (const selfRefTable of selfRefTables) {
    const tableSchema = tableSchemaMap.get(selfRefTable);
    const tablePlan = plan.tables[selfRefTable];
    if (!tableSchema || !tablePlan) continue;

    const pks = pkCache.get(selfRefTable);
    if (!pks || pks.length === 0) continue;

    const selfRefFK = tableSchema.foreignKeys.find(
      (fk) => fk.referencedTable === selfRefTable,
    );
    if (!selfRefFK) continue;

    const patchCol = selfRefFK.columns[0]!;
    const pkCol = tableSchema.primaryKey[0];

    const patchBuffer: Record<string, unknown>[] = [];

    for (let i = 0; i < pks.length; i++) {
      const patchPrng = deriveStream(String(seed), selfRefTable, '__selfref__', String(i));
      let targetIdx = i;
      while (targetIdx === i && pks.length > 1) {
        targetIdx = Math.floor(patchPrng.next() * pks.length);
      }
      const targetPK = pks[targetIdx];

      patchBuffer.push({
        [pkCol!]: pks[i],
        [patchCol]: targetPK,
      });

      if (patchBuffer.length >= batchSize) {
        yield {
          table: selfRefTable,
          rows: patchBuffer,
          phase: 'patch',
          patchInfo: { patchColumn: patchCol, pkColumn: pkCol! },
        };
        patchBuffer.length = 0;
      }
    }

    if (patchBuffer.length > 0) {
      yield {
        table: selfRefTable,
        rows: patchBuffer,
        phase: 'patch',
        patchInfo: { patchColumn: patchCol, pkColumn: pkCol! },
      };
    }
  }
  } finally {
    if (options?.refDate != null) {
      Date.now = origDateNow;
    }
  }
}
