import mysql from 'mysql2/promise';
import { normalizeMySqlType, parseMySqlEnumValues } from './normalize.js';
import type {
  ColumnSchema,
  TableSchema,
  ForeignKey,
  DatabaseSchema,
} from '@seedforge/core';

export interface MysqlIntrospectConfig {
  connectionString: string;
}

async function queryTableNames(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  return rows.map((r: any) => r.TABLE_NAME);
}

async function queryColumns(
  conn: mysql.Connection,
  tableName: string,
): Promise<
  {
    column_name: string;
    data_type: string;
    column_type: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: string;
    column_default: string | null;
  }[]
> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE,
            CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
            IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName],
  );
  return rows.map((r: any) => ({
    column_name: r.COLUMN_NAME,
    data_type: r.DATA_TYPE,
    column_type: r.COLUMN_TYPE,
    character_maximum_length: r.CHARACTER_MAXIMUM_LENGTH ?? null,
    numeric_precision: r.NUMERIC_PRECISION ?? null,
    numeric_scale: r.NUMERIC_SCALE ?? null,
    is_nullable: r.IS_NULLABLE,
    column_default: r.COLUMN_DEFAULT ?? null,
  }));
}

async function queryPrimaryKey(
  conn: mysql.Connection,
  tableName: string,
): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT kcu.COLUMN_NAME
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.CONSTRAINT_CATALOG = kcu.CONSTRAINT_CATALOG
      AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE tc.TABLE_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = ?
       AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
       AND kcu.TABLE_NAME = ?
     ORDER BY kcu.ORDINAL_POSITION`,
    [tableName, tableName],
  );
  return rows.map((r: any) => r.COLUMN_NAME);
}

async function queryForeignKeys(
  conn: mysql.Connection,
  tableName: string,
): Promise<ForeignKey[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
     FROM information_schema.key_column_usage kcu
     JOIN information_schema.referential_constraints rc
       ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
      AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
     WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
       AND kcu.TABLE_SCHEMA = DATABASE()
       AND kcu.TABLE_NAME = ?
     ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [tableName],
  );

  const groups = new Map<string, ForeignKey>();
  for (const row of rows) {
    const existing = groups.get(row.CONSTRAINT_NAME);
    if (existing) {
      existing.columns.push(row.COLUMN_NAME);
      existing.referencedColumns.push(row.REFERENCED_COLUMN_NAME);
    } else {
      groups.set(row.CONSTRAINT_NAME, {
        columns: [row.COLUMN_NAME],
        referencedTable: row.REFERENCED_TABLE_NAME,
        referencedColumns: [row.REFERENCED_COLUMN_NAME],
        onDelete: row.DELETE_RULE || undefined,
        onUpdate: row.UPDATE_RULE || undefined,
      });
    }
  }

  return Array.from(groups.values());
}

async function queryUniqueConstraints(
  conn: mysql.Connection,
  tableName: string,
): Promise<string[][]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT tc.CONSTRAINT_NAME, kcu.COLUMN_NAME
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.CONSTRAINT_CATALOG = kcu.CONSTRAINT_CATALOG
      AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE tc.TABLE_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = ?
       AND tc.CONSTRAINT_TYPE = 'UNIQUE'
     ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [tableName],
  );

  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const arr = groups.get(row.CONSTRAINT_NAME) ?? [];
    arr.push(row.COLUMN_NAME);
    groups.set(row.CONSTRAINT_NAME, arr);
  }

  return Array.from(groups.values());
}

async function queryCheckConstraints(
  conn: mysql.Connection,
  tableName: string,
): Promise<{ name: string; expression: string }[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON tc.CONSTRAINT_CATALOG = cc.CONSTRAINT_CATALOG
      AND tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
     WHERE tc.TABLE_SCHEMA = DATABASE()
       AND tc.TABLE_NAME = ?
       AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    [tableName],
  );
  return rows.map((r: any) => ({
    name: r.CONSTRAINT_NAME,
    expression: r.CHECK_CLAUSE,
  }));
}

export async function introspect(
  config: MysqlIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const conn = await mysql.createConnection(config.connectionString);

  try {
    const tableNames = await queryTableNames(conn);
    const tables: TableSchema[] = [];

    for (const tableName of tableNames) {
      const columnsRaw = await queryColumns(conn, tableName);
      const primaryKey = await queryPrimaryKey(conn, tableName);
      const foreignKeys = await queryForeignKeys(conn, tableName);
      const uniqueConstraints = await queryUniqueConstraints(conn, tableName);
      const checkConstraints = await queryCheckConstraints(conn, tableName);

      const allUniqueCols = new Set<string>();
      for (const uc of uniqueConstraints) {
        if (uc.length === 1) allUniqueCols.add(uc[0]!);
      }
      if (primaryKey.length === 1) allUniqueCols.add(primaryKey[0]!);

      const columns: ColumnSchema[] = columnsRaw.map((c) => {
        const isEnum = c.data_type?.toLowerCase() === 'enum';
        const logicalType = normalizeMySqlType(
          c.data_type,
          c.column_type,
          isEnum,
        );
        return {
          name: c.column_name,
          logicalType,
          nativeType: c.column_type,
          nullable: c.is_nullable === 'YES',
          isPrimaryKey: primaryKey.includes(c.column_name),
          isUnique: allUniqueCols.has(c.column_name),
          defaultValue: c.column_default ?? undefined,
          enumValues: isEnum ? parseMySqlEnumValues(c.column_type) ?? undefined : undefined,
          maxLength: c.character_maximum_length ?? undefined,
          precision: c.numeric_precision ?? undefined,
          scale: c.numeric_scale ?? undefined,
        };
      });

      tables.push({
        name: tableName,
        columns,
        primaryKey,
        foreignKeys,
        uniqueConstraints,
        checkConstraints: checkConstraints.length > 0 ? checkConstraints : undefined,
      });
    }

    return {
      dialect: 'mysql',
      tables,
      introspectedAt: new Date().toISOString(),
    };
  } finally {
    await conn.end();
  }
}
