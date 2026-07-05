import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startMongoDB, stopMongoDB,
  runMongoPipeline,
  truncateAllMongo,
  getRowCountsMongo,
  importBundleFile,
} from './helpers.js';
import { validatePreFlight } from '@seedforge/core';

const FIXTURES = ['ecommerce', 'blog', 'saas'] as const;
const DB_NAME = 'seedforge_e2e';

let connStr: string;

beforeAll(async () => {
  connStr = await startMongoDB();
}, 90_000);

afterAll(async () => {
  await stopMongoDB();
}, 30_000);

describe.each(FIXTURES)('MongoDB — %s', (fixture) => {
  it('runs the full pipeline end-to-end', async () => {
    const pipeline = await runMongoPipeline(connStr, DB_NAME, fixture, 42);
    const { schema, graph, plan, rowsWritten, bundleFile } = pipeline;

    const preFlight = validatePreFlight(plan, schema, graph);
    expect(preFlight.valid, `Pre-flight validation failed: ${JSON.stringify(preFlight.entries)}`).toBe(true);

    const allCollections = schema.tables.map((t: any) => t.name);
    for (const c of allCollections) {
      expect(rowsWritten[c], `Collection "${c}" should have rows`).toBeGreaterThan(0);
    }

    // Row counts match
    const counts = await getRowCountsMongo(connStr, DB_NAME, allCollections);
    for (const c of allCollections) {
      expect(counts[c]).toBe(rowsWritten[c]!);
    }

    // MongoDB has no foreign keys, so no FK integrity check.
    // Instead, verify that userId in orders references an existing _id in users.
    if (fixture === 'ecommerce') {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(connStr);
      try {
        await client.connect();
        const db = client.db(DB_NAME);
        const orders = await db.collection('orders').find({}).toArray() as any[];
        for (const doc of orders) {
          if (doc.userId) {
            const parent = await db.collection('users').findOne({ _id: doc.userId });
            expect(parent, `Order references non-existent userId ${doc.userId}`).not.toBeNull();
          }
        }
      } finally {
        await client.close();
      }
    }

    /* ── saas-specific: join-table-with-extra-column + polymorphic ── */
    if (fixture === 'saas') {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(connStr);
      try {
        await client.connect();
        const db = client.db(DB_NAME);

        const memberships = await db.collection('memberships').find({}).toArray() as any[];
        expect(memberships.length).toBeGreaterThan(0);
        for (const doc of memberships) {
          expect(doc).toHaveProperty('role');
        }

        const activityEvents = await db.collection('activity_events').find({}).toArray() as any[];
        expect(activityEvents.length).toBeGreaterThan(0);
        // activity_events has no FK relationships — polymorphic (resource_type, resource_id)
        // is a documented limitation; we just verify rows exist without crashes
      } finally {
        await client.close();
      }
    }

    /* ── Wipe ───────────────────────────────────────────────────── */
    await truncateAllMongo(connStr, DB_NAME, allCollections);
    const postWipe = await getRowCountsMongo(connStr, DB_NAME, allCollections);
    for (const c of allCollections) {
      expect(postWipe[c]).toBe(0);
    }

    /* ── Import ─────────────────────────────────────────────────── */
    const imported = await importBundleFile(bundleFile, connStr, 'mongodb', DB_NAME);
    expect(imported.blocked).toBe(false);

    /* ── Verify identical ───────────────────────────────────────── */
    const postImport = await getRowCountsMongo(connStr, DB_NAME, allCollections);
    for (const c of allCollections) {
      expect(postImport[c]).toBe(rowsWritten[c]!);
    }
  });
});
