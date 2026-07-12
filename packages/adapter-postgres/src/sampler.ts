import pg from 'pg';
import type { PostgresIntrospectConfig } from './introspect.js';

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function sample(
  config: PostgresIntrospectConfig,
  tableName: string,
  maxRows?: number,
): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: config.connectionString });
  const client = await pool.connect();
  try {
    const limitClause = maxRows !== undefined ? `LIMIT ${maxRows}` : '';
    const sql = `SELECT * FROM ${quoteId(tableName)} ORDER BY RANDOM() ${limitClause}`;
    const result = await client.query(sql);
    return result.rows as Record<string, unknown>[];
  } finally {
    client.release();
    await pool.end();
  }
}
