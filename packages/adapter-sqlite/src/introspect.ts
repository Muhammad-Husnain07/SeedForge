import { normalizeSqliteType } from './normalize.js';
import type {
  ColumnSchema,
  TableSchema,
  ForeignKey,
  DatabaseSchema,
} from '@seed-forge/core';
import type { SqlJsStatic } from 'sql.js';

export interface SQLiteIntrospectConfig {
  connectionString: string;
}

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

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

interface CheckConstraint {
  name: string;
  expression: string;
}

function queryRows<T>(
  db: import('sql.js').Database,
  sql: string,
): T[] {
  const results = db.exec(sql);
  if (!results || results.length === 0) return [];
  const result = results[0];
  if (!result) return [];
  const vals = result.values;
  if (!vals || vals.length === 0) return [];
  const cols = result.columns;
  if (!cols) return [];
  const rows: T[] = [];
  for (const rowVals of vals) {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      obj[cols[i]!] = rowVals[i];
    }
    rows.push(obj as unknown as T);
  }
  return rows;
}

function parseCheckConstraints(
  db: import('sql.js').Database,
  tableName: string,
): CheckConstraint[] {
  try {
    const rows = queryRows<{ sql: string }>(
      db,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName.replace(/'/g, "''")}'`,
    );
    if (rows.length === 0) return [];

    const ddl = rows[0]!.sql;
    if (!ddl) return [];

    const constraints: CheckConstraint[] = [];
    const checkRegex = /CONSTRAINT\s+(\S+)\s+CHECK\s*\(([^)]+)\)/gi;
    let match: RegExpExecArray | null;

    while ((match = checkRegex.exec(ddl)) !== null) {
      constraints.push({
        name: match[1]!,
        expression: match[2]!.trim(),
      });
    }

    const inlineCheckRegex = /CHECK\s*\(([^)]+)\)/gi;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = inlineCheckRegex.exec(ddl)) !== null) {
      const expr = inlineMatch[1]!.trim();
      const before = ddl.slice(0, inlineMatch.index);
      const alreadyNamed = /constraint\s+\S+\s+check\s*\(/i.test(
        before.slice(-60),
      );
      if (!alreadyNamed) {
        constraints.push({
          name: `${tableName}_check_${constraints.length}`,
          expression: expr,
        });
      }
    }

    return constraints;
  } catch {
    return [];
  }
}

export async function introspect(
  config: SQLiteIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const fs = await import('node:fs');
  const SQL = await getSQL();
  const buffer = fs.readFileSync(config.connectionString);
  const db = new SQL.Database(buffer);

  try {
    const tableRows = queryRows<{ name: string }>(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const tables: TableSchema[] = [];

    for (const tableRow of tableRows) {
      const tableName = tableRow.name;
      if (!tableName) continue;

      const columnsRaw = queryRows<TableInfoRow>(
        db,
        `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`,
      );

      const fkRows = queryRows<ForeignKeyListRow>(
        db,
        `PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`,
      );

      const indexRows = queryRows<IndexListRow>(
        db,
        `PRAGMA index_list("${tableName.replace(/"/g, '""')}")`,
      );

      const uniqueIndexCols = new Map<string, string[]>();

      for (const idx of indexRows) {
        if (idx.unique && idx.origin !== 'pk') {
          const idxName = idx.name;
          if (!idxName) continue;
          const infoRows = queryRows<IndexInfoRow>(
            db,
            `PRAGMA index_info("${idxName.replace(/"/g, '""')}")`,
          );
          uniqueIndexCols.set(
            idxName,
            infoRows.map((r) => r.name).filter((n): n is string => !!n),
          );
        }
      }

      const primaryKeyColumns = columnsRaw
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      const foreignKeys = buildForeignKeys(fkRows);

      const compositeUniqueConstraints: string[][] = [];
      for (const [, cols] of uniqueIndexCols) {
        const isPK =
          cols.length === primaryKeyColumns.length &&
          cols.every((c) => primaryKeyColumns.includes(c)) &&
          primaryKeyColumns.every((c) => cols.includes(c));
        if (!isPK) {
          compositeUniqueConstraints.push(cols);
        }
      }

      const singleUniqueCols = new Set<string>();
      for (const [, cols] of uniqueIndexCols) {
        if (cols.length === 1 && cols[0]) singleUniqueCols.add(cols[0]);
      }
      if (primaryKeyColumns.length === 1 && primaryKeyColumns[0]) {
        singleUniqueCols.add(primaryKeyColumns[0]);
      }

      const checkConstraints = parseCheckConstraints(db, tableName);

      const columns: ColumnSchema[] = columnsRaw.map((c) => ({
        name: c.name,
        logicalType: normalizeSqliteType(c.type),
        nativeType: c.type || 'BLOB',
        nullable:
          c.notnull === 0 && !primaryKeyColumns.includes(c.name),
        isPrimaryKey: primaryKeyColumns.includes(c.name),
        isUnique: singleUniqueCols.has(c.name),
        defaultValue:
          c.dflt_value !== null ? c.dflt_value : undefined,
      }));

      tables.push({
        name: tableName,
        columns,
        primaryKey: primaryKeyColumns,
        foreignKeys,
        uniqueConstraints: compositeUniqueConstraints,
        checkConstraints:
          checkConstraints.length > 0 ? checkConstraints : undefined,
      });
    }

    return {
      dialect: 'sqlite' as const,
      tables,
      introspectedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

function buildForeignKeys(fkRows: ForeignKeyListRow[]): ForeignKey[] {
  const groups = new Map<number, ForeignKeyListRow[]>();
  for (const row of fkRows) {
    const arr = groups.get(row.id) ?? [];
    arr.push(row);
    groups.set(row.id, arr);
  }

  const foreignKeys: ForeignKey[] = [];
  for (const [, rows] of groups) {
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.seq - b.seq);
    const first = rows[0];
    if (!first) continue;
    const fk: ForeignKey = {
      columns: rows.map((r) => r.from),
      referencedTable: first.table,
      referencedColumns: rows.map((r) => r.to),
    };
    if (first.on_delete !== 'NO ACTION') {
      fk.onDelete = first.on_delete;
    }
    if (first.on_update !== 'NO ACTION') {
      fk.onUpdate = first.on_update;
    }
    foreignKeys.push(fk);
  }
  return foreignKeys;
}
