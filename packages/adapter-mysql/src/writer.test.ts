import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mysql from 'mysql2/promise';
import { write } from './writer.js';
import { introspect } from './introspect.js';
import { buildGraph, analyzeSchema, buildGenerationPlan, generate, WriteProgressEmitter } from '@seed-forge/core';
import type { GenerationBatch, SeedForgeConfig, WriteProgressEvent } from '@seed-forge/core';
import type { RelationshipGraph, DatabaseSchema } from '@seed-forge/core';

const CONNECTION_STRING = 'mysql://seedforge:seedforge@localhost:3306/ecommerce';

async function isMySqlReachable(): Promise<boolean> {
  try {
    const conn = await mysql.createConnection({
      uri: CONNECTION_STRING,
      connectTimeout: 3000,
    });
    await conn.query('SELECT 1');
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

let mysqlReachable = false;

const schema: DatabaseSchema = {
  dialect: 'mysql',
  schemaHash: 'test-writer-mysql',
  introspectedAt: '2025-01-01T00:00:00.000Z',
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'char(36)', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 255 },
        { name: 'first_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'last_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'role', logicalType: 'enum', nativeType: "enum('customer','admin')", nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['customer', 'admin'] },
        { name: 'referred_by', logicalType: 'uuid', nativeType: 'char(36)', nullable: true, isPrimaryKey: false, isUnique: false },
        { name: 'created_at', logicalType: 'timestamp', nativeType: 'timestamp', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'is_active', logicalType: 'boolean', nativeType: 'tinyint', nullable: false, isPrimaryKey: false, isUnique: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [{ columns: ['referred_by'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' }],
      uniqueConstraints: [['email']],
    },
    {
      name: 'products',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'char(36)', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'price', logicalType: 'float', nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
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
  mysqlReachable = await isMySqlReachable();
}, 10000);

const itMySql = (name: string, fn: () => Promise<void>) => {
  it(name, async () => {
    if (!mysqlReachable) return;
    await fn();
  });
};

async function getRowCounts(conn: mysql.Connection, tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
    counts[t] = Number((rows[0] as Record<string, unknown>)?.cnt ?? 0);
  }
  return counts;
}

async function cleanUp(): Promise<void> {
  const conn = await mysql.createConnection({ uri: CONNECTION_STRING });
  await conn.query('DELETE FROM users');
  await conn.query('DELETE FROM products');
  await conn.end();
}

describe('MySQL writer integration', () => {
  beforeEach(async () => {
    if (!mysqlReachable) return;
    await cleanUp();
  });

  itMySql('should insert rows', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000001', email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString().slice(0, 19).replace('T', ' '), is_active: 1 },
          { id: 'a0000000-0000-0000-0000-000000000002', email: 'bob@test.com', first_name: 'Bob', last_name: 'Jones', role: 'admin', referred_by: null, created_at: new Date('2025-01-01').toISOString().slice(0, 19).replace('T', ' '), is_active: 1 },
        ],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema);

    expect(result.rowsWritten['users']).toBe(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  itMySql('should apply patch phase after inserts', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000010', email: 'patch@test.com', first_name: 'Patch', last_name: 'Test', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString().slice(0, 19).replace('T', ' '), is_active: 1 },
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

    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT referred_by FROM users WHERE email = 'patch@test.com'");
    await conn.end();
    expect(rows[0]?.referred_by).toBe('a0000000-0000-0000-0000-000000000010');
  });

  itMySql('should throw on fresh mode when table is non-empty', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000001', name: 'Test', price: 10, sku: 'TST-001' }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000002', name: 'Test2', price: 20, sku: 'TST-002' }],
      };
    }

    await expect(
      write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'fresh' }),
    ).rejects.toThrow(/not empty/);
  });

  itMySql('should work in truncate mode', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000005', name: 'Old', price: 10, sku: 'OLD-001' }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000006', name: 'New', price: 20, sku: 'NEW-001' }],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'truncate' });

    expect(result.rowsWritten['products']).toBe(1);

    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM products');
    await conn.end();
    expect(Number((rows[0] as Record<string, unknown>)?.cnt)).toBe(1);
  });

  itMySql('should work in append mode', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000007', name: 'Existing', price: 10, sku: 'EXT-001' }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, firstBatch(), graph, schema);

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000008', name: 'Appended', price: 20, sku: 'APP-001' }],
      };
    }

    const result = await write({ connectionString: CONNECTION_STRING }, secondBatch(), graph, schema, { mode: 'append' });

    expect(result.rowsWritten['products']).toBe(1);

    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM products');
    await conn.end();
    expect(Number((rows[0] as Record<string, unknown>)?.cnt)).toBe(2);
  });

  itMySql('should rollback on error leaving db exactly as before', async () => {
    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });
    const allTables = ['users', 'products'];
    const preCounts = await getRowCounts(conn, allTables);
    await conn.end();

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000020', email: 'rollback@test.com', first_name: 'Rollback', last_name: 'Test', role: 'customer', referred_by: null, created_at: new Date('2025-01-01').toISOString().slice(0, 19).replace('T', ' '), is_active: 1 },
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

    const conn2 = await mysql.createConnection({ uri: CONNECTION_STRING });
    const postCounts = await getRowCounts(conn2, allTables);
    await conn2.end();

    expect(postCounts).toEqual(preCounts);
  });

  itMySql('should emit progress events', async () => {
    const events: WriteProgressEvent[] = [];

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000009', name: 'Progress', price: 15, sku: 'PRG-001' }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema, {
      onProgress: (e) => events.push(e),
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });

  itMySql('should emit progress events via emitter', async () => {
    const events: WriteProgressEvent[] = [];
    const emitter = new WriteProgressEmitter();
    emitter.on('progress', (e: WriteProgressEvent) => events.push(e));

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000011', name: 'Emitter', price: 25, sku: 'EMT-001' }],
      };
    }

    await write({ connectionString: CONNECTION_STRING }, batches(), graph, schema, {
      progressEmitter: emitter,
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });
});

