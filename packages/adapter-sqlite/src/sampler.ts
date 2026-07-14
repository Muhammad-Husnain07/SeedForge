import type { SQLiteIntrospectConfig } from './introspect.js';
import type { SqlJsStatic } from 'sql.js';

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

export async function sample(
  config: SQLiteIntrospectConfig,
  tableName: string,
  maxRows?: number,
): Promise<Record<string, unknown>[]> {
  const fs = await import('node:fs');
  const SQL = await getSQL();
  const buffer = fs.readFileSync(config.connectionString);
  const db = new SQL.Database(buffer);

  try {
    const limitClause = maxRows !== undefined ? `LIMIT ${maxRows}` : '';
    const sql = `SELECT * FROM "${tableName.replace(/"/g, '""')}" ORDER BY RANDOM() ${limitClause}`;
    const results = db.exec(sql);

    if (!results || results.length === 0) return [];
    const result = results[0];
    if (!result) return [];
    const vals = result.values;
    if (!vals || vals.length === 0) return [];
    const cols = result.columns;
    if (!cols) return [];

    return vals.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        obj[cols[i]!] = row[i];
      }
      return obj;
    });
  } finally {
    db.close();
  }
}
