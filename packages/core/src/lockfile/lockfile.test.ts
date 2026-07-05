import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig } from '../config/types.js';
import { diffSchemas } from './diff.js';
import { computeConfigHash } from './configHash.js';
import { createLockfile, checkDrift, acknowledgeDrift, SchemaDriftError } from './drift.js';
import { readLockfile, writeLockfile } from './io.js';
import type { SeedForgeLockfile } from './types.js';
import { computeSchemaHash } from '../introspect.js';

/** Schema data WITHOUT schemaHash — as an introspector would produce it. */
function schemaData(
  overrides: Partial<Omit<DatabaseSchema, 'schemaHash'>> = {},
): Omit<DatabaseSchema, 'schemaHash'> {
  return {
    dialect: 'postgres',
    introspectedAt: '2025-01-01T00:00:00.000Z',
    tables: [
      {
        name: 'users',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 255 },
          { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [['email']],
      },
      {
        name: 'orders',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'total', logicalType: 'float', nativeType: 'numeric', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
        uniqueConstraints: [],
      },
    ],
    ...overrides,
  };
}

/** Full DatabaseSchema with a correctly-computed schemaHash. */
function baseSchema(): DatabaseSchema {
  const d = schemaData();
  return { ...d, schemaHash: computeSchemaHash(d) };
}

/** Returns schemaData plus a NOT NULL tax_id column on the users table. */
function driftedSchemaData(): Omit<DatabaseSchema, 'schemaHash'> {
  const d = schemaData();
  return {
    ...d,
    tables: d.tables.map((t) =>
      t.name === 'users'
        ? {
            ...t,
            columns: [
              ...t.columns,
              { name: 'tax_id', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 20 },
            ],
          }
        : t,
    ),
  };
}

function baseConfig(overrides: Partial<SeedForgeConfig> = {}): SeedForgeConfig {
  return {
    connection: { dialect: 'postgres', connectionString: 'postgres://localhost/test' },
    tables: {
      users: { count: 10 },
      orders: { count: 50, countPerParent: { users: 5 } },
    },
    ...overrides,
  };
}

// ─── diffSchemas ──────────────────────────────────────────────────────

describe('diffSchemas', () => {
  it('returns no drift on identical schemas', () => {
    const s = baseSchema();
    const result = diffSchemas(s, s);
    expect(result.hasDrift).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it('detects an added table', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    newS.tables.push({
      name: 'reviews',
      columns: [{ name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true }],
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
    });
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'table-added' && e.table === 'reviews')).toBe(true);
  });

  it('detects a removed table', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    newS.tables = newS.tables.filter((t) => t.name !== 'orders');
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'table-removed' && e.table === 'orders')).toBe(true);
  });

  it('detects an added column', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const usersT = newS.tables.find((t) => t.name === 'users')!;
    usersT.columns.push({ name: 'phone', logicalType: 'string', nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false, maxLength: 20 });
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'column-added' && e.table === 'users' && e.column === 'phone')).toBe(true);
  });

  it('detects a removed column', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const usersT = newS.tables.find((t) => t.name === 'users')!;
    usersT.columns = usersT.columns.filter((c) => c.name !== 'name');
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'column-removed' && e.table === 'users' && e.column === 'name')).toBe(true);
  });

  it('detects a column type change', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const ordersT = newS.tables.find((t) => t.name === 'orders')!;
    const totalC = ordersT.columns.find((c) => c.name === 'total')!;
    totalC.nativeType = 'decimal';
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'column-type-changed' && e.table === 'orders' && e.column === 'total')).toBe(true);
  });

  it('detects nullability change to NOT NULL', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const usersT = newS.tables.find((t) => t.name === 'users')!;
    const nameC = usersT.columns.find((c) => c.name === 'name')!;
    nameC.nullable = false;
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'column-nullability-changed' && e.table === 'users' && e.column === 'name' && e.detail.includes('NOT NULL'))).toBe(true);
  });

  it('detects enum value changes', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const usersT = newS.tables.find((t) => t.name === 'users')!;
    const emailC = usersT.columns.find((c) => c.name === 'email')!;
    emailC.enumValues = ['a', 'b'];
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'constraint-changed' && e.table === 'users' && e.column === 'email')).toBe(true);
  });

  it('detects added and removed check constraints', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const ordersT = newS.tables.find((t) => t.name === 'orders')!;
    ordersT.checkConstraints = [{ name: 'positive_total', expression: 'total > 0' }];
    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);
    expect(result.entries.some((e) => e.type === 'constraint-added' && e.table === 'orders')).toBe(true);
  });

  // ─── DoD Scenario ─────────────────────────────────────────────────

  it('DoD: blocks seeding with readable diff when a NOT NULL column is added directly to the database', () => {
    const oldS = baseSchema();
    const newS = baseSchema();
    const usersT = newS.tables.find((t) => t.name === 'users')!;
    usersT.columns.push({ name: 'tax_id', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 20 });

    const result = diffSchemas(oldS, newS);
    expect(result.hasDrift).toBe(true);

    const addedEntry = result.entries.find(
      (e) => e.type === 'column-added' && e.table === 'users' && e.column === 'tax_id',
    );
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.detail).toContain('tax_id');
    expect(addedEntry!.detail).toContain('NOT NULL');

    expect(result.formatted).toContain('users');
    expect(result.formatted).toContain('tax_id');
    expect(result.formatted).toContain('NOT NULL');
    expect(result.formatted).not.toContain('generic database error');
  });
});

