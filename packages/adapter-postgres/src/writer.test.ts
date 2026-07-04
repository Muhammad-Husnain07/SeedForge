import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import pg from 'pg';
import { write } from './writer.js';
import { introspect } from './introspect.js';
import { buildGraph, analyzeSchema, buildGenerationPlan, generate, WriteProgressEmitter } from '@seedforge/core';
import type { GenerationBatch, SeedForgeConfig } from '@seedforge/core';
import type { RelationshipGraph, DatabaseSchema } from '@seedforge/core';

const CONNECTION_STRING = 'postgres://seedforge:seedforge@localhost:5432/ecommerce';

async function isPostgresReachable(): Promise<boolean> {
  try {
    const pool = new pg.Pool({
      connectionString: CONNECTION_STRING,
      connectionTimeoutMillis: 3000,
    });
    await pool.query('SELECT 1');
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

let pgReachable = false;

const schema: DatabaseSchema = {
  dialect: 'postgres',
  schemaHash: 'test-writer',
  introspectedAt: '2025-01-01T00:00:00.000Z',
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 255 },
        { name: 'first_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'last_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'role', logicalType: 'enum', nativeType: 'user_role', nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['customer', 'admin'] },
        { name: 'referred_by', logicalType: 'uuid', nativeType: 'uuid', nullable: true, isPrimaryKey: false, isUnique: false },
        { name: 'created_at', logicalType: 'timestamp', nativeType: 'timestamptz', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'is_active', logicalType: 'boolean', nativeType: 'bool', nullable: false, isPrimaryKey: false, isUnique: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [{ columns: ['referred_by'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' }],
      uniqueConstraints: [['email']],
    },
    {
      name: 'products',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'price', logicalType: 'float', nativeType: 'numeric', nullable: false, isPrimaryKey: false, isUnique: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [],
    },
  ],
};

const graph: RelationshipGraph = {
  insertionOrder: ['users', 'products'],
  adjacencyList: {
    users: [],
    products: [],
  },
};

beforeAll(async () => {
  pgReachable = await isPostgresReachable();
}, 10000);

const itPg = (name: string, fn: () => Promise<void>) => {
  it(name, async () => {
    if (!pgReachable) return;
    await fn();
  });
};

async function getRowCounts(pool: pg.Pool, tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) AS cnt FROM "${t}"`);
    counts[t] = parseInt(res.rows[0]?.cnt ?? '0', 10);
  }
  return counts;
}

async function cleanUp(): Promise<void> {
  const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM products');
  await pool.end();
}

describe('Postgres writer integration', () => {
  beforeEach(async () => {
    if (!pgReachable) return;
    await cleanUp();
  });

  itPg('should insert rows via multi-row insert', async () => {
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000001', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString(), is_active: true },
          { id: 'a0000000-0000-0000-0000-000000000002', email: 'bob@test.com', first_name: 'Bob', last_name: 'Jones', role: 'admin', referred_by: null, created_at: new Date('2025-01-01').toISOString(), is_active: true },
        ],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema);

    expect(result.rowsWritten['users']).toBe(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  itPg('should insert rows via COPY for large batches', async () => {
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: Array.from({ length: 100 }, (_, i) => ({
          id: `a0000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          email: `user${i}@test.com`,
          first_name: 'User',
          last_name: `${i}`,
          role: 'customer',
          referred_by: null,
          created_at: new Date('2025-01-01').toISOString(),
          is_active: true,
        })),
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema);

    expect(result.rowsWritten['users']).toBe(100);
  });

  itPg('should apply patch phase after inserts', async () => {
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000010', email: 'patch@test.com', first_name: 'Patch', last_name: 'Test', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString(), is_active: true },
        ],
      };
      yield {
        table: 'users',
        phase: 'patch',
        patchInfo: { patchColumn: 'referred_by', pkColumn: 'id' },
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000010', referred_by: 'a0000000-0000-0000-0000-000000000010' },
        ],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema);

    expect(result.rowsWritten['users']).toBe(1);

    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    const res = await pool.query("SELECT referred_by FROM users WHERE email = 'patch@test.com'");
    await pool.end();
    expect(res.rows[0]?.referred_by).toBe('a0000000-0000-0000-0000-000000000010');
  });

  itPg('should throw on fresh mode when table is non-empty', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000001', name: 'Test', price: 10 }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000002', name: 'Test2', price: 20 }],
      };
    }

    await expect(
      write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'fresh' }),
    ).rejects.toThrow(/not empty/);
  });

  itPg('should work in truncate mode', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000005', name: 'Old', price: 10 }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000006', name: 'New', price: 20 }],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'truncate' });

    expect(result.rowsWritten['products']).toBe(1);

    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    const res = await pool.query('SELECT COUNT(*) AS cnt FROM products');
    await pool.end();
    expect(parseInt(res.rows[0]?.cnt ?? '0', 10)).toBe(1);
  });

  itPg('should work in append mode', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000007', name: 'Existing', price: 10 }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000008', name: 'Appended', price: 20 }],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'append' });

    expect(result.rowsWritten['products']).toBe(1);

    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    const res = await pool.query('SELECT COUNT(*) AS cnt FROM products');
    await pool.end();
    expect(parseInt(res.rows[0]?.cnt ?? '0', 10)).toBe(2);
  });

  itPg('should rollback on error leaving db exactly as before', async () => {
    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    const allTables = ['users', 'products'];
    const preCounts = await getRowCounts(pool, allTables);
    await pool.end();

    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000020', email: 'rollback@test.com', first_name: 'Rollback', last_name: 'Test', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString(), is_active: true },
        ],
      };
      yield {
        table: 'nonexistent',
        phase: 'insert',
        rows: [{ id: 'x' }],
      };
    }

    await expect(
      write({ connectionString: CONNECTION_STRING }, batches(), graph, schema),
    ).rejects.toThrow();

    const pool2 = new pg.Pool({ connectionString: CONNECTION_STRING });
    const postCounts = await getRowCounts(pool2, allTables);
    await pool2.end();

    expect(postCounts).toEqual(preCounts);
  });

  itPg('should emit progress events', async () => {
    const events: any[] = [];

    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000009', name: 'Progress', price: 15 }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema, {
      onProgress: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });

  itPg('should emit progress events via emitter', async () => {
    const events: any[] = [];
    const emitter = new WriteProgressEmitter();
    emitter.on('progress', (e) => events.push(e));

    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000011', name: 'Emitter', price: 25 }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema, {
      progressEmitter: emitter,
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });
});

