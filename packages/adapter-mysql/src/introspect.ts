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
  return rows.map((r) => String((r as Record<string, unknown>).TABLE_NAME));
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
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      column_name: String(row.COLUMN_NAME),
      data_type: String(row.DATA_TYPE),
      column_type: String(row.COLUMN_TYPE),
      character_maximum_length: (row.CHARACTER_MAXIMUM_LENGTH as number | null) ?? null,
      numeric_precision: (row.NUMERIC_PRECISION as number | null) ?? null,
      numeric_scale: (row.NUMERIC_SCALE as number | null) ?? null,
      is_nullable: String(row.IS_NULLABLE),
      column_default: row.COLUMN_DEFAULT !== null ? `${row.COLUMN_DEFAULT as string}` : null,
    };
  });
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
  return rows.map((r) => String((r as Record<string, unknown>).COLUMN_NAME));
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
    const r = row as Record<string, unknown>;
    const name = String(r.CONSTRAINT_NAME);
    const existing = groups.get(name);
    if (existing) {
      existing.columns.push(String(r.COLUMN_NAME));
      existing.referencedColumns.push(String(r.REFERENCED_COLUMN_NAME));
    } else {
      groups.set(name, {
        columns: [String(r.COLUMN_NAME)],
        referencedTable: String(r.REFERENCED_TABLE_NAME),
        referencedColumns: [String(r.REFERENCED_COLUMN_NAME)],
        onDelete: r.DELETE_RULE ? `${r.DELETE_RULE as string}` : undefined,
        onUpdate: r.UPDATE_RULE ? `${r.UPDATE_RULE as string}` : undefined,
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
    const r = row as Record<string, unknown>;
    const name = String(r.CONSTRAINT_NAME);
    const arr = groups.get(name) ?? [];
    arr.push(String(r.COLUMN_NAME));
    groups.set(name, arr);
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
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      name: String(row.CONSTRAINT_NAME),
      expression: String(row.CHECK_CLAUSE),
    };
  });
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
