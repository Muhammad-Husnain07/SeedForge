import mysql from 'mysql2/promise';
import type { GenerationBatch, WriteProgressEmitter } from '@seedforge/core';
import type { RelationshipGraph, DatabaseSchema, WriteOptions, WriteResult, WriteProgressEvent } from '@seedforge/core';

const DEFAULT_BATCH_SIZE = 1000;
const MAX_PLACEHOLDERS = 60000;

function quoteId(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

export interface MysqlWriteConfig {
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

async function checkFresh(
  conn: mysql.Connection,
  tables: DatabaseSchema['tables'],
  options?: WriteOptions,
): Promise<void> {
  for (const table of tables) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM ${quoteId(table.name)}`,
    );
    const count = Number((rows[0] as Record<string, unknown>)?.cnt ?? 0);
    emitProgress({ table: table.name, phase: 'verify', rowsWritten: count, rowsTotal: 0 }, options);
    if (count > 0) {
      throw new Error(
        `Table "${table.name}" has ${count} row(s) and is not empty. ` +
        `Use mode='truncate' to clear it first, or mode='append' to add data.`,
      );
    }
  }
}

async function truncateTables(
  conn: mysql.Connection,
  order: string[],
  options?: WriteOptions,
): Promise<void> {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (let i = order.length - 1; i >= 0; i--) {
    const name = order[i]!;
    await conn.query(`TRUNCATE TABLE ${quoteId(name)}`);
    emitProgress({ table: name, phase: 'truncate', rowsWritten: 0, rowsTotal: 0 }, options);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function multiRowInsert(
  conn: mysql.Connection,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  batchSize: number,
): Promise<number> {
  const quotedCols = columns.map((c) => quoteId(c)).join(', ');
  let rowIdx = 0;
  let written = 0;

  while (rowIdx < rows.length) {
    const batchRows: Record<string, unknown>[] = [];
    let totalPlaceholders = 0;

    while (rowIdx < rows.length) {
      const needed = columns.length;
      const byCount = batchRows.length + 1;
      if (totalPlaceholders + needed > MAX_PLACEHOLDERS || byCount > batchSize) break;
      batchRows.push(rows[rowIdx]!);
      totalPlaceholders += needed;
      rowIdx++;
    }

    if (batchRows.length === 0) break;

    const params: unknown[] = [];
    const valueClauses: string[] = [];

    for (const row of batchRows) {
      valueClauses.push(`(${columns.map(() => '?').join(', ')})`);
      for (const col of columns) {
        const val = row[col];
        if (val === null || val === undefined) {
          params.push(null);
        } else if (val instanceof Date) {
          params.push(val.toISOString().slice(0, 19).replace('T', ' '));
        } else if (typeof val === 'object') {
          params.push(JSON.stringify(val));
        } else {
          params.push(val);
        }
      }
    }

    const sql = `INSERT INTO ${quoteId(table)} (${quotedCols}) VALUES ${valueClauses.join(', ')}`;
    await conn.query(sql, params);
    written += batchRows.length;
  }

  return written;
}

async function applyPatchBatches(
  conn: mysql.Connection,
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
      await conn.query(
        `UPDATE ${quotedTable} SET ${quotedPatchCol} = ? WHERE ${quotedPkCol} = ?`,
        [row[patchColumn] ?? null, row[pkColumn]],
      );
    }
  }
}

export async function write(
  config: MysqlWriteConfig,
  batches: AsyncIterable<GenerationBatch>,
  graph: RelationshipGraph,
  schema: DatabaseSchema,
  options?: WriteOptions,
): Promise<WriteResult> {
  const conn = await mysql.createConnection(config.connectionString);
  const startTime = Date.now();
  const rowsWritten: Record<string, number> = {};
  const mode = options?.mode ?? 'fresh';
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

  const patches: GenerationBatch[] = [];

  try {
    if (mode === 'fresh') {
      await checkFresh(conn, schema.tables, options);
    } else if (mode === 'truncate') {
      await truncateTables(conn, graph.insertionOrder, options);
    }

    options?.signal?.throwIfAborted();
    await conn.query('START TRANSACTION');

    for await (const batch of batches) {
      options?.signal?.throwIfAborted();
      if (batch.phase === 'insert') {
        if (batch.rows.length === 0) continue;
        const columns = Object.keys(batch.rows[0]!);
        const written = await multiRowInsert(conn, batch.table, columns, batch.rows, batchSize);
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
    await applyPatchBatches(conn, patches, options);

    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    await conn.end();
  }

  return { rowsWritten, elapsedMs: Date.now() - startTime };
}
