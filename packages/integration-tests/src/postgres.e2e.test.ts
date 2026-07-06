import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startPostgres, stopPostgres,
  runPgPipeline,
  truncateAllPG,
  getRowCountsPG,
  checkForeignKeyOrphansPG,
  importBundleFile,
} from './helpers.js';
import { validatePreFlight } from '@seed-forge/core';

const FIXTURES = ['ecommerce', 'blog', 'saas'] as const;

let connStr: string;

beforeAll(async () => {
  connStr = await startPostgres();
}, 90_000);

afterAll(async () => {
  await stopPostgres();
}, 30_000);

describe.each(FIXTURES)('PostgreSQL — %s', (fixture) => {
  it('runs the full pipeline end-to-end', async () => {
    /* ── Step 1: introspect → validate → generate → seed ────────── */
    const pipeline = await runPgPipeline(connStr, fixture, 42);
    const { schema, graph, plan, rowsWritten, bundleFile, tableData } = pipeline;

    // validate
    const preFlight = validatePreFlight(plan, schema, graph);
    expect(preFlight.valid, `Pre-flight validation failed: ${JSON.stringify(preFlight.entries)}`).toBe(true);

    // All tables have rows
    const allTables = schema.tables.map((t: any) => t.name);
    for (const t of allTables) {
      expect(rowsWritten[t], `Table "${t}" should have rows`).toBeGreaterThan(0);
    }

    // Row counts match what was generated
    const counts = await getRowCountsPG(connStr, allTables);
    for (const t of allTables) {
      expect(counts[t]).toBe(rowsWritten[t]!);
    }

    // Referential integrity — 0 orphans
    const orphans = await checkForeignKeyOrphansPG(connStr, schema);
    expect(orphans).toBe(0);

    /* ── Step 2: export ─────────────────────────────────────────── */
    // bundleFile was already created by runPgPipeline

    /* ── Step 3: wipe ────────────────────────────────────────────── */
    await truncateAllPG(connStr, allTables);
    const postWipe = await getRowCountsPG(connStr, allTables);
    for (const t of allTables) {
      expect(postWipe[t]).toBe(0);
    }

    /* ── Step 4: import ──────────────────────────────────────────── */
    const imported = await importBundleFile(bundleFile, connStr, 'postgres');
    expect(imported.blocked).toBe(false);

    /* ── Step 5: verify identical ────────────────────────────────── */
    const postImport = await getRowCountsPG(connStr, allTables);
    for (const t of allTables) {
      expect(postImport[t]).toBe(rowsWritten[t]!);
    }

    const postOrphans = await checkForeignKeyOrphansPG(connStr, schema);
    expect(postOrphans).toBe(0);
  });

  // Separate test for the saas fixture's polymorphic limitation
  if (fixture === 'saas') {
    it('activity_events table has no FK relationships detected (polymorphic pattern documented limitation)', async () => {
      const pipeline = await runPgPipeline(connStr, fixture, 42);
      const { schema } = pipeline;

      const activityEvents = schema.tables.find((t: any) => t.name === 'activity_events')!;
      expect(activityEvents).toBeDefined();
      // The table has NO foreignKeys — SeedForge doesn't try to wire it
      expect(activityEvents.foreignKeys).toHaveLength(0);

      // This is the documented limitation: polymorphic (resource_type, resource_id)
      // pairs are not detected as relationships. The generator produces default
      // values for all columns — no crash, no silent wrong data.
      // A future enhancement could add plugin hooks for custom relationship resolution.
    });
  }

  if (fixture === 'saas') {
    it('memberships join table carries extra `role` column correctly', async () => {
      const pipeline = await runPgPipeline(connStr, fixture, 42);
      const { schema, rowsWritten } = pipeline;

      const memberships = schema.tables.find((t: any) => t.name === 'memberships')!;
      expect(memberships).toBeDefined();

      // The join table has a composite PK (organization_id, user_id)
      expect(memberships.primaryKey).toEqual(['organization_id', 'user_id']);

      // And an extra data column `role` that is NOT part of the PK or FKs
      const roleCol = memberships.columns.find((c: any) => c.name === 'role');
      expect(roleCol).toBeDefined();

      // Rows were generated for it
      expect(rowsWritten['memberships']).toBeGreaterThan(0);
    });
  }
});
