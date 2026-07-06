import { MongoClient } from 'mongodb';
import type { GenerationBatch, WriteProgressEmitter } from '@seed-forge/core';
import type { RelationshipGraph, DatabaseSchema, WriteOptions, WriteResult, WriteProgressEvent } from '@seed-forge/core';

const DEFAULT_BATCH_SIZE = 5000;

export interface MongoWriteConfig {
  connectionString: string;
  database: string;
}

function getEmitter(options?: WriteOptions): WriteProgressEmitter | undefined {
  return options?.progressEmitter;
}

function getCallback(options?: WriteOptions): ((e: WriteProgressEvent) => void) | undefined {
  return options?.onProgress;
}

function emitProgress(event: WriteProgressEvent, options?: WriteOptions): void {
  getCallback(options)?.(event);
  getEmitter(options)?.emitProgress(event);
}

async function checkFresh(
  client: MongoClient,
  database: string,
  tables: DatabaseSchema['tables'],
  options?: WriteOptions,
): Promise<void> {
  const db = client.db(database);
  for (const table of tables) {
    const count = await db.collection(table.name).countDocuments();
    emitProgress({ table: table.name, phase: 'verify', rowsWritten: count, rowsTotal: 0 }, options);
    if (count > 0) {
      throw new Error(
        `Collection "${table.name}" has ${count} document(s) and is not empty. ` +
        `Use mode='truncate' to clear it first, or mode='append' to add data.`,
      );
    }
  }
}

async function truncateCollections(
  client: MongoClient,
  database: string,
  order: string[],
  options?: WriteOptions,
): Promise<void> {
  const db = client.db(database);
  for (let i = order.length - 1; i >= 0; i--) {
    const name = order[i]!;
    await db.collection(name).deleteMany({});
    emitProgress({ table: name, phase: 'truncate', rowsWritten: 0, rowsTotal: 0 }, options);
  }
}

export async function write(
  config: MongoWriteConfig,
  batches: AsyncIterable<GenerationBatch>,
  graph: RelationshipGraph,
  schema: DatabaseSchema,
  options?: WriteOptions,
): Promise<WriteResult> {
  const client = new MongoClient(config.connectionString);
  const startTime = Date.now();
  const rowsWritten: Record<string, number> = {};
  const mode = options?.mode ?? 'fresh';
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

  try {
    await client.connect();
    const db = client.db(config.database);

    if (mode === 'fresh') {
      await checkFresh(client, config.database, schema.tables, options);
    } else if (mode === 'truncate') {
      await truncateCollections(client, config.database, graph.insertionOrder, options);
    }

    options?.signal?.throwIfAborted();

    const patches: GenerationBatch[] = [];

    for await (const batch of batches) {
      options?.signal?.throwIfAborted();
      if (batch.phase === 'insert') {
        if (batch.rows.length === 0) continue;

        for (let i = 0; i < batch.rows.length; i += batchSize) {
          const chunk = batch.rows.slice(i, i + batchSize);
          await db.collection(batch.table).insertMany(chunk, { ordered: false });
        }

        rowsWritten[batch.table] = (rowsWritten[batch.table] ?? 0) + batch.rows.length;
        emitProgress({
          table: batch.table,
          phase: 'insert',
          rowsWritten: rowsWritten[batch.table]!,
          rowsTotal: rowsWritten[batch.table]!,
        }, options);
      } else if (batch.phase === 'patch') {
        patches.push(batch);
      }
    }

    options?.signal?.throwIfAborted();
    for (const patch of patches) {
      if (!patch.patchInfo) continue;
      const { patchColumn, pkColumn } = patch.patchInfo;

      for (const row of patch.rows) {
        await db.collection(patch.table).updateOne(
          { [pkColumn]: row[pkColumn] },
          { $set: { [patchColumn]: row[patchColumn] } },
        );
      }
    }
  } finally {
    await client.close();
  }

  return { rowsWritten, elapsedMs: Date.now() - startTime };
}