describe('MySQL E2E fixture test', () => {
  const uuidField = { kind: 'uuid' as const, params: {} };
  const e2eConfig: SeedForgeConfig = {
    connection: { dialect: 'mysql', connectionString: CONNECTION_STRING },
    tables: {
      users: { count: 10, fields: { id: uuidField, referred_by: uuidField } },
      products: { count: 5, fields: { id: uuidField, name: { kind: 'fullName', params: {} } } },
      tags: { count: 3, fields: { id: uuidField, name: { kind: 'slug', params: {} } } },
      product_tags: { count: 8, fields: { product_id: uuidField, tag_id: uuidField } },
      orders: {
        countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
        fields: { id: uuidField, user_id: uuidField, total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 } },
      },
      order_items: {
        countPerParent: { orders: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
        fields: { id: uuidField, order_id: uuidField, product_id: uuidField, quantity: { kind: 'uniformInt', params: { min: 1, max: 10 } } },
      },
      reviews: {
        countPerParent: { products: { kind: 'uniformInt', params: { min: 0, max: 3 } } },
        fields: { id: uuidField, product_id: uuidField, user_id: uuidField },
      },
    },
  };

  itMySql('seeds the full e-commerce fixture end-to-end with referentially-intact data', async () => {
    const realSchema = await introspect({ connectionString: CONNECTION_STRING });
    const realGraph = buildGraph(realSchema);
    const inferred = analyzeSchema(realSchema);
    const plan = buildGenerationPlan(realSchema, e2eConfig, inferred);

    const allTables = realSchema.tables.map((t) => t.name);
    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (let i = realGraph.insertionOrder.length - 1; i >= 0; i--) {
      await conn.query(`TRUNCATE TABLE \`${realGraph.insertionOrder[i]}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const emitter = new WriteProgressEmitter();
    const progressEvents: WriteProgressEvent[] = [];
    emitter.on('progress', (e: WriteProgressEvent) => progressEvents.push(e));

    const seed = 42;
    const batchIter = generate(realGraph, plan, realSchema, seed);
    const result = await write(
      { connectionString: CONNECTION_STRING },
      batchIter,
      realGraph,
      realSchema,
      { mode: 'fresh', progressEmitter: emitter },
    );

    const { rowsWritten } = result;

    expect(rowsWritten['users']).toBe(10);
    expect(rowsWritten['products']).toBe(5);
    expect(rowsWritten['tags']).toBe(3);
    expect(rowsWritten['product_tags']).toBe(7);

    expect(progressEvents.length).toBeGreaterThanOrEqual(allTables.length);

    const postCounts = await getRowCounts(conn, allTables);
    await conn.end();

    for (const table of allTables) {
      expect(postCounts[table]).toBe(rowsWritten[table] ?? 0);
    }

    const fkConn = await mysql.createConnection({ uri: CONNECTION_STRING });

    for (const table of realSchema.tables) {
      for (const fk of table.foreignKeys) {
        const fkCol = fk.columns[0]!;
        const pkCol = fk.referencedColumns[0]!;
        const refTable = fk.referencedTable;
        const [rows] = await fkConn.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS orphans FROM \`${table.name}\` t ` +
          `WHERE t.\`${fkCol}\` IS NOT NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM \`${refTable}\` p WHERE p.\`${pkCol}\` = t.\`${fkCol}\`)`,
        );
        expect(Number((rows[0] as Record<string, unknown>)?.orphans ?? 0)).toBe(0);
      }
    }

    await fkConn.end();
  });

  itMySql('rolls back completely when a fresh-mode write fails mid-way', async () => {
    const realSchema = await introspect({ connectionString: CONNECTION_STRING });
    const realGraph = buildGraph(realSchema);
    const inferred = analyzeSchema(realSchema);
    const plan = buildGenerationPlan(realSchema, e2eConfig, inferred);

    const allTables = realSchema.tables.map((t) => t.name);
    const conn = await mysql.createConnection({ uri: CONNECTION_STRING });

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (let i = realGraph.insertionOrder.length - 1; i >= 0; i--) {
      await conn.query(`TRUNCATE TABLE \`${realGraph.insertionOrder[i]}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const preCounts = await getRowCounts(conn, allTables);
    await conn.end();

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

    const conn2 = await mysql.createConnection({ uri: CONNECTION_STRING });
    const postCounts = await getRowCounts(conn2, allTables);
    await conn2.end();

    expect(postCounts).toEqual(preCounts);
  });
});
