import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import type { RelationshipGraph } from '../graph/graph.js';
import type { DatabaseSchema } from '../types/index.js';
import type { TableSchema } from '../types/index.js';
import type { GenerationPlan } from '../config/types.js';
import type { GenerateOptions, GenerationBatch } from './types.js';
import { BoundedQueue } from './queue.js';
import { deriveStream } from '../distributions/prng.js';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function resolveWorkerScript(): string {
  // When running from source (src/generate/): ../../dist/generate/worker.js
  const distPath = path.resolve(__dirname, '../../dist/generate/worker.js');
  if (fs.existsSync(distPath)) return distPath;
  // When running from bundled dist (dist/): ./generate/worker.js
  const bundledPath = path.resolve(__dirname, './generate/worker.js');
  if (fs.existsSync(bundledPath)) return bundledPath;
  // Try older tsup flat output
  const flatDistPath = path.resolve(__dirname, '../../dist/worker.js');
  if (fs.existsSync(flatDistPath)) return flatDistPath;
  // Fallback: built .js in src dir
  const srcPath = path.resolve(__dirname, 'worker.js');
  if (fs.existsSync(srcPath)) return srcPath;
  throw new Error(
    'Cannot find worker script. Build core package first (pnpm --filter @seed-forge/core run build).',
  );
}

interface WorkerOutput {
  type: 'batch' | 'done' | 'error';
  table?: string;
  rows?: Record<string, unknown>[];
  phase?: 'insert';
  pks?: unknown[];
  message?: string;
  stack?: string;
}

/**
 * Generate rows with parallel workers per dependency level.
 * Tables at the same graph level are generated concurrently via worker_threads.
 * A bounded queue provides backpressure between generation and consumption.
 */
export async function* generateParallel(
  graph: RelationshipGraph,
  plan: GenerationPlan,
  schema: DatabaseSchema,
  seed: number,
  options?: GenerateOptions,
): AsyncGenerator<GenerationBatch> {
  const batchSize = options?.batchSize ?? 1000;
  const queueMaxBatches = options?.batchSize
    ? Math.max(10, Math.ceil(10000 / options.batchSize))
    : 10;
  const tableSchemaMap = new Map<string, TableSchema>();
  for (const t of schema.tables) tableSchemaMap.set(t.name, t);

  // PKs from completed levels, passed to workers for FK resolution
  const completedPKs = new Map<string, unknown[]>();

  const workerScript = resolveWorkerScript();

  for (const levelTables of graph.levels) {
    const queue = new BoundedQueue<GenerationBatch>(queueMaxBatches);
    const workers: Worker[] = [];
    const tableForWorker = new Map<Worker, string>();

    // Spawn one worker per table at this level
    for (const tableName of levelTables) {
      const tableSchema = tableSchemaMap.get(tableName);
      const tablePlan = plan.tables[tableName];
      if (!tableSchema || !tablePlan) continue;

      const parentPKs: Record<string, unknown[]> = {};
      for (const [parentTable, pks] of completedPKs) {
        parentPKs[parentTable] = pks;
      }

      let worker;
      try {
        worker = new Worker(workerScript, {
          workerData: {
            tableName,
            tableSchema,
            tablePlan,
            seed,
            parentPKs,
            batchSize,
            refDate: options?.refDate,
          },
          eval: false,
        });
      } catch {
        continue;
      }

      tableForWorker.set(worker, tableName);
      workers.push(worker);
    }

    if (workers.length === 0) continue;

    // Track completion status
    const pendingWorkers = new Set(workers);
    const workerPKs = new Map<Worker, unknown[]>();

    for (const worker of workers) {
      worker.on('message', (msg: WorkerOutput) => {
        if (msg.type === 'batch' && msg.table && msg.rows) {
          queue.push({
            table: msg.table,
            rows: msg.rows,
            phase: 'insert',
          }).catch((err) => {
            console.error('Queue push error:', err);
          });
        } else if (msg.type === 'done' && msg.pks) {
          workerPKs.set(worker, msg.pks);
          pendingWorkers.delete(worker);
          if (pendingWorkers.size === 0) {
            queue.close();
          }
        } else if (msg.type === 'error') {
          console.error(`Worker error: ${msg.message}\n${msg.stack}`);
          pendingWorkers.delete(worker);
          if (pendingWorkers.size === 0) {
            queue.close();
          }
        }
      });

      worker.on('error', (err) => {
        console.error(`Worker error event: ${err.message}`);
        pendingWorkers.delete(worker);
        if (pendingWorkers.size === 0) {
          queue.close();
        }
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker exited with code ${code}`);
        }
        pendingWorkers.delete(worker);
        if (pendingWorkers.size === 0) {
          queue.close();
        }
      });
    }

    // Yield batches from the queue as they arrive
    for await (const batch of queue) {
      yield batch;
    }

    // Collect PKs from completed workers
    for (const worker of workers) {
      const tableName = tableForWorker.get(worker);
      const pks = workerPKs.get(worker);
      if (pks && tableName) {
        completedPKs.set(tableName, pks);
      }
    }
  }

  // Handle self-referential FK patches (same as sequential generate)
  const selfRefTables = new Set<string>();
  if (graph.cycles) {
    for (const cycle of graph.cycles) {
      if (cycle.length === 1) selfRefTables.add(cycle[0]!);
    }
  }

  for (const selfRefTable of selfRefTables) {
    const tableSchema = tableSchemaMap.get(selfRefTable);
    const tablePlan = plan.tables[selfRefTable];
    if (!tableSchema || !tablePlan) continue;

    const pks = completedPKs.get(selfRefTable);
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
}
