import fs from 'node:fs/promises';
import { getDMMF } from '@prisma/internals';
import { normalizePrismaType, nativeTypeFor } from './normalize.js';
import type {
  ColumnSchema,
  TableSchema,
  ForeignKey,
  DatabaseSchema,
} from '@seed-forge/core';

export interface PrismaIntrospectConfig {
  schemaPath: string;
}

interface DMMFField {
  name: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  isGenerated: boolean;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  relationOnDelete?: string;
  relationOnUpdate?: string;
  default?: { name?: string; args?: unknown[] } | string | boolean | number | null;
  hasDefaultValue: boolean;
  kind: 'scalar' | 'object' | 'enum';
}

interface DMMFModel {
  name: string;
  dbName?: string;
  fields: DMMFField[];
  primaryKey: { name?: string | null; fields: string[] } | null;
}

interface DMMFEnum {
  name: string;
  values: { name: string }[];
}

interface DMMFDocument {
  datamodel: {
    models: DMMFModel[];
    enums: DMMFEnum[];
  };
}

function isUuidDefault(field: DMMFField): boolean {
  return (
    field.hasDefaultValue &&
    typeof field.default === 'object' &&
    field.default !== null &&
    (field.default as { name?: string }).name === 'uuid'
  );
}

function isNowDefault(field: DMMFField): boolean {
  return (
    field.hasDefaultValue &&
    typeof field.default === 'object' &&
    field.default !== null &&
    (field.default as { name?: string }).name === 'now'
  );
}

function extractDefault(field: DMMFField): unknown {
  if (!field.hasDefaultValue) return undefined;
  if (typeof field.default === 'string') return field.default;
  if (typeof field.default === 'boolean') return field.default;
  if (typeof field.default === 'number') return field.default;
  if (field.default === null) return undefined;
  if (typeof field.default === 'object') {
    const d = field.default as { name?: string; args?: unknown[] };
    if (d.name === 'uuid') return 'gen_random_uuid()';
    if (d.name === 'now') return 'now()';
    if (d.name === 'autoincrement') return 'auto_increment';
    return undefined;
  }
  return undefined;
}

export async function introspect(
  config: PrismaIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const content = await fs.readFile(config.schemaPath, 'utf-8');
  const dmmf = (await getDMMF({ datamodel: content })) as unknown as DMMFDocument;

  const enumMap = new Map<string, string[]>();
  for (const e of dmmf.datamodel.enums) {
    enumMap.set(e.name, e.values.map((v) => v.name));
  }

  // Build a map from column name to logicalType for FK type propagation
  const columnLogicalTypes = new Map<string, Map<string, string>>();

  // First pass: collect logical types for all scalar fields
  for (const model of dmmf.datamodel.models) {
    const types = new Map<string, string>();
    for (const field of model.fields) {
      if (field.kind === 'scalar') {
        const isPk = (model.primaryKey?.fields ?? []).includes(field.name) || field.isId;
        const hasUuid = isUuidDefault(field);
        types.set(field.name, normalizePrismaType(field.type, isPk, hasUuid));
      }
    }
    columnLogicalTypes.set(model.name, types);
  }

  const tables: TableSchema[] = [];

  for (const model of dmmf.datamodel.models) {
    const pkFields = model.primaryKey?.fields ?? [];
    const pkSet = new Set(pkFields);

    const columns: ColumnSchema[] = [];
    const foreignKeys: ForeignKey[] = [];

    for (const field of model.fields) {
      if (field.kind === 'object') {
        if (field.relationName && field.relationFromFields && field.relationFromFields.length > 0) {
          const targetModel = dmmf.datamodel.models.find((m) => m.name === field.type);
          if (targetModel) {
            foreignKeys.push({
              columns: field.relationFromFields,
              referencedTable: targetModel.dbName ?? targetModel.name,
              referencedColumns: field.relationToFields ?? ['id'],
              onDelete: field.relationOnDelete?.toLowerCase() ?? undefined,
              onUpdate: field.relationOnUpdate?.toLowerCase() ?? undefined,
            });
          }
        }
        continue;
      }

      const isPk = pkSet.has(field.name) || field.isId;

      if (field.kind === 'enum') {
        const enumValues = enumMap.get(field.type);
        columns.push({
          name: field.name,
          logicalType: 'enum',
          nativeType: field.type,
          nullable: !field.isRequired,
          isPrimaryKey: isPk,
          isUnique: field.isUnique,
          defaultValue: extractDefault(field),
          enumValues,
        });
        continue;
      }

      const hasUuid = isUuidDefault(field);
      let logicalType = normalizePrismaType(field.type, field.isId, hasUuid);

      // If this is a scalar column that participates as a FK relationFromField,
      // propagate the referenced PK's logicalType so FKs to UUID PKs are typed uuid
      if (logicalType === 'string') {
        for (const otherModel of dmmf.datamodel.models) {
          for (const ofield of otherModel.fields) {
            if (
              ofield.relationName &&
              ofield.relationFromFields?.includes(field.name) &&
              ofield.relationToFields &&
              ofield.relationToFields.length > 0
            ) {
              const refType = columnLogicalTypes.get(ofield.type)?.get(ofield.relationToFields[0]!);
              if (refType === 'uuid') {
                logicalType = 'uuid';
              }
            }
          }
        }
      }

      columns.push({
        name: field.name,
        logicalType,
        nativeType: nativeTypeFor(field.type, hasUuid),
        nullable: !field.isRequired,
        isPrimaryKey: isPk,
        isUnique: field.isUnique,
        defaultValue: extractDefault(field),
        enumValues: undefined,
      });
    }

    const uniqueConstraints: string[][] = [];
    const seenSingles = new Set<string>();
    for (const col of columns) {
      if (col.isUnique && !col.isPrimaryKey) {
        uniqueConstraints.push([col.name]);
        seenSingles.add(col.name);
      }
    }

    const primaryKey = pkFields.length > 0
      ? pkFields
      : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    tables.push({
      name: model.dbName ?? model.name,
      columns,
      primaryKey,
      foreignKeys,
      uniqueConstraints,
    });
  }

  return {
    dialect: 'prisma',
    tables,
    introspectedAt: new Date().toISOString(),
  };
}
