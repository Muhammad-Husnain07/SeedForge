import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportBundle } from './pack.js';
import { importBundle } from './importer.js';
import { checkImportCompatibility } from './compare.js';
import { readBundle, readSnapshotData, readConfigJson, cleanupBundle } from './unpack.js';
import type { BundleManifest } from './types.js';

// ─── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;
let counter = 0;

async function tempBundle(ext = 'sfbundle'): Promise<string> {
  counter++;
  const dir = tmpDir;
  return path.join(dir, `test-${counter}.${ext}`);
}

const referenceRows: Record<string, Record<string, unknown>[]> = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@test.com' },
    { id: 2, name: 'Bob', email: 'bob@test.com' },
  ],
  orders: [
    { id: 1, user_id: 1, total: 100.5 },
    { id: 2, user_id: 2, total: 200.75 },
  ],
};

const sampleConfig = {
  connection: { dialect: 'postgres' as const, connectionString: 'postgres://localhost/test' },
  tables: {
    users: { count: 2 },
    orders: { count: 2 },
  },
};

const sampleLockfile = {
  schemaHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  acknowledgedSchemaHash: null,
  configHash: 'lockfile-config-hash-123',
  seedValue: 42,
  seedforgeVersion: '0.1.0',
  generatedAt: '2025-06-01T00:00:00.000Z',
  perTableRowCounts: { users: 2, orders: 2 },
};

// ─── Tests ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('exportBundle', () => {
  it('exports a bundle without snapshot (no data dir)', async () => {
    const out = await tempBundle();
    const result = await exportBundle({
      out,
      snapshot: false,
      config: sampleConfig,
      lockfile: sampleLockfile,
    });
    expect(result).toBe(path.resolve(out));

    // Verify it's a valid gzip'd tar
    const stat = await fs.stat(result);
    expect(stat.size).toBeGreaterThan(100);

    // Extract and verify contents
    const { tmpDir: extractDir, manifest } = await readBundle(result);
    try {
      expect(manifest.hasSnapshot).toBe(false);
      expect(manifest.tableFiles).toEqual([]);
      expect(manifest.seedValue).toBe(42);
      expect(manifest.schemaHash).toBe(sampleLockfile.schemaHash);
      expect(manifest.configHash).toBe(sampleLockfile.configHash);
      expect(manifest.perTableRowCounts).toEqual({ users: 2, orders: 2 });
      expect(manifest.totalRows).toBe(4);
      expect(manifest.createdBy).toBeTruthy();

      const configJson = await readConfigJson(extractDir);
      expect(configJson).toEqual(sampleConfig);
    } finally {
      await cleanupBundle(extractDir);
    }
  });

  it('exports a bundle with snapshot (gzipd NDJSON data dir)', async () => {
    const out = await tempBundle();
    const result = await exportBundle({
      out,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });
    expect(result).toBe(path.resolve(out));

    const { tmpDir: extractDir, manifest } = await readBundle(result);
    try {
      expect(manifest.hasSnapshot).toBe(true);
      expect(manifest.tableFiles).toHaveLength(2);
      expect(manifest.tableFiles).toContain('users.ndjson.gz');
      expect(manifest.tableFiles).toContain('orders.ndjson.gz');
      expect(manifest.totalRows).toBe(4);

      // Read back snapshot data and verify
      const usersData = await readSnapshotData(extractDir, 'users');
      expect(usersData).toEqual(referenceRows.users);

      const ordersData = await readSnapshotData(extractDir, 'orders');
      expect(ordersData).toEqual(referenceRows.orders);
    } finally {
      await cleanupBundle(extractDir);
    }
  });

  it('includes createdBy and createdAt in manifest', async () => {
    const out = await tempBundle();
    await exportBundle({
      out,
      snapshot: false,
      config: sampleConfig,
      lockfile: sampleLockfile,
    });

    const { tmpDir: extractDir, manifest } = await readBundle(out);
    try {
      expect(manifest.createdBy).toBeTruthy();
      expect(typeof manifest.createdBy).toBe('string');
      expect(manifest.createdAt).toBeTruthy();
      expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt);
    } finally {
      await cleanupBundle(extractDir);
    }
  });
});

