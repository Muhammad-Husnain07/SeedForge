import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'node:fs';
import {
  startSQLite,
  runSQLitePipeline,
  truncateAllSQLite,
  getRowCountsSQLite,
  checkForeignKeyOrphansSQLite,
  importBundleFile,
} from './helpers.js';
import { validatePreFlight } from '@seed-forge/core';

const FIXTURES = ['ecommerce', 'blog', 'saas'] as const;

let dbPath: string;

beforeAll(async () => {
  dbPath = startSQLite();
}, 30_000);

afterAll(async () => {
  try { unlinkSync(dbPath); } catch { /* best-effort cleanup */ }
}, 10_000);

describe.each(FIXTURES)('SQLite — %s', (fixture) => {
  it('runs the full pipeline end-to-end', async () => {
    const pipeline = await runSQLitePipeline(dbPath, fixture, 42);
    const { schema, graph, plan, rowsWritten, bundleFile } = pipeline;

    const preFlight = validatePreFlight(plan, schema, graph);
    expect(preFlight.valid, `Pre-flight validation failed: ${JSON.stringify(preFlight.entries)}`).toBe(true);

    const allTables = schema.tables.map((t: any) => t.name);
    for (const t of allTables) {
      expect(rowsWritten[t], `Table "${t}" should have rows`).toBeGreaterThan(0);
    }

    // Row counts match
    const counts = await getRowCountsSQLite(dbPath, allTables);
    for (const t of allTables) {
      expect(counts[t]).toBe(rowsWritten[t]!);
    }

    // Referential integrity
    const orphans = await checkForeignKeyOrphansSQLite(dbPath, schema);
    expect(orphans).toBe(0);

    /* ── Wipe ───────────────────────────────────────────────────── */
    await truncateAllSQLite(dbPath, allTables);
    const postWipe = await getRowCountsSQLite(dbPath, allTables);
    for (const t of allTables) {
      expect(postWipe[t]).toBe(0);
    }

    /* ── Import ─────────────────────────────────────────────────── */
    const imported = await importBundleFile(bundleFile, dbPath, 'sqlite');
    expect(imported.blocked).toBe(false);

    /* ── Verify identical ───────────────────────────────────────── */
    const postImport = await getRowCountsSQLite(dbPath, allTables);
    for (const t of allTables) {
      expect(postImport[t]).toBe(rowsWritten[t]!);
    }

    // Referential integrity after import
    const orphansAfterImport = await checkForeignKeyOrphansSQLite(dbPath, schema);
    expect(orphansAfterImport).toBe(0);
  }, 60_000);
});
