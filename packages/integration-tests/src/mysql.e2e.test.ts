import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startMySQL, stopMySQL,
  runMysqlPipeline,
  truncateAllMySQL,
  getRowCountsMySQL,
  checkForeignKeyOrphansMySQL,
  importBundleFile,
} from './helpers.js';
import { validatePreFlight } from '@seedforge/core';

const FIXTURES = ['ecommerce', 'blog', 'saas'] as const;

let connStr: string;

beforeAll(async () => {
  connStr = await startMySQL();
}, 90_000);

afterAll(async () => {
  await stopMySQL();
}, 30_000);

describe.each(FIXTURES)('MySQL — %s', (fixture) => {
  it('runs the full pipeline end-to-end', async () => {
    const pipeline = await runMysqlPipeline(connStr, fixture, 42);
    const { schema, graph, plan, rowsWritten, bundleFile } = pipeline;

    const preFlight = validatePreFlight(plan, schema, graph);
    expect(preFlight.valid, `Pre-flight validation failed: ${JSON.stringify(preFlight.entries)}`).toBe(true);

    const allTables = schema.tables.map((t: any) => t.name);
    for (const t of allTables) {
      expect(rowsWritten[t], `Table "${t}" should have rows`).toBeGreaterThan(0);
    }

    // Row counts match
    const counts = await getRowCountsMySQL(connStr, allTables);
    for (const t of allTables) {
      expect(counts[t]).toBe(rowsWritten[t]!);
    }

    // Referential integrity
    const orphans = await checkForeignKeyOrphansMySQL(connStr, schema);
    expect(orphans).toBe(0);

    /* ── Wipe ───────────────────────────────────────────────────── */
    await truncateAllMySQL(connStr, allTables);
    const postWipe = await getRowCountsMySQL(connStr, allTables);
    for (const t of allTables) {
      expect(postWipe[t]).toBe(0);
    }

    /* ── Import ─────────────────────────────────────────────────── */
    const imported = await importBundleFile(bundleFile, connStr, 'mysql');
    expect(imported.blocked).toBe(false);

    /* ── Verify identical ───────────────────────────────────────── */
    const postImport = await getRowCountsMySQL(connStr, allTables);
    for (const t of allTables) {
      expect(postImport[t]).toBe(rowsWritten[t]!);
    }

    const postOrphans = await checkForeignKeyOrphansMySQL(connStr, schema);
    expect(postOrphans).toBe(0);
  });

  if (fixture === 'saas') {
    it('activity_events table has no FK relationships (polymorphic — documented limitation)', async () => {
      const pipeline = await runMysqlPipeline(connStr, fixture, 42);
      const { schema } = pipeline;

      const ae = schema.tables.find((t: any) => t.name === 'activity_events')!;
      expect(ae).toBeDefined();
      expect(ae.foreignKeys).toHaveLength(0);
    });

    it('memberships join table carries extra `role` column', async () => {
      const pipeline = await runMysqlPipeline(connStr, fixture, 42);
      const { schema, rowsWritten } = pipeline;

      const m = schema.tables.find((t: any) => t.name === 'memberships')!;
      expect(m).toBeDefined();
      expect(m.primaryKey).toEqual(['organization_id', 'user_id']);
      expect(m.columns.some((c: any) => c.name === 'role')).toBe(true);
      expect(rowsWritten['memberships']).toBeGreaterThan(0);
    });
  }
});
