import pg from 'pg';
import { normalizePgType } from './normalize.js';
import type {
  ColumnSchema,
  TableSchema,
  ForeignKey,
  DatabaseSchema,
} from '@seedforge/core';

interface EnumInfo {
  typeName: string;
  values: string[];
}

export interface PostgresIntrospectConfig {
  connectionString: string;
}

async function queryEnums(pool: pg.Pool): Promise<EnumInfo[]> {
  const result = await pool.query<{
    type_name: string;
    enum_value: string;
  }>(
    `SELECT t.typname AS type_name, e.enumlabel AS enum_value
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
     WHERE n.nspname = 'public'
     ORDER BY t.typname, e.enumsortorder`,
  );

  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const arr = map.get(row.type_name) ?? [];
    arr.push(row.enum_value);
    map.set(row.type_name, arr);
  }

  return Array.from(map.entries()).map(([typeName, values]) => ({
    typeName,
    values,
  }));
}

async function queryTableNames(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return result.rows.map((r) => r.table_name);
}

async function queryColumns(
  pool: pg.Pool,
  tableName: string,
): Promise<
  {
    column_name: string;
    data_type: string;
    udt_name: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: string;
    column_default: string | null;
  }[]
> {
  const result = await pool.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, data_type, udt_name,
            character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows;
}

async function queryPrimaryKey(
  pool: pg.Pool,
  tableName: string,
): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [tableName],
  );
  return result.rows.map((r) => r.column_name);
}

async function queryForeignKeys(
  pool: pg.Pool,
  tableName: string,
): Promise<ForeignKey[]> {
  const result = await pool.query<{
    constraint_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    update_rule: string;
    delete_rule: string;
  }>(
    `SELECT tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.update_rule,
            rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_catalog = ccu.constraint_catalog
      AND tc.constraint_schema = ccu.constraint_schema
      AND tc.constraint_name = ccu.constraint_name
     JOIN information_schema.referential_constraints rc
       ON tc.constraint_catalog = rc.constraint_catalog
      AND tc.constraint_schema = rc.constraint_schema
      AND tc.constraint_name = rc.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );

  const groups = new Map<string, ForeignKey>();
  for (const row of result.rows) {
    const existing = groups.get(row.constraint_name);
    if (existing) {
      existing.columns.push(row.column_name);
      existing.referencedColumns.push(row.foreign_column_name);
    } else {
      groups.set(row.constraint_name, {
        columns: [row.column_name],
        referencedTable: row.foreign_table_name,
        referencedColumns: [row.foreign_column_name],
        onDelete: row.delete_rule || undefined,
        onUpdate: row.update_rule || undefined,
      });
    }
  }

  return Array.from(groups.values());
}

async function queryUniqueConstraints(
  pool: pg.Pool,
  tableName: string,
): Promise<string[][]> {
  const result = await pool.query<{
    constraint_name: string;
    column_name: string;
  }>(
    `SELECT tc.constraint_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_catalog = kcu.constraint_catalog
      AND tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'UNIQUE'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );

  const groups = new Map<string, string[]>();
  for (const row of result.rows) {
    const arr = groups.get(row.constraint_name) ?? [];
    arr.push(row.column_name);
    groups.set(row.constraint_name, arr);
  }

  return Array.from(groups.values());
}

async function queryCheckConstraints(
  pool: pg.Pool,
  tableName: string,
): Promise<{ name: string; expression: string }[]> {
  const result = await pool.query<{
    constraint_name: string;
    check_clause: string;
  }>(
    `SELECT tc.constraint_name, cc.check_clause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON tc.constraint_catalog = cc.constraint_catalog
      AND tc.constraint_schema = cc.constraint_schema
      AND tc.constraint_name = cc.constraint_name
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type = 'CHECK'`,
    [tableName],
  );

  return result.rows.map((r) => ({
    name: r.constraint_name,
    expression: r.check_clause,
  }));
}

export async function introspect(
  config: PostgresIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const pool = new pg.Pool({ connectionString: config.connectionString });

  try {
    const enums = await queryEnums(pool);
    const enumTypeNames = new Set(enums.map((e) => e.typeName));
    const enumMap = new Map(enums.map((e) => [e.typeName, e.values]));

    const tableNames = await queryTableNames(pool);
    const tables: TableSchema[] = [];

    for (const tableName of tableNames) {
      const columnsRaw = await queryColumns(pool, tableName);
      const primaryKey = await queryPrimaryKey(pool, tableName);
      const foreignKeys = await queryForeignKeys(pool, tableName);
      const uniqueConstraints = await queryUniqueConstraints(pool, tableName);
      const checkConstraints = await queryCheckConstraints(pool, tableName);

      const allUniqueCols = new Set<string>();
      for (const uc of uniqueConstraints) {
        if (uc.length === 1) allUniqueCols.add(uc[0]!);
      }
      if (primaryKey.length === 1) allUniqueCols.add(primaryKey[0]!);

      const columns: ColumnSchema[] = columnsRaw.map((c) => {
        const logicalType = normalizePgType(
          c.data_type,
          c.udt_name,
          enumTypeNames,
        );
        return {
          name: c.column_name,
          logicalType,
          nativeType: c.udt_name ?? c.data_type,
          nullable: c.is_nullable === 'YES',
          isPrimaryKey: primaryKey.includes(c.column_name),
          isUnique: allUniqueCols.has(c.column_name),
          defaultValue: c.column_default ?? undefined,
          enumValues:
            logicalType === 'enum'
              ? enumMap.get(c.udt_name)
              : undefined,
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
      dialect: 'postgres',
      tables,
      introspectedAt: new Date().toISOString(),
    };
  } finally {
    await pool.end();
  }
}