describe('importBundle', () => {
  // ─── DoD: Round-trip with snapshot (byte-identical) ──────────────
  it('DoD: round-trip with snapshot reproduces identical dataset', async () => {
    const bundlePath = await tempBundle();
    await exportBundle({
      out: bundlePath,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });

    const captured: Record<string, Record<string, unknown>[]> = {};

    const result = await importBundle({
      file: bundlePath,
      introspect: async () => ({
        schemaHash: sampleLockfile.schemaHash,
        tables: [
          { name: 'users', columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }] },
          { name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'total' }] },
        ],
      }),
      writeRows: async (table, rows) => {
        captured[table] = rows;
        return rows.length;
      },
    });

    expect(result.blocked).toBe(false);
    expect(result.schemaMatch).toBe(true);
    expect(captured.users).toEqual(referenceRows.users);
    expect(captured.orders).toEqual(referenceRows.orders);
    expect(result.rowsImported).toEqual({ users: 2, orders: 2 });
  });

  // ─── DoD: Round-trip without snapshot (replay from seed) ─────────
  it('DoD: round-trip without snapshot replays generation from seed deterministically', async () => {
    const bundlePath = await tempBundle();
    await exportBundle({
      out: bundlePath,
      snapshot: false,
      config: sampleConfig,
      lockfile: sampleLockfile,
    });

    const captured: Record<string, Record<string, unknown>[]> = {};
    let replayedConfig: unknown = null;
    let replayedSeed: number | null = null;

    const result = await importBundle({
      file: bundlePath,
      introspect: async () => ({
        schemaHash: sampleLockfile.schemaHash,
        tables: [
          { name: 'users', columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }] },
          { name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'total' }] },
        ],
      }),
      writeRows: async (table, rows) => {
        captured[table] = rows;
        return rows.length;
      },
      replayGeneration: async (config, seed, writeBatch) => {
        replayedConfig = config;
        replayedSeed = seed;
        // Deterministic generation — produce rows based on config + seed
        const tables = (config as { tables?: Record<string, { count?: number }> })?.tables ?? {};
        for (const [tableName, tableCfg] of Object.entries(tables)) {
          const count = tableCfg.count ?? 0;
          const rows: Record<string, unknown>[] = [];
          for (let i = 0; i < count; i++) {
            rows.push({ id: i + 1, _seed: seed, _table: tableName });
          }
          await writeBatch(tableName, rows);
        }
      },
    });

    expect(result.blocked).toBe(false);
    expect(result.schemaMatch).toBe(true);
    expect(replayedConfig).toEqual(sampleConfig);
    expect(replayedSeed).toBe(42);
    expect(captured.users).toHaveLength(2);
    expect(captured.orders).toHaveLength(2);
    // All rows should have the same seed
    for (const rows of Object.values(captured)) {
      for (const row of rows) {
        expect(row._seed).toBe(42);
      }
    }
  });

  // ─── DoD: Incompatible schema blocked ────────────────────────────
  it('DoD: import against database missing a required table is blocked with specific error', async () => {
    const bundlePath = await tempBundle();
    await exportBundle({
      out: bundlePath,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });

    // Live DB is missing the 'orders' table
    const result = await importBundle({
      file: bundlePath,
      introspect: async () => ({
        schemaHash: 'different-hash-1234567890',
        tables: [
          { name: 'users', columns: [{ name: 'id' }] },
          // orders table is GONE
        ],
      }),
      writeRows: async () => 0,
    });

    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBeTruthy();
    expect(result.blockedReason).toContain('orders');
    expect(result.blockedReason!).not.toContain('generic database error');
  });

  // ─── Schema mismatch with all tables present → warning, not block ─
  it('warns on schema hash mismatch when all tables exist, blocks without --force', async () => {
    const bundlePath = await tempBundle();
    await exportBundle({
      out: bundlePath,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });

    const result = await importBundle({
      file: bundlePath,
      introspect: async () => ({
        schemaHash: 'different-hash-but-all-tables-present',
        tables: [
          { name: 'users', columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }] },
          { name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'total' }] },
        ],
      }),
      writeRows: async () => 0,
    });

    expect(result.blocked).toBe(true);
    expect(result.schemaMatch).toBe(false);
    expect(result.schemaWarnings.length).toBeGreaterThan(0);
    expect(result.blockedReason).toContain('--force');
  });

  // ─── --force overrides schema mismatch ──────────────────────────
  it('--force overrides schema mismatch warning', async () => {
    const bundlePath = await tempBundle();
    await exportBundle({
      out: bundlePath,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });

    const captured: Record<string, Record<string, unknown>[]> = {};

    const result = await importBundle({
      file: bundlePath,
      force: true,
      introspect: async () => ({
        schemaHash: 'different-hash-but-all-tables-present',
        tables: [
          { name: 'users', columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }] },
          { name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'total' }] },
        ],
      }),
      writeRows: async (table, rows) => {
        captured[table] = rows;
        return rows.length;
      },
    });

    expect(result.blocked).toBe(false);
    expect(result.schemaMatch).toBe(false);
    expect(captured.users).toEqual(referenceRows.users);
  });
});

