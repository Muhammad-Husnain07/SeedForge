import type {
  DatabaseSchema,
  TableSchema,
  ForeignKey,
} from '../types/index.js';
import type { RelationshipEdge, RelationshipGraph } from './graph.js';
import { topologicalSort, findCycles } from './topologicalSort.js';
import { inferMongoRelationships } from './inferMongoRelationships.js';

export interface BuildGraphOptions {
  mongoDocuments?: Record<string, Record<string, unknown>[]>;
  mongoConfidenceThreshold?: number;
}

function isFkCoveredByUnique(
  table: TableSchema,
  fkColumns: string[],
): boolean {
  const singleCol = fkColumns.length === 1;
  if (!singleCol) return false;

  const col = fkColumns[0]!;

  for (const colSchema of table.columns) {
    if (colSchema.name === col && colSchema.isUnique) return true;
  }

  if (table.primaryKey.length === 1 && table.primaryKey[0] === col) return true;

  for (const uc of table.uniqueConstraints) {
    if (uc.length === 1 && uc[0] === col) return true;
  }

  return false;
}

function detectJunctionTable(table: TableSchema): boolean {
  if (table.foreignKeys.length !== 2) return false;

  const fkCols = new Set(table.foreignKeys.flatMap((fk) => fk.columns));

  const pkSet = new Set(table.primaryKey);
  const isCompositePk = table.primaryKey.length >= 2;
  const fkFormPk = isCompositePk && fkCols.size === pkSet.size &&
    [...fkCols].every((c) => pkSet.has(c));

  const formsUnique = table.uniqueConstraints.some(
    (uc) => uc.length === fkCols.size && [...fkCols].every((c) => uc.includes(c)),
  );

  if (!fkFormPk && !formsUnique) return false;

  const keyCols = new Set<string>([
    ...table.primaryKey,
    ...table.foreignKeys.flatMap((fk) => fk.columns),
  ]);

  const timestampCols = new Set(['created_at', 'createdAt', 'updated_at', 'updatedAt']);

  for (const col of table.columns) {
    if (keyCols.has(col.name)) continue;
    if (timestampCols.has(col.name)) continue;
    return false;
  }

  return true;
}

function collectRawEdges(tables: TableSchema[]): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      let type: RelationshipEdge['type'] = 'one-to-many';

      if (fk.referencedTable === table.name) {
        type = 'self-referential';
      } else if (isFkCoveredByUnique(table, fk.columns)) {
        type = 'one-to-one';
      }

      edges.push({ from: table.name, to: fk.referencedTable, type, foreignKey: fk });
    }
  }

  return edges;
}

function mergeJunctionEdges(
  edges: RelationshipEdge[],
  tables: TableSchema[],
): RelationshipEdge[] {
  const junctionTables = new Set<string>();

  for (const table of tables) {
    if (detectJunctionTable(table)) {
      junctionTables.add(table.name);
    }
  }

  if (junctionTables.size === 0) return edges;

  const result: RelationshipEdge[] = [];
  const removedEdgeKeys = new Set<string>();

  for (const edge of edges) {
    if (junctionTables.has(edge.from)) {
      removedEdgeKeys.add(`${edge.from}:${edge.to}`);
    } else {
      result.push(edge);
    }
  }

  for (const table of tables) {
    if (!junctionTables.has(table.name)) continue;

    const refTables = table.foreignKeys.map((fk) => fk.referencedTable);
    if (refTables.length !== 2) continue;

    const [first, second] = refTables;
    if (!first || !second) continue;

    const compositeFk: ForeignKey = {
      columns: table.foreignKeys.flatMap((fk) => fk.columns),
      referencedTable: `${first},${second}`,
      referencedColumns: table.foreignKeys.flatMap((fk) => fk.referencedColumns),
    };

    result.push({
      from: first,
      to: second,
      type: 'many-to-many',
      viaJunctionTable: table.name,
      foreignKey: compositeFk,
    });
  }

  return result;
}

export function buildGraph(
  schema: DatabaseSchema,
  options: BuildGraphOptions = {},
): RelationshipGraph {
  const tableNames = schema.tables.map((t) => t.name);
  const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

  let rawEdges = collectRawEdges(schema.tables);

  if (schema.dialect === 'mongodb' && options.mongoDocuments) {
    const inferred = inferMongoRelationships(
      schema,
      options.mongoDocuments,
      options.mongoConfidenceThreshold,
    );
    rawEdges = [...rawEdges, ...inferred];
  }

  const outputEdges = mergeJunctionEdges(rawEdges, schema.tables);

  const sortEdges = rawEdges.filter(
    (e) => e.type !== 'self-referential',
  );

  const { order, remaining } = topologicalSort(tableNames, sortEdges);

  const cycles: string[][] = [];

  const selfRefTables = new Set<string>();
  for (const edge of rawEdges) {
    if (edge.type === 'self-referential') {
      selfRefTables.add(edge.from);
    }
  }
  for (const t of selfRefTables) {
    cycles.push([t]);
  }

  if (remaining.size > 0) {
    const multiCycles = findCycles(remaining, sortEdges);
    for (const cycle of multiCycles) {
      cycles.push(cycle);
    }
  }

  return {
    nodes: tableNames,
    edges: outputEdges,
    insertionOrder: order,
    cycles,
  };
}
