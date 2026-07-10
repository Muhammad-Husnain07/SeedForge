import { createJiti } from 'jiti';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { normalizeDrizzleType, nativeTypeFor } from './normalize.js';
import type {
  ColumnSchema,
  TableSchema,
  ForeignKey,
  DatabaseSchema,
} from '@seed-forge/core';

export interface DrizzleIntrospectConfig {
  schemaPath: string;
}

function isPgTable(v: unknown): v is AnyPgTable {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>).constructor?.name === 'PgTable'
  );
}

function isPgEnum(v: unknown): v is { enumName: string; enumValues: string[] } {
  return (
    typeof v === 'function' &&
    'enumName' in v &&
    'enumValues' in v &&
    Array.isArray((v as Record<string, string[]>).enumValues)
  );
}

function columnTypeName(col: Record<string, unknown>): string {
  return ((col as { columnType?: string }).columnType ?? (col as { dataType?: string }).dataType ?? 'text') as string;
}

function isEnumColumn(col: Record<string, unknown>, enumMap: Map<string, string[]>): boolean {
  const ct = columnTypeName(col);
  if (ct === 'PgEnumColumn') return true;
  return enumMap.has(ct);
}

function enumValuesFor(col: Record<string, unknown>, enumMap: Map<string, string[]>): string[] | undefined {
  const ev = col.enumValues as string[] | string | undefined;
  if (Array.isArray(ev) && ev.length > 0) return ev;
  if (typeof ev === 'string' && ev.length > 0) return ev.split(',');
  const ct = columnTypeName(col);
  return enumMap.get(ct);
}