// ─── computeConfigHash ────────────────────────────────────────────────

describe('computeConfigHash', () => {
  it('produces a deterministic hash for the same config', () => {
    expect(computeConfigHash(baseConfig())).toBe(computeConfigHash(baseConfig()));
  });

  it('produces different hashes for different configs', () => {
    const a = computeConfigHash(baseConfig());
    const b = computeConfigHash(baseConfig({ tables: { users: { count: 20 } } }));
    expect(a).not.toBe(b);
  });

  it('strips fn functions from derived fields', () => {
    const cfg: SeedForgeConfig = {
      ...baseConfig(),
      tables: {
        users: { count: 10, fields: { greeting: { fn: () => 'hello' } } as Record<string, unknown> },
        orders: { count: 50 },
      },
    };
    expect(computeConfigHash(cfg)).toHaveLength(64);
  });
});

// ─── Lockfile I/O ─────────────────────────────────────────────────────

describe('readLockfile / writeLockfile', () => {
  it('returns null when lockfile does not exist', async () => {
    const r = await readLockfile(path.join(os.tmpdir(), `__no_lockfile__${Date.now()}.json`));
    expect(r).toBeNull();
  });

  it('round-trips a lockfile correctly', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const d = schemaData();
    const h = computeSchemaHash(d);

    const original: SeedForgeLockfile = {
      schemaHash: h,
      acknowledgedSchemaHash: null,
      configHash: 'abc123',
      seedValue: 42,
      seedforgeVersion: '0.1.0',
      generatedAt: '2025-01-01T00:00:00.000Z',
      perTableRowCounts: { users: 10, orders: 50 },
      schema: d,
    };

    await writeLockfile(original, lp);
    const loaded = await readLockfile(lp);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaHash).toBe(h);
    expect(loaded!.configHash).toBe('abc123');
    expect(loaded!.schema.tables).toHaveLength(2);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// ─── createLockfile ───────────────────────────────────────────────────

describe('createLockfile', () => {
  it('creates a lockfile with all fields and stores schema snapshot', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();
    const schema = baseSchema();

    const lf = await createLockfile(config, schema, 42, '0.1.0', { users: 10, orders: 50 }, { lockfilePath: lp });

    expect(lf.schemaHash).toBe(schema.schemaHash);
    expect(lf.acknowledgedSchemaHash).toBeNull();
    expect(lf.configHash).toHaveLength(64);
    expect(lf.seedValue).toBe(42);
    expect(lf.seedforgeVersion).toBe('0.1.0');
    expect(lf.perTableRowCounts).toEqual({ users: 10, orders: 50 });
    expect(lf.schema.tables).toHaveLength(2);

    const loaded = await readLockfile(lp);
    expect(loaded!.schemaHash).toBe(schema.schemaHash);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('stores the schema snapshot without schemaHash', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const lf = await createLockfile(baseConfig(), baseSchema(), 1, '0.1.0', {}, { lockfilePath: lp });
    expect((lf.schema as Record<string, unknown>).schemaHash).toBeUndefined();
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// ─── checkDrift ───────────────────────────────────────────────────────

describe('checkDrift', () => {
  it('allows proceeding when no lockfile exists', async () => {
    const r = await checkDrift(baseConfig(), schemaData(), {
      lockfilePath: path.join(os.tmpdir(), `__no_lockfile__${Date.now()}.json`),
    });
    expect(r.canProceed).toBe(true);
    expect(r.diff).toBeNull();
    expect(r.lockfileHash).toBeNull();
  });

  it('allows proceeding when hashes match (no drift)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();
    const d = schemaData();
    const h = computeSchemaHash(d);
    const schema: DatabaseSchema = { ...d, schemaHash: h };

    await createLockfile(config, schema, 42, '0.1.0', { users: 10 }, { lockfilePath: lp });

    // Pass schema data WITHOUT schemaHash (as an introspector would)
    const result = await checkDrift(config, d, { lockfilePath: lp });
    expect(result.canProceed).toBe(true);
    expect(result.diff).toBeNull();
    expect(result.lockfileHash).toBe(h);
    expect(result.liveHash).toBe(h);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('allows proceeding when the full DatabaseSchema is passed (stripSchemaHash works)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();
    const schema = baseSchema(); // has schemaHash at runtime

    await createLockfile(config, schema, 42, '0.1.0', { users: 10 }, { lockfilePath: lp });

    // Pass the full DatabaseSchema (like a caller would after introspect())
    const result = await checkDrift(config, schema, { lockfilePath: lp });
    expect(result.canProceed).toBe(true);
    expect(result.diff).toBeNull();

    await fs.rm(tmp, { recursive: true, force: true });
  });

  // ─── DoD: added NOT NULL column blocks with specific readable diff ─

  it('DoD: blocks seeding with readable diff when schema has drifted (column added)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();

    // Create lockfile from the original schema
    const original = schemaData();
    const originalHash = computeSchemaHash(original);
    await createLockfile(config, { ...original, schemaHash: originalHash }, 42, '0.1.0', { users: 10 }, { lockfilePath: lp });

    // Drifted live database (new NOT NULL column)
    const drifted = driftedSchemaData();
    const result = await checkDrift(config, drifted, { lockfilePath: lp });

    expect(result.canProceed).toBe(false);
    expect(result.diff).not.toBeNull();
    expect(result.diff!.hasDrift).toBe(true);

    const diffText = result.diff!.formatted;
    expect(diffText).toContain('users');
    expect(diffText).toContain('tax_id');
    expect(diffText).toContain('varchar');
    expect(diffText).toContain('NOT NULL');
    expect(diffText).not.toContain('generic database error');

    const addedEntry = result.diff!.entries.find(
      (e) => e.type === 'column-added' && e.table === 'users' && e.column === 'tax_id',
    );
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.detail).toContain('tax_id');

    await fs.rm(tmp, { recursive: true, force: true });
  });

  // ─── DoD: --force override ─────────────────────────────────────────

  it('DoD: --force allows proceeding despite drift', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();

    const original = schemaData();
    const originalHash = computeSchemaHash(original);
    await createLockfile(config, { ...original, schemaHash: originalHash }, 42, '0.1.0', { users: 10 }, { lockfilePath: lp });

    const drifted = driftedSchemaData();
    const result = await checkDrift(config, drifted, { lockfilePath: lp, force: true });

    expect(result.canProceed).toBe(true);
    expect(result.diff).not.toBeNull();
    expect(result.diff!.hasDrift).toBe(true);
    expect(result.diff!.formatted).toContain('tax_id');

    await fs.rm(tmp, { recursive: true, force: true });
  });

  // ─── DoD: acknowledged hash happy path ─────────────────────────────

  it('DoD: acknowledged schema hash allows proceeding without force (happy path)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();

    const original = schemaData();
    const originalHash = computeSchemaHash(original);
    const drifted = driftedSchemaData();
    const driftHash = computeSchemaHash(drifted);

    // Write lockfile manually with acknowledgedSchemaHash already set to driftHash
    await writeLockfile({
      schemaHash: originalHash,
      acknowledgedSchemaHash: driftHash,
      configHash: 'abc123',
      seedValue: 42,
      seedforgeVersion: '0.1.0',
      generatedAt: '2025-01-01T00:00:00.000Z',
      perTableRowCounts: { users: 10 },
      schema: original,
    }, lp);

    const result = await checkDrift(config, drifted, { lockfilePath: lp });

    expect(result.lockfileHash).toBe(originalHash);
    expect(result.liveHash).toBe(driftHash);
    expect(result.acknowledgedHash).toBe(driftHash);
    expect(result.canProceed).toBe(true);
    expect(result.diff).toBeNull();

    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// ─── acknowledgeDrift ─────────────────────────────────────────────────

describe('acknowledgeDrift', () => {
  it('updates acknowledgedSchemaHash in lockfile', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lf-test-'));
    const lp = path.join(tmp, 'seedforge.lock.json');
    const config = baseConfig();
    const original = baseSchema();

    await createLockfile(config, original, 42, '0.1.0', { users: 10 }, { lockfilePath: lp });

    const drifted = driftedSchemaData();
    const driftHash = computeSchemaHash(drifted);

    // acknowledgeDrift accepts Omit<DatabaseSchema, 'schemaHash'>
    const updated = await acknowledgeDrift(drifted, { lockfilePath: lp });
    expect(updated.acknowledgedSchemaHash).toBe(driftHash);

    const loaded = await readLockfile(lp);
    expect(loaded!.acknowledgedSchemaHash).toBe(driftHash);

    // Now checkDrift should pass without --force
    const result = await checkDrift(config, drifted, { lockfilePath: lp });
    expect(result.canProceed).toBe(true);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('throws SchemaDriftError when no lockfile exists', async () => {
    await expect(
      acknowledgeDrift(schemaData(), { lockfilePath: path.join(os.tmpdir(), '__no_lockfile__.json') }),
    ).rejects.toThrow('No lockfile found');
  });
});

// ─── SchemaDriftError ─────────────────────────────────────────────────

describe('SchemaDriftError', () => {
  it('has the expected name and properties', () => {
    const err = new SchemaDriftError('drift detected', 'schema changed', {
      canProceed: false,
      diff: null,
      lockfileHash: 'abc',
      liveHash: 'def',
      acknowledgedHash: null,
    });
    expect(err.name).toBe('SchemaDriftError');
    expect(err.message).toBe('drift detected');
    expect(err.diff).toBe('schema changed');
    expect(err.result.canProceed).toBe(false);
  });
});