describe('Postgres E2E fixture test', () => {
  const e2eConfig: SeedForgeConfig = {
    connection: { dialect: 'postgres', connectionString: CONNECTION_STRING },
    tables: {
      users: { count: 10 },
      products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
      tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
      product_tags: { count: 8 },
      orders: {
        countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
        fields: { total: { fn: (row: Record<string, unknown>, _ctx: unknown) => 100 } },
      },
      order_items: {
        countPerParent: { orders: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
      },
      reviews: {
        countPerParent: { products: { kind: 'uniformInt', params: { min: 0, max: 3 } } },
      },
    },
  };

  itPg('seeds the full e-commerce fixture end-to-end with referentially-intact data', async () => {
    const realSchema = await introspect({ connectionString: CONNECTION_STRING });
    const realGraph = buildGraph(realSchema);
    const inferred = analyzeSchema(realSchema);
    const plan = buildGenerationPlan(realSchema, e2eConfig, inferred);

    const allTables = realSchema.tables.map((t) => t.name);
    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

    await pool.query('BEGIN');
    for (let i = realGraph.insertionOrder.length - 1; i >= 0; i--) {
      await pool.query(`TRUNCATE TABLE "${realGraph.insertionOrder[i]}" CASCADE`);
    }
    await pool.query('COMMIT');

    const emitter = new WriteProgressEmitter();
    const progressEvents: any[] = [];
    emitter.on('progress', (e) => progressEvents.push(e));

    const seed = 42;
    const batchIter = generate(realGraph, plan, realSchema, seed);
    const result = await write(
      { connectionString: CONNECTION_STRING },
      batchIter,
      realGraph,
      realSchema,
      { mode: 'fresh', progressEmitter: emitter },
    );

    const expectedRowCounts: Record<string, number> = {};
    for (const tableName of realGraph.insertionOrder) {
      expectedRowCounts[tableName] = result.rowsWritten[tableName] ?? 0;
    }
    const { rowsWritten } = result;

    expect(rowsWritten['users']).toBe(10);
    expect(rowsWritten['products']).toBe(5);
    expect(rowsWritten['tags']).toBe(3);
    expect(rowsWritten['product_tags']).toBe(8);

    expect(progressEvents.length).toBeGreaterThanOrEqual(allTables.length);

    const postCounts = await getRowCounts(pool, allTables);
    await pool.end();

    for (const table of allTables) {
      expect(postCounts[table]).toBe(rowsWritten[table] ?? 0);
    }

    const fkPool = new pg.Pool({ connectionString: CONNECTION_STRING });

    for (const table of realSchema.tables) {
      for (const fk of table.foreignKeys) {
        const fkCol = fk.columns[0]!;
        const pkCol = fk.referencedColumns[0]!;
        const refTable = fk.referencedTable;
        const res = await fkPool.query(
          `SELECT COUNT(*) AS orphans FROM "${table.name}" t ` +
          `WHERE t."${fkCol}" IS NOT NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM "${refTable}" p WHERE p."${pkCol}" = t."${fkCol}")`,
        );
        expect(parseInt(res.rows[0]?.orphans ?? '0', 10)).toBe(0);
      }
    }

    await fkPool.end();
  });

  itPg('rolls back completely when a fresh-mode write fails mid-way', async () => {
    const realSchema = await introspect({ connectionString: CONNECTION_STRING });
    const realGraph = buildGraph(realSchema);
    const inferred = analyzeSchema(realSchema);
    const plan = buildGenerationPlan(realSchema, e2eConfig, inferred);

    const allTables = realSchema.tables.map((t) => t.name);
    const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

    await pool.query('BEGIN');
    for (let i = realGraph.insertionOrder.length - 1; i >= 0; i--) {
      await pool.query(`TRUNCATE TABLE "${realGraph.insertionOrder[i]}" CASCADE`);
    }
    await pool.query('COMMIT');

    const preCounts = await getRowCounts(pool, allTables);
    await pool.end();

    async function* badBatches() {
      const seed = 42;
      const gen = generate(realGraph, plan, realSchema, seed);
      let count = 0;
      for await (const batch of gen) {
        count++;
        yield batch;
        if (count > 3) {
          throw new Error('simulated mid-write failure');
        }
      }
    }

    await expect(
      write({ connectionString: CONNECTION_STRING }, badBatches(), realGraph, realSchema, { mode: 'fresh' }),
    ).rejects.toThrow(/simulated mid-write failure/);

    const pool2 = new pg.Pool({ connectionString: CONNECTION_STRING });
    const postCounts = await getRowCounts(pool2, allTables);
    await pool2.end();

    expect(postCounts).toEqual(preCounts);
  });
});
