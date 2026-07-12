import mysql from 'mysql2/promise';
import type { MysqlIntrospectConfig } from './introspect.js';

function quoteId(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

export async function sample(
  config: MysqlIntrospectConfig,
  tableName: string,
  maxRows?: number,
): Promise<Record<string, unknown>[]> {
  const conn = await mysql.createConnection(config.connectionString);
  try {
    const limitClause = maxRows !== undefined ? `LIMIT ${maxRows}` : '';
    const sql = `SELECT * FROM ${quoteId(tableName)} ORDER BY RAND() ${limitClause}`;
    const [rows] = await conn.query<mysql.RowDataPacket[]>(sql);
    return rows;
  } finally {
    await conn.end();
  }
}
