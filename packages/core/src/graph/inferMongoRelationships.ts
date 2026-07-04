import type { DatabaseSchema, TableSchema } from '../types/index.js';
import type { RelationshipEdge, MongoInferredRelationship } from './graph.js';

const FIELD_PATTERN = /^(.+)(Id|_id|Ref)$/;

function pluralize(name: string): string {
  if (name.endsWith('s')) return name;
  if (name.endsWith('y')) return name.slice(0, -1) + 'ies';
  return name + 's';
}

function singularize(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function findMatchingCollection(
  candidateName: string,
  collections: TableSchema[],
): string | null {
  const candidates = [
    candidateName,
    pluralize(candidateName),
    singularize(candidateName),
    candidateName.toLowerCase(),
    pluralize(candidateName.toLowerCase()),
    singularize(candidateName.toLowerCase()),
  ];

  for (const coll of collections) {
    if (candidates.includes(coll.name)) return coll.name;
  }
  return null;
}

function valueToString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('$oid' in obj) return String(obj['$oid']);
    if ('$date' in obj) return String(obj['$date']);
    if ('toString' in obj) return String(obj.toString());
  }
  return String(val);
}

function collectDistinctValues(
  table: TableSchema,
  fieldName: string,
  documents: Record<string, unknown>[],
): Set<string> {
  const values = new Set<string>();

  const fieldParts = fieldName.split('.');
  if (fieldParts.length === 1) {
    for (const doc of documents) {
      const val = doc[fieldName];
      const str = valueToString(val);
      if (str !== null) values.add(str);
    }
  } else {
    for (const doc of documents) {
      let current: unknown = doc;
      for (const part of fieldParts) {
        if (current && typeof current === 'object' && !Array.isArray(current)) {
          current = (current as Record<string, unknown>)[part];
        } else if (Array.isArray(current)) {
          for (const item of current) {
            if (item && typeof item === 'object') {
              const nested = (item as Record<string, unknown>)[part];
              const str = valueToString(nested);
              if (str !== null) values.add(str);
            }
          }
          current = undefined;
          break;
        } else {
          current = undefined;
          break;
        }
      }
      const str = valueToString(current);
      if (str !== null) values.add(str);
    }
  }

  return values;
}

function extractIdValues(
  documents: Record<string, unknown>[],
): Set<string> {
  const values = new Set<string>();
  for (const doc of documents) {
    const str = valueToString(doc['_id']);
    if (str !== null) values.add(str);
  }
  return values;
}

export function inferMongoRelationships(
  schema: DatabaseSchema,
  documents: Record<string, Record<string, unknown>[]>,
  threshold: number = 0.8,
): RelationshipEdge[] {
  const inferred: RelationshipEdge[] = [];
  const possibleRelationships: MongoInferredRelationship[] = [];

  for (const table of schema.tables) {
    const tableDocs = documents[table.name] ?? [];

    for (const col of table.columns) {
      const match = col.name.match(FIELD_PATTERN);
      if (!match) continue;

      const candidateName = match[1]!;
      const targetCollection = findMatchingCollection(candidateName, schema.tables);
      if (!targetCollection) continue;

      const sourceValues = collectDistinctValues(table, col.name, tableDocs);
      if (sourceValues.size === 0) continue;

      const targetDocs = documents[targetCollection] ?? [];
      const targetIds = extractIdValues(targetDocs);

      if (targetIds.size === 0) continue;

      let overlap = 0;
      for (const val of sourceValues) {
        if (targetIds.has(val)) overlap++;
      }

      const confidence = overlap / sourceValues.size;

      if (confidence >= threshold) {
        inferred.push({
          from: table.name,
          to: targetCollection,
          type: 'one-to-many',
          foreignKey: {
            columns: [col.name],
            referencedTable: targetCollection,
            referencedColumns: ['_id'],
          },
        });
      } else if (confidence > 0) {
        possibleRelationships.push({
          fromCollection: table.name,
          toCollection: targetCollection,
          fromField: col.name,
          confidence,
        });
      }
    }
  }

  if (possibleRelationships.length > 0) {
    console.warn(
      'Possible MongoDB relationships (not auto-wired, confidence below threshold):',
      possibleRelationships,
    );
  }

  return inferred;
}
