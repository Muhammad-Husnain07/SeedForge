import type { GenerationBatch, WriteProgressEmitter } from '@seed-forge/core';
import type { RelationshipGraph, DatabaseSchema, WriteOptions, WriteResult, WriteProgressEvent } from '@seed-forge/core';
import type { SqlJsStatic } from 'sql.js';

const DEFAULT_BATCH_SIZE = 1000;
const MAX_VARIABLES = 999;

let _SQL: Promise<SqlJsStatic> | null = null;

async function getSQL(): Promise<SqlJsStatic> {
  if (!_SQL) {
    const mod = await import('sql.js');
    const initSqlJs = mod.default;
    _SQL = initSqlJs({
      locateFile: (file: string) =>
        new URL('./' + file, import.meta.url).href,
    });
  }
  return _SQL;
}

export interface SQLiteWriteConfig {
  connectionString: string;
}

function toSqlValue(val: unknown): number | string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return val;
  return null;
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

function checkFresh(
  db: import('sql.js').Database,
  tables: DatabaseSchema['tables'],
  options?: WriteOptions,
): void {
  for (const table of tables) {
    const results = db.exec(
      `SELECT COUNT(*) AS cnt FROM "${table.name.replace(/"/g, '""')}"`,
    );
    const count =
      results && results.length > 0 && results[0] && results[0].values && results[0].values.length > 0 && results[0].values[0]
        ? Number(results[0].values[0][0])
        : 0;
    emitProgress({ table: table.name, phase: 'verify', rowsWritten: count, rowsTotal: 0 }, options);
    if (count > 0) {
      throw new Error(
        `Table "${table.name}" has ${count} row(s) and is not empty. ` +
        `Use mode='truncate' to clear it first, or mode='append' to add data.`,
      );
    }
  }
}

function truncateTables(
  db: import('sql.js').Database,
  order: string[],
): void {
  db.run('PRAGMA foreign_keys = OFF');
  try {
    for (let i = order.length - 1; i >= 0; i--) {
      const name = order[i];
      if (name) {
        db.run(`DELETE FROM "${name.replace(/"/g, '""')}"`);
      }
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON');
  }
}

function multiRowInsert(
  db: import('sql.js').Database,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  batchSize: number,
): number {
  const quotedCols = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  let rowIdx = 0;
  let written = 0;

  while (rowIdx < rows.length) {
    const batchRows: Record<string, unknown>[] = [];
    let totalVariables = 0;

    while (rowIdx < rows.length) {
      const needed = columns.length;
      if (totalVariables + needed > MAX_VARIABLES || batchRows.length >= batchSize) break;
      batchRows.push(rows[rowIdx]!);
      totalVariables += needed;
      rowIdx++;
    }

    if (batchRows.length === 0) break;

    const params: (number | string | null)[] = [];
    const placeholders: string[] = [];

    for (const row of batchRows) {
      placeholders.push(`(${columns.map(() => '?').join(', ')})`);
      for (const col of columns) {
        params.push(toSqlValue(row[col]));
      }
    }

    const sql = `INSERT INTO "${table.replace(/"/g, '""')}" (${quotedCols}) VALUES ${placeholders.join(', ')}`;
    db.run(sql, params);
    written += batchRows.length;
  }

  return written;
}

function applyPatchBatches(
  db: import('sql.js').Database,
  patches: GenerationBatch[],
): void {
  for (const patch of patches) {
    if (!patch.patchInfo) continue;
    const { patchColumn, pkColumn } = patch.patchInfo;
    const quotedTable = `"${patch.table.replace(/"/g, '""')}"`;
    const quotedPatchCol = `"${patchColumn.replace(/"/g, '""')}"`;
    const quotedPkCol = `"${pkColumn.replace(/"/g, '""')}"`;

    for (const row of patch.rows) {
      db.run(
        `UPDATE ${quotedTable} SET ${quotedPatchCol} = ? WHERE ${quotedPkCol} = ?`,
        [toSqlValue(row[patchColumn]), toSqlValue(row[pkColumn])],
      );
    }
  }
}

export async function write(
  config: SQLiteWriteConfig,
  batches: AsyncIterable<GenerationBatch>,
  graph: RelationshipGraph,
  schema: DatabaseSchema,
  options?: WriteOptions,
): Promise<WriteResult> {
  const fs = await import('node:fs');
  const SQL = await getSQL();
  const startTime = Date.now();
  const rowsWritten: Record<string, number> = {};
  const mode = options?.mode ?? 'fresh';
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

  const patches: GenerationBatch[] = [];
  const buffer = fs.readFileSync(config.connectionString);
  const db = new SQL.Database(buffer);

  try {
    options?.signal?.throwIfAborted();

    if (mode === 'fresh') {
      checkFresh(db, schema.tables, options);
    } else if (mode === 'truncate') {
      truncateTables(db, graph.insertionOrder);
    }

    options?.signal?.throwIfAborted();
    db.run('BEGIN');

    try {
      for await (const batch of batches) {
        options?.signal?.throwIfAborted();
        if (batch.phase === 'insert') {
          if (batch.rows.length === 0) continue;
          const firstRow = batch.rows[0];
          if (!firstRow) continue;
          const columns = Object.keys(firstRow);
          const written = multiRowInsert(db, batch.table, columns, batch.rows, batchSize);
          const prev = rowsWritten[batch.table] ?? 0;
          rowsWritten[batch.table] = prev + written;
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
      applyPatchBatches(db, patches);

      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    fs.writeFileSync(config.connectionString, Buffer.from(db.export()));
  } finally {
    db.close();
  }

  return { rowsWritten, elapsedMs: Date.now() - startTime };
}