export async function introspect(
  config: DrizzleIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const jiti = createJiti(process.cwd(), {
    interopDefault: true,
    moduleCache: false,
  });

  const mod: Record<string, unknown> = (await jiti.import(config.schemaPath)) as Record<string, unknown>;

  const enumMap = new Map<string, string[]>();
  const tableEntries: { table: AnyPgTable }[] = [];

  for (const value of Object.values(mod)) {
    if (isPgEnum(value)) {
      enumMap.set(value.enumName, value.enumValues);
    } else if (isPgTable(value)) {
      tableEntries.push({ table: value });
    }
  }

  const tables: TableSchema[] = [];

  for (const entry of tableEntries) {
    const table = entry.table;
    const tableConfig = getTableConfig(table);
    const dbTableName = tableConfig.name;

    // check columns directly from table for primary/unique/fk info lost through jiti
    const directCols = new Map<string, Record<string, unknown>>();
    for (const val of Object.values(table)) {
      if (typeof val === 'object' && val !== null && (val as Record<string, unknown>).name && 'columnType' in val) {
        const col = val as Record<string, unknown>;
        directCols.set(col.name as string, col);
      }
    }

    const pkColumnSet = new Set<string>();
    const rawPKs = tableConfig.primaryKeys as readonly unknown[] | undefined;
    if (rawPKs && rawPKs.length > 0) {
      for (const pk of rawPKs) {
        const cols = (pk as Record<string, unknown>).columns as { name: string }[] | undefined;
        if (cols) {
          for (const col of cols) {
            if (col?.name) pkColumnSet.add(col.name);
          }
        }
      }
    }
    // also detect single-column PK from direct column .primary property
    for (const [dbColName, directCol] of directCols) {
      if ((directCol as Record<string, unknown>).primary === true) {
        pkColumnSet.add(dbColName);
      }
    }

    const uniqueConstraintColumns: string[][] = [];
    const uniqueColSet = new Set<string>();
    const rawUCs = tableConfig.uniqueConstraints as readonly unknown[] | undefined;
    if (rawUCs && rawUCs.length > 0) {
      for (const uc of rawUCs) {
        const ucObj = uc as Record<string, unknown>;
        // Drizzle unique constraints from .unique() on columns store the column name
        // via a 'columns' array or directly as a 'name' property
        let names: string[] = [];
        if (Array.isArray(ucObj.columns)) {
          names = ucObj.columns.map((c: unknown) => {
            const col = c as Record<string, unknown>;
            return typeof col === 'object' && col !== null ? String(col.name ?? '') : String(col);
          });
        } else if (typeof ucObj.name === 'string') {
          names = [ucObj.name];
        }
        if (names.length > 0) {
          uniqueConstraintColumns.push(names);
          if (names.length === 1) uniqueColSet.add(names[0]!);
        }
      }
    }
    // also detect unique from direct column .isUnique property
    for (const [dbColName, directCol] of directCols) {
      if ((directCol as Record<string, unknown>).isUnique === true) {
        uniqueColSet.add(dbColName);
      }
    }

    const columnEntries: { jsName: string; col: Record<string, unknown> }[] = [];
    const colsRecord = tableConfig.columns as unknown as Record<string, Record<string, unknown>> | undefined;
    if (colsRecord) {
      for (const [jsName, col] of Object.entries(colsRecord)) {
        columnEntries.push({ jsName, col });
      }
    }

    const columns: ColumnSchema[] = [];
    const foreignKeys: ForeignKey[] = [];

    for (const { col } of columnEntries) {
      const dbColName = col.name as string;
      const isPk = pkColumnSet.has(dbColName);
      if (isPk) uniqueColSet.add(dbColName);

      const directCol = directCols.get(dbColName);
      const isUniqueCol = directCol ? (directCol.isUnique as boolean | undefined) === true : false;
      if (isUniqueCol) uniqueColSet.add(dbColName);

      const ct = columnTypeName(col);
      const isEnum = isEnumColumn(col, enumMap);
      const logicalType = normalizeDrizzleType(ct, isEnum);

      columns.push({
        name: dbColName,
        logicalType,
        nativeType: nativeTypeFor(ct, isEnum),
        nullable: col.notNull !== true,
        isPrimaryKey: isPk,
        isUnique: uniqueColSet.has(dbColName),
        defaultValue: col.default !== undefined ? col.default : undefined,
        enumValues: isEnumColumn(col, enumMap) ? enumValuesFor(col, enumMap) : undefined,
        maxLength: (col as { length?: number }).length ?? undefined,
        precision: (col as { precision?: number }).precision ?? undefined,
        scale: (col as { scale?: number }).scale ?? undefined,
      });
    }

    if (tableConfig.foreignKeys) {
      for (const fk of tableConfig.foreignKeys) {
        const fkObj = fk as unknown as Record<string, unknown>;
        const refFn = fkObj.reference as (...args: unknown[]) => unknown;
        if (typeof refFn === 'function') {
          try {
            const refResult = refFn() as Record<string, unknown>;
            if (refResult) {
              const fkCols = (refResult.columns as { name: string }[] | undefined)?.map(c => c.name) ?? [];
              const refCols = (refResult.foreignColumns as { name: string }[] | undefined)?.map(c => c.name) ?? [];
              let refTableName = 'unknown';
              try {
                const ft = refResult.foreignTable as Record<string, unknown> | undefined;
                if (ft) refTableName = getTableName(ft as never);
              } catch { /* ignore */ }
              if (fkCols.length > 0) {
                foreignKeys.push({
                  columns: fkCols,
                  referencedTable: refTableName,
                  referencedColumns: refCols,
                  onDelete: fkObj.onDelete as string | undefined,
                  onUpdate: fkObj.onUpdate as string | undefined,
                });
              }
            }
          } catch { /* ignore */ }
        }
      }
    }



    const primaryKey: string[] = [];
    for (const col of columns) {
      if (col.isPrimaryKey) primaryKey.push(col.name);
    }

    const uniqueConstraints: string[][] = [];
    const seenSingles = new Set<string>();
    for (const col of columns) {
      if (col.isUnique && !col.isPrimaryKey) {
        uniqueConstraints.push([col.name]);
        seenSingles.add(col.name);
      }
    }
    for (const uc of uniqueConstraintColumns) {
      if (uc.length > 1 || !seenSingles.has(uc[0]!)) {
        uniqueConstraints.push(uc);
      }
    }

    tables.push({
      name: dbTableName,
      columns,
      primaryKey,
      foreignKeys,
      uniqueConstraints,
    });
  }

  return {
    dialect: 'drizzle',
    tables,
    introspectedAt: new Date().toISOString(),
  };
}
