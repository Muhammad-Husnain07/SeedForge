import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { GenerationBatch, WriteProgressEmitter } from '@seed-forge/core';
import type { RelationshipGraph, DatabaseSchema, WriteOptions, WriteResult, WriteProgressEvent } from '@seed-forge/core';

const DEFAULT_BATCH_SIZE = 5000;
const MAX_PARAMS = 32000;
const COPY_THRESHOLD = 500;

function formatCopyValue(val: unknown): string {
  if (val === null || val === undefined) return '\\N';
  if (typeof val === 'string') {
    if (val === '\\N') return '\\\\N';
    return val.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface PostgresWriteConfig {
  connectionString: string;
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

async function checkFresh(client: pg.ClientBase, tables: DatabaseSchema['tables'], options?: WriteOptions): Promise<void> {
  for (const table of tables) {
    const res = await client.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM ${quoteId(table.name)}`);
    const count = parseInt(res.rows[0]?.cnt ?? '0', 10);
    emitProgress({ table: table.name, phase: 'verify', rowsWritten: count, rowsTotal: 0 }, options);
    if (count > 0) {
      throw new Error(
        `Table "${table.name}" has ${count} row(s) and is not empty. ` +
        `Use mode='truncate' to clear it first, or mode='append' to add data.`,
      );
    }
  }
}

async function truncateTables(client: pg.ClientBase, order: string[], options?: WriteOptions): Promise<void> {
  for (let i = order.length - 1; i >= 0; i--) {
    const name = order[i]!;
    await client.query(`TRUNCATE TABLE ${quoteId(name)} CASCADE`);
    emitProgress({ table: name, phase: 'truncate', rowsWritten: 0, rowsTotal: 0 }, options);
  }
}

async function multiRowInsert(
  client: pg.ClientBase,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  batchSize: number = 1000,
): Promise<number> {
  const quotedCols = columns.map((c) => quoteId(c)).join(', ');
  let rowIdx = 0;
  let written = 0;

  while (rowIdx < rows.length) {
    const batchRows: Record<string, unknown>[] = [];
    let totalParams = 0;

    while (rowIdx < rows.length) {
      const needed = columns.length;
      if (totalParams + needed > MAX_PARAMS || batchRows.length >= batchSize) break;
      batchRows.push(rows[rowIdx]!);
      totalParams += needed;
      rowIdx++;
    }

    if (batchRows.length === 0) break;

    const params: unknown[] = [];
    const valueClauses: string[] = [];

    for (const row of batchRows) {
      const placeholders = columns.map((_, ci) => `$${params.length + ci + 1}`);
      valueClauses.push(`(${placeholders.join(', ')})`);
      for (const col of columns) {
        params.push(row[col] ?? null);
      }
    }

    const sql = `INSERT INTO ${quoteId(table)} (${quotedCols}) VALUES ${valueClauses.join(', ')}`;
    await client.query(sql, params);
    written += batchRows.length;
  }

  return written;
}

async function copyInsertPgCopyStreams(
  client: pg.ClientBase,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  const quotedCols = columns.map((c) => quoteId(c)).join(', ');
  const copyQuery = `COPY ${quoteId(table)} (${quotedCols}) FROM STDIN (FORMAT csv, DELIMITER E'\\t')`;

  return new Promise<number>((resolve, reject) => {
    const stream = client.query(copyFrom(copyQuery));
    let written = 0;

    for (const row of rows) {
      const line = columns.map((c) => formatCopyValue(row[c])).join('\t');
      stream.write(line + '\n');
      written++;
    }

    stream.end();

    stream.on('error', reject);
    stream.on('finish', () => resolve(written));
  });
}

async function applyPatchBatches(
  client: pg.ClientBase,
  patches: GenerationBatch[],
  _options?: WriteOptions,
): Promise<void> {
  for (const patch of patches) {
    if (!patch.patchInfo) continue;
    const { patchColumn, pkColumn } = patch.patchInfo;
    const quotedTable = quoteId(patch.table);
    const quotedPatchCol = quoteId(patchColumn);
    const quotedPkCol = quoteId(pkColumn);

    for (const row of patch.rows) {
      await client.query(
        `UPDATE ${quotedTable} SET ${quotedPatchCol} = $1 WHERE ${quotedPkCol} = $2`,
        [row[patchColumn] ?? null, row[pkColumn]],
      );
    }
  }
}

export async function write(
  config: PostgresWriteConfig,
  batches: AsyncIterable<GenerationBatch>,
  graph: RelationshipGraph,
  schema: DatabaseSchema,
  options?: WriteOptions,
): Promise<WriteResult> {
  const pool = new pg.Pool({ connectionString: config.connectionString });
  const client = await pool.connect();
  const startTime = Date.now();
  const rowsWritten: Record<string, number> = {};
  const mode = options?.mode ?? 'fresh';
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

  const patches: GenerationBatch[] = [];

  try {
    options?.signal?.throwIfAborted();
    await client.query('BEGIN');

    if (mode === 'fresh') {
      await checkFresh(client, schema.tables, options);
    } else if (mode === 'truncate') {
      await truncateTables(client, graph.insertionOrder, options);
    }

    for await (const batch of batches) {
      options?.signal?.throwIfAborted();
      if (batch.phase === 'insert') {
        if (batch.rows.length === 0) continue;
        const columns = Object.keys(batch.rows[0]!);
        let written = 0;

        if (batch.rows.length >= COPY_THRESHOLD) {
          written = await copyInsertPgCopyStreams(client, batch.table, columns, batch.rows);
        } else {
          written = await multiRowInsert(client, batch.table, columns, batch.rows, batchSize);
        }

        rowsWritten[batch.table] = (rowsWritten[batch.table] ?? 0) + written;
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
    await applyPatchBatches(client, patches, options);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  return { rowsWritten, elapsedMs: Date.now() - startTime };
}
