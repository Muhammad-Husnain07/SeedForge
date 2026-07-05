import type { DatabaseSchema, TableSchema, ColumnSchema } from '../types/index.js';
import type { SchemaDiff, SchemaDiffEntry } from './types.js';

function entry(
  type: SchemaDiffEntry['type'],
  table: string,
  column: string | undefined,
  detail: string,
): SchemaDiffEntry {
  return { type, table, column, detail };
}

function tableMap(schema: DatabaseSchema): Map<string, TableSchema> {
  return new Map(schema.tables.map((t) => [t.name, t]));
}

function colMap(table: TableSchema): Map<string, ColumnSchema> {
  return new Map(table.columns.map((c) => [c.name, c]));
}

function arrayEqSorted(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function formatNative(col: ColumnSchema): string {
  const parts = [col.nativeType];
  if (col.maxLength) parts.push(`(${col.maxLength})`);
  if (!col.nullable) parts.push('NOT NULL');
  if (col.enumValues && col.enumValues.length > 0) {
    parts.push(`[${col.enumValues.join(', ')}]`);
  }
  return parts.join(' ');
}

export function diffSchemas(
  oldSchema: DatabaseSchema,
  newSchema: DatabaseSchema,
): SchemaDiff {
  const entries: SchemaDiffEntry[] = [];
  const oldTables = tableMap(oldSchema);
  const newTables = tableMap(newSchema);
  const allTableNames = new Set([...oldTables.keys(), ...newTables.keys()]);

  for (const tableName of [...allTableNames].sort()) {
    const oldT = oldTables.get(tableName);
    const newT = newTables.get(tableName);

    if (!oldT && newT) {
      entries.push(entry('table-added', tableName, undefined, `added table: ${tableName}`));
      continue;
    }
    if (oldT && !newT) {
      entries.push(entry('table-removed', tableName, undefined, `removed table: ${tableName}`));
      continue;
    }
    if (!oldT || !newT) continue;

    const oldCols = colMap(oldT);
    const newCols = colMap(newT);
    const allColNames = new Set([...oldCols.keys(), ...newCols.keys()]);

    for (const colName of [...allColNames].sort()) {
      const oldC = oldCols.get(colName);
      const newC = newCols.get(colName);

      if (!oldC && newC) {
        entries.push(
          entry('column-added', tableName, colName, `added column: ${colName} (${formatNative(newC)})`),
        );
        continue;
      }
      if (oldC && !newC) {
        entries.push(entry('column-removed', tableName, colName, `removed column: ${colName}`));
        continue;
      }
      if (!oldC || !newC) continue;

      const oldNative = `${oldC.logicalType}:${oldC.nativeType}`;
      const newNative = `${newC.logicalType}:${newC.nativeType}`;
      if (oldNative !== newNative) {
        entries.push(
          entry(
            'column-type-changed',
            tableName,
            colName,
            `${colName}: ${oldC.nativeType} → ${newC.nativeType}`,
          ),
        );
      }

      if (oldC.nullable !== newC.nullable) {
        const dir = newC.nullable ? 'nullable' : 'NOT NULL';
        entries.push(
          entry('column-nullability-changed', tableName, colName, `${colName}: ${dir}`),
        );
      }

      if (!arrayEqSorted(oldC.enumValues ?? [], newC.enumValues ?? [])) {
        const oldEv = (oldC.enumValues ?? []).join(', ');
        const newEv = (newC.enumValues ?? []).join(', ');
        entries.push(
          entry(
            'constraint-changed' as SchemaDiffEntry['type'],
            tableName,
            colName,
            `${colName} enum values: [${oldEv}] → [${newEv}]`,
          ),
        );
      }
    }

    // Check constraint changes
    const oldChecks = JSON.stringify(
      (oldT.checkConstraints ?? []).map((c) => ({ name: c.name, expr: c.expression })).sort(),
    );
    const newChecks = JSON.stringify(
      (newT.checkConstraints ?? []).map((c) => ({ name: c.name, expr: c.expression })).sort(),
    );
    if (oldChecks !== newChecks) {
      const added = (newT.checkConstraints ?? []).filter(
        (nc) => !(oldT.checkConstraints ?? []).some((oc) => oc.name === nc.name),
      );
      const removed = (oldT.checkConstraints ?? []).filter(
        (oc) => !(newT.checkConstraints ?? []).some((nc) => nc.name === oc.name),
      );
      for (const c of added) {
        entries.push(
          entry('constraint-added', tableName, undefined, `added check constraint: ${c.name} (${c.expression})`),
        );
      }
      for (const c of removed) {
        entries.push(
          entry('constraint-removed', tableName, undefined, `removed check constraint: ${c.name}`),
        );
      }
    }

    // FK changes
    const oldFKs = JSON.stringify(
      [...oldT.foreignKeys].sort((a, b) => a.columns[0]!.localeCompare(b.columns[0]!)),
    );
    const newFKs = JSON.stringify(
      [...newT.foreignKeys].sort((a, b) => a.columns[0]!.localeCompare(b.columns[0]!)),
    );
    if (oldFKs !== newFKs) {
      for (const nfk of newT.foreignKeys) {
        if (!oldT.foreignKeys.some((ofk) => arrayEqSorted(ofk.columns, nfk.columns) && ofk.referencedTable === nfk.referencedTable)) {
          entries.push(
            entry('constraint-added', tableName, nfk.columns[0], `added FK: ${nfk.columns.join(', ')} → ${nfk.referencedTable}(${nfk.referencedColumns.join(', ')})`),
          );
        }
      }
      for (const ofk of oldT.foreignKeys) {
        if (!newT.foreignKeys.some((nfk) => arrayEqSorted(nfk.columns, ofk.columns) && nfk.referencedTable === ofk.referencedTable)) {
          entries.push(
            entry('constraint-removed', tableName, ofk.columns[0], `removed FK: ${ofk.columns.join(', ')} → ${ofk.referencedTable}(${ofk.referencedColumns.join(', ')})`),
          );
        }
      }
    }

    // Unique constraint changes
    const oldUC = JSON.stringify([...oldT.uniqueConstraints].sort((a, b) => a.join(',').localeCompare(b.join(','))));
    const newUC = JSON.stringify([...newT.uniqueConstraints].sort((a, b) => a.join(',').localeCompare(b.join(','))));
    if (oldUC !== newUC) {
      for (const nuc of newT.uniqueConstraints) {
        if (!oldT.uniqueConstraints.some((ouc) => arrayEqSorted(ouc, nuc))) {
          entries.push(
            entry('constraint-added', tableName, nuc.join(', '), `added UNIQUE: (${nuc.join(', ')})`),
          );
        }
      }
      for (const ouc of oldT.uniqueConstraints) {
        if (!newT.uniqueConstraints.some((nuc) => arrayEqSorted(nuc, ouc))) {
          entries.push(
            entry('constraint-removed', tableName, ouc.join(', '), `removed UNIQUE: (${ouc.join(', ')})`),
          );
        }
      }
    }
  }

  const hasDrift = entries.length > 0;
  const formatted = formatDiff(oldSchema, newSchema, entries);
  return { hasDrift, entries, formatted };
}

function formatDiff(
  _oldSchema: DatabaseSchema,
  _newSchema: DatabaseSchema,
  entries: SchemaDiffEntry[],
): string {
  if (entries.length === 0) return 'No schema drift detected.';

  const lines: string[] = ['Schema drift detected!', ''];

  const byTable = new Map<string, SchemaDiffEntry[]>();
  for (const e of entries) {
    if (!byTable.has(e.table)) byTable.set(e.table, []);
    byTable.get(e.table)!.push(e);
  }

  for (const [tableName, tableEntries] of [...byTable.entries()].sort()) {
    const hasTableAdded = tableEntries.some((e) => e.type === 'table-added');
    const hasTableRemoved = tableEntries.some((e) => e.type === 'table-removed');

    if (hasTableAdded) {
      lines.push(`  + ${tableName}`);
    } else if (hasTableRemoved) {
      lines.push(`  - ${tableName}`);
    } else {
      lines.push(`  ~ ${tableName}`);
    }

    for (const e of tableEntries) {
      if (e.type === 'table-added' || e.type === 'table-removed') continue;

      switch (e.type) {
        case 'column-added':
          lines.push(`      + ${e.detail}`);
          break;
        case 'column-removed':
          lines.push(`      - ${e.detail}`);
          break;
        case 'column-type-changed':
        case 'column-nullability-changed':
          lines.push(`      ~ ${e.detail}`);
          break;
        case 'constraint-added':
          lines.push(`      + ${e.detail}`);
          break;
        case 'constraint-removed':
          lines.push(`      - ${e.detail}`);
          break;
        case 'constraint-changed':
          lines.push(`      ~ ${e.detail}`);
          break;
      }
    }
  }

  lines.push('');
  lines.push('Run with --force to proceed anyway, or acknowledge this drift');
  lines.push('by updating acknowledgedSchemaHash in seedforge.lock.json.');
  return lines.join('\n');
}
