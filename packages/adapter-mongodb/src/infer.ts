import type { ColumnSchema, LogicalType, TableSchema } from '@seedforge/core';

function isExtendedJson(
  value: unknown,
): { wrapper: string; raw: unknown } | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const keys = Object.keys(value as Record<string, unknown>);
    if (
      keys.length === 1 &&
      (keys[0] === '$oid' || keys[0] === '$date')
    ) {
      return {
        wrapper: keys[0],
        raw: (value as Record<string, unknown>)[keys[0]],
      };
    }
  }
  return null;
}

function inferLiteralType(value: unknown): LogicalType | null {
  if (value === null || value === undefined) return null;

  const ext = isExtendedJson(value);
  if (ext) {
    if (ext.wrapper === '$oid') return 'uuid';
    if (ext.wrapper === '$date') return 'timestamp';
  }

  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'float';
  }
  if (typeof value === 'boolean') return 'boolean';

  if (Array.isArray(value)) return 'array';

  return 'string';
}

function mergeLogicalType(
  existing: LogicalType | undefined,
  incoming: LogicalType,
): LogicalType {
  if (!existing) return incoming;
  if (existing === incoming) return existing;
  if (
    (existing === 'integer' && incoming === 'float') ||
    (existing === 'float' && incoming === 'integer')
  ) {
    return 'float';
  }
  return 'string';
}

export interface InferredColumn {
  name: string;
  logicalType: LogicalType;
  nullable: boolean;
}

function flattenValue(
  value: unknown,
  prefix: string,
  columns: Map<string, InferredColumn>,
  docFields?: Set<string>,
): void {
  if (value === null || value === undefined) return;

  const ext = isExtendedJson(value);
  if (ext) {
    docFields?.add(prefix);
    addObservation(columns, prefix, inferLiteralType(value)!);
    return;
  }

  if (Array.isArray(value)) {
    docFields?.add(prefix);
    addObservation(columns, prefix, 'array');
    return;
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      docFields?.add(path);
      if (val === null || val === undefined) {
        markNullable(columns, path);
        continue;
      }
      const type = inferLiteralType(val);
      if (typeof val === 'object' && !Array.isArray(val) && !isExtendedJson(val)) {
        flattenValue(val, path, columns, docFields);
      } else if (type === 'array') {
        addObservation(columns, path, 'array');
        for (const item of val as unknown[]) {
          if (
            typeof item === 'object' &&
            item !== null &&
            !isExtendedJson(item)
          ) {
            flattenValue(item, `${path}[]`, columns, docFields);
          }
        }
      } else if (type !== null) {
        addObservation(columns, path, type);
      }
    }
    return;
  }

  const type = inferLiteralType(value);
  if (type) addObservation(columns, prefix, type);
}

function addObservation(
  columns: Map<string, InferredColumn>,
  name: string,
  type: LogicalType,
): void {
  const existing = columns.get(name);
  if (existing) {
    existing.logicalType = mergeLogicalType(existing.logicalType, type);
  } else {
    columns.set(name, { name, logicalType: type, nullable: false });
  }
}

function markNullable(
  columns: Map<string, InferredColumn>,
  name: string,
): void {
  const existing = columns.get(name);
  if (existing) {
    existing.nullable = true;
  } else {
    columns.set(name, { name, logicalType: 'string', nullable: true });
  }
}

export function inferFromDocuments(
  collectionName: string,
  documents: Record<string, unknown>[],
): TableSchema {
  const columns = new Map<string, InferredColumn>();
  const docFieldSets: Set<string>[] = documents.map(() => new Set());

  for (let i = 0; i < documents.length; i++) {
    flattenValue(documents[i]!, '', columns, docFieldSets[i]);
  }

  for (const [name, col] of columns) {
    for (const fields of docFieldSets) {
      if (!fields.has(name)) {
        col.nullable = true;
        break;
      }
    }
  }

  const sorted = Array.from(columns.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const colSchemas: ColumnSchema[] = sorted.map((c) => ({
    name: c.name,
    logicalType: c.logicalType,
    nativeType: c.logicalType,
    nullable: c.nullable,
    isPrimaryKey: c.name === '_id',
    isUnique: c.name === '_id',
  }));

  return {
    name: collectionName,
    columns: colSchemas,
    primaryKey: colSchemas.some((c) => c.isPrimaryKey) ? ['_id'] : [],
    foreignKeys: [],
    uniqueConstraints: [],
  };
}
