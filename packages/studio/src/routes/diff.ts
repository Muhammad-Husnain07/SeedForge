import type { FastifyInstance } from 'fastify';
import { readLockfile, diffSchemas } from '@seed-forge/core';
import { getContext } from '../context.js';

export function diffRoutes(server: FastifyInstance): void {
  server.get('/diff', async () => {
    const ctx = getContext();
    const lockfile = await readLockfile();

    if (!lockfile) {
      return {
        hasDrift: false,
        entries: [],
        formatted: 'No lockfile found. Run a seed generation first.',
        addedTables: [],
        removedTables: [],
        changedTables: [],
      };
    }

    const oldSchema = {
      ...lockfile.schema,
      schemaHash: lockfile.schemaHash,
    };
    const liveSchema = { ...ctx.schema };

    const diff = diffSchemas(oldSchema, liveSchema);

    const tableChanges = new Map<string, {
      name: string;
      status: 'added' | 'removed' | 'changed';
      addedCols: string[];
      removedCols: string[];
      changedCols: { name: string; detail: string }[];
    }>();

    for (const e of diff.entries) {
      if (e.type === 'table-added') {
        tableChanges.set(e.table, { name: e.table, status: 'added', addedCols: [], removedCols: [], changedCols: [] });
      } else if (e.type === 'table-removed') {
        tableChanges.set(e.table, { name: e.table, status: 'removed', addedCols: [], removedCols: [], changedCols: [] });
      } else {
        if (!tableChanges.has(e.table)) {
          tableChanges.set(e.table, { name: e.table, status: 'changed', addedCols: [], removedCols: [], changedCols: [] });
        }
        const tc = tableChanges.get(e.table)!;
        if (e.type === 'column-added') tc.addedCols.push(e.column ?? '');
        else if (e.type === 'column-removed') tc.removedCols.push(e.column ?? '');
        else if (e.type === 'column-type-changed' || e.type === 'column-nullability-changed') {
          tc.changedCols.push({ name: e.column ?? '', detail: e.detail });
        }
      }
    }

    const changedTables = [...tableChanges.values()].filter((t) => t.status === 'changed');
    const addedTables = [...tableChanges.values()].filter((t) => t.status === 'added').map((t) => t.name);
    const removedTables = [...tableChanges.values()].filter((t) => t.status === 'removed').map((t) => t.name);

    return {
      hasDrift: diff.hasDrift,
      entries: diff.entries,
      formatted: diff.formatted,
      addedTables,
      removedTables,
      changedTables,
      lockfileHash: lockfile.schemaHash,
      liveHash: liveSchema.schemaHash,
    };
  });
}