describe('checkImportCompatibility', () => {
  function manifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
    return {
      seedforgeVersion: '0.1.0',
      createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: 'test',
      schemaHash: 'hash-a',
      configHash: 'hash-b',
      seedValue: 42,
      perTableRowCounts: { users: 10, orders: 5 },
      hasSnapshot: false,
      tableFiles: [],
      totalRows: 15,
      ...overrides,
    };
  }

  it('returns compatible when schema hashes match and all tables exist', () => {
    const result = checkImportCompatibility(
      manifest(),
      'hash-a',
      [
        { name: 'users', columns: [{ name: 'id' }] },
        { name: 'orders', columns: [{ name: 'id' }] },
      ],
    );
    expect(result.compatible).toBe(true);
    expect(result.blocks).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.schemaMatch).toBe(true);
  });

  it('blocks when a required table is missing', () => {
    const result = checkImportCompatibility(
      manifest(),
      'hash-a',
      [{ name: 'users', columns: [{ name: 'id' }] }], // orders missing
    );
    expect(result.compatible).toBe(false);
    expect(result.blocks.length).toBe(1);
    expect(result.blocks[0]).toContain('orders');
  });

  it('warns on hash mismatch but all tables exist', () => {
    const result = checkImportCompatibility(
      manifest(),
      'hash-x',
      [
        { name: 'users', columns: [{ name: 'id' }] },
        { name: 'orders', columns: [{ name: 'id' }] },
      ],
    );
    expect(result.compatible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('hash mismatch'))).toBe(true);
    expect(result.schemaMatch).toBe(false);
  });

  it('combines blocks and warnings when both exist', () => {
    const result = checkImportCompatibility(
      manifest(),
      'hash-x',
      [{ name: 'users', columns: [{ name: 'id' }] }], // orders missing
    );
    expect(result.compatible).toBe(false);
    expect(result.blocks.length).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.schemaMatch).toBe(false);
  });
});

describe('manifest.json format', () => {
  it('contains all required fields for human review', async () => {
    const out = await tempBundle();
    await exportBundle({
      out,
      snapshot: true,
      config: sampleConfig,
      lockfile: sampleLockfile,
      tableData: referenceRows,
    });

    const { tmpDir: extractDir, manifest } = await readBundle(out);
    try {
      // All fields that a human would need to review
      expect(manifest).toHaveProperty('seedforgeVersion');
      expect(manifest).toHaveProperty('createdAt');
      expect(manifest).toHaveProperty('createdBy');
      expect(manifest).toHaveProperty('schemaHash');
      expect(manifest).toHaveProperty('configHash');
      expect(manifest).toHaveProperty('seedValue');
      expect(manifest).toHaveProperty('perTableRowCounts');
      expect(manifest).toHaveProperty('hasSnapshot');
      expect(manifest).toHaveProperty('tableFiles');
      expect(manifest).toHaveProperty('totalRows');

      // Human-readable values
      expect(typeof manifest.createdAt).toBe('string');
      expect(typeof manifest.createdBy).toBe('string');
      expect(typeof manifest.seedValue).toBe('number');
      expect(typeof manifest.totalRows).toBe('number');
    } finally {
      await cleanupBundle(extractDir);
    }
  });
});
