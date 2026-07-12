import type { DatabaseSchema, FieldSemanticMatch, GeneratorSpec } from '@seed-forge/core';
import type { AnonymizedColumn } from './types.js';

const SENSITIVE_SEMANTIC_TYPES = new Set([
  'email',
  'phone',
  'firstName',
  'lastName',
  'fullName',
  'street',
  'city',
  'state',
  'zip',
  'country',
  'longText',
  'url',
  'ip',
  'imageUrl',
]);

export function isSensitiveSemanticType(semanticType: string): boolean {
  return SENSITIVE_SEMANTIC_TYPES.has(semanticType);
}

export interface ClassificationResult {
  columns: AnonymizedColumn[];
  totalReplace: number;
  totalKeep: number;
}

export function classifyColumns(
  schema: DatabaseSchema,
  matches: FieldSemanticMatch[],
): ClassificationResult {
  const pkColumns = new Set<string>();
  for (const table of schema.tables) {
    for (const pk of table.primaryKey) {
      pkColumns.add(`${table.name}.${pk}`);
    }
  }

  const matchMap = new Map<string, FieldSemanticMatch>();
  for (const m of matches) {
    matchMap.set(`${m.table}.${m.column}`, m);
  }

  const columns: AnonymizedColumn[] = [];
  let totalReplace = 0;
  let totalKeep = 0;

  for (const table of schema.tables) {
    for (const col of table.columns) {
      const key = `${table.name}.${col.name}`;
      const match = matchMap.get(key);
      const semanticType = match?.semanticType ?? 'unknown';
      const isPK = pkColumns.has(key);

      let strategy: 'keep' | 'replace';
      let generator: GeneratorSpec | undefined;

      if (isPK) {
        strategy = 'keep';
      } else if (match?.source === 'rule' && isSensitiveSemanticType(semanticType)) {
        strategy = 'replace';
        generator = match.suggestedGenerator;
      } else {
        strategy = 'keep';
      }

      columns.push({ table: table.name, column: col.name, strategy, semanticType, generator });
      if (strategy === 'replace') totalReplace++;
      else totalKeep++;
    }
  }

  return { columns, totalReplace, totalKeep };
}

export function anonymizeRow(
  row: Record<string, unknown>,
  tableName: string,
  columns: AnonymizedColumn[],
  produceValue: (generator: GeneratorSpec) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.table !== tableName) continue;
    if (col.strategy === 'replace' && col.generator) {
      result[col.column] = row[col.column] !== undefined ? produceValue(col.generator) : undefined;
    } else {
      result[col.column] = row[col.column];
    }
  }
  return result;
}
