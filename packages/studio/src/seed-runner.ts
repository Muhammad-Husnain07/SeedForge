import type {
  GenerationBatch,
  GenerationPlan,
  RelationshipGraph,
  DatabaseSchema,
  WriteProgressEvent,
  WriteResult,
} from '@seed-forge/core';
import { generate, WriteProgressEmitter } from '@seed-forge/core';
import { eventBus } from './events.js';

export interface SeedRun {
  id: string;
  status: 'running' | 'done' | 'error';
  result?: WriteResult;
  error?: string;
}

const runs = new Map<string, SeedRun>();

export function getSeedRun(id: string): SeedRun | undefined {
  return runs.get(id);
}

export async function startSeedRun(
  id: string,
  dialect: string,
  writeConfig: Record<string, unknown>,
  batches: AsyncIterable<GenerationBatch>,
  graph: RelationshipGraph,
  schema: DatabaseSchema,
  mode: string,
  batchSize?: number,
): Promise<void> {
  const run: SeedRun = { id, status: 'running' };
  runs.set(id, run);

  try {
    const mod: WriteModule = await importWriteModule(dialect);
    const progressEmitter = new WriteProgressEmitter();

    progressEmitter.on('progress', (event: WriteProgressEvent) => {
      eventBus.emit('seed-progress', { runId: id, ...event });
    });

    const result: WriteResult = await mod.write(writeConfig, batches, graph, schema, {
      mode: mode as 'fresh' | 'truncate' | 'append',
      batchSize,
      progressEmitter,
    });

    run.status = 'done';
    run.result = result;
    eventBus.emit('seed-done', { runId: id, result });
  } catch (err) {
    run.status = 'error';
    run.error = (err as Error).message;
    eventBus.emit('seed-error', { runId: id, error: (err as Error).message });
  }
}

interface WriteModule {
  write: (
    writeConfig: Record<string, unknown>,
    batches: AsyncIterable<GenerationBatch>,
    graph: RelationshipGraph,
    schema: DatabaseSchema,
    options: { mode: 'fresh' | 'truncate' | 'append'; batchSize?: number; progressEmitter: WriteProgressEmitter },
  ) => Promise<WriteResult>;
}

async function importWriteModule(dialect: string): Promise<WriteModule> {
  switch (dialect) {
    case 'postgres': return import('@seed-forge/adapter-postgres');
    case 'mysql': return import('@seed-forge/adapter-mysql');
    case 'mongodb': return import('@seed-forge/adapter-mongodb');
    default: throw new Error(`Unknown dialect: ${dialect}`);
  }
}

export async function generatePreview(
  plan: GenerationPlan,
  schema: DatabaseSchema,
  graph: RelationshipGraph,
  seed: number,
  rowsPerTable: number,
): Promise<{ table: string; rows: Record<string, unknown>[] }[]> {
  const results: { table: string; rows: Record<string, unknown>[] }[] = [];
  const previewPlan: GenerationPlan = {
    tables: Object.fromEntries(
      Object.entries(plan.tables).map(([name, t]) => [
        name,
        { ...t, count: rowsPerTable },
      ]),
    ),
  };

  for await (const batch of generate(graph, previewPlan, schema, seed, { batchSize: rowsPerTable })) {
    let existing = results.find((r) => r.table === batch.table);
    if (!existing) {
      existing = { table: batch.table, rows: [] };
      results.push(existing);
    }
    existing.rows.push(...batch.rows);
  }
  return results;
}
