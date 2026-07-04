import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { write } from './writer.js';
import { buildGraph, analyzeSchema, buildGenerationPlan, generate, WriteProgressEmitter } from '@seedforge/core';
import type { GenerationBatch, SeedForgeConfig } from '@seedforge/core';
import type { RelationshipGraph, DatabaseSchema } from '@seedforge/core';

const CONNECTION_STRING = 'mongodb://localhost:27017';
const DATABASE = 'test_writer';

async function isMongoReachable(): Promise<boolean> {
  try {
    const client = new MongoClient(CONNECTION_STRING, {
      serverSelectionTimeoutMS: 3000,
    });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    await client.close();
    return true;
  } catch {
    return false;
  }
}

let mongoReachable = false;

const schema: DatabaseSchema = {
  dialect: 'mongodb',
  schemaHash: 'test-writer-mongo',
  introspectedAt: '2025-01-01T00:00:00.000Z',
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'email', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 255 },
        { name: 'name', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
      uniqueConstraints: [['email']],
    },
    {
      name: 'products',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'name', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'price', logicalType: 'float', nativeType: 'number', nullable: false, isPrimaryKey: false, isUnique: false },
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
  mongoReachable = await isMongoReachable();
}, 10000);

const itMongo = (name: string, fn: () => Promise<void>) => {
  it(name, async () => {
    if (!mongoReachable) return;
    await fn();
  });
};

async function cleanUp(): Promise<void> {
  const client = new MongoClient(CONNECTION_STRING);
  await client.connect();
  const db = client.db(DATABASE);
  await db.collection('users').deleteMany({});
  await db.collection('products').deleteMany({});
  await client.close();
}

describe('MongoDB writer integration', () => {
  beforeEach(async () => {
    if (!mongoReachable) return;
    await cleanUp();
  });

  afterAll(async () => {
    if (!mongoReachable) return;
    const client = new MongoClient(CONNECTION_STRING);
    await client.connect();
    await client.db(DATABASE).dropDatabase();
    await client.close();
  });

  itMongo('should insert documents', async () => {
    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'users',
        phase: 'insert',
        rows: [
          { id: 'a0000000-0000-0000-0000-000000000001', email: 'alice@test.com', name: 'Alice' },
          { id: 'a0000000-0000-0000-0000-000000000002', email: 'bob@test.com', name: 'Bob' },
        ],
      };
    }

    const result = await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      batches(),
      graph,
      schema,
    );

    expect(result.rowsWritten['users']).toBe(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  itMongo('should work in truncate mode', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000001', name: 'Old', price: 10 }],
      };
    }

    await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      firstBatch(),
      graph,
      schema,
    );

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000002', name: 'New', price: 20 }],
      };
    }

    const result = await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      secondBatch(),
      graph,
      schema,
      { mode: 'truncate' },
    );

    expect(result.rowsWritten['products']).toBe(1);

    const client = new MongoClient(CONNECTION_STRING);
    await client.connect();
    const count = await client.db(DATABASE).collection('products').countDocuments();
    await client.close();
    expect(count).toBe(1);
  });

  itMongo('should work in append mode', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000003', name: 'Existing', price: 10 }],
      };
    }

    await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      firstBatch(),
      graph,
      schema,
    );

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000004', name: 'Appended', price: 20 }],
      };
    }

    const result = await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      secondBatch(),
      graph,
      schema,
      { mode: 'append' },
    );

    expect(result.rowsWritten['products']).toBe(1);

    const client = new MongoClient(CONNECTION_STRING);
    await client.connect();
    const count = await client.db(DATABASE).collection('products').countDocuments();
    await client.close();
    expect(count).toBe(2);
  });

  itMongo('should throw on fresh mode when collection is non-empty', async () => {
    async function* firstBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000005', name: 'Test', price: 10 }],
      };
    }

    await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      firstBatch(),
      graph,
      schema,
    );

    async function* secondBatch(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000006', name: 'Test2', price: 20 }],
      };
    }

    await expect(
      write(
        { connectionString: CONNECTION_STRING, database: DATABASE },
        secondBatch(),
        graph,
        schema,
        { mode: 'fresh' },
      ),
    ).rejects.toThrow(/not empty/);
  });

  itMongo('should emit progress events', async () => {
    const events: any[] = [];

    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000007', name: 'Progress', price: 15 }],
      };
    }

    await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      batches(),
      graph,
      schema,
      { onProgress: (e) => events.push(e) },
    );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });

  itMongo('should emit progress events via emitter', async () => {
    const events: any[] = [];
    const emitter = new WriteProgressEmitter();
    emitter.on('progress', (e) => events.push(e));

    async function* batches(): AsyncGenerator<GenerationBatch> {
      yield {
        table: 'products',
        phase: 'insert',
        rows: [{ id: 'b0000000-0000-0000-0000-000000000008', name: 'Emitter', price: 25 }],
      };
    }

    await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      batches(),
      graph,
      schema,
      { progressEmitter: emitter },
    );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.table === 'products' && e.phase === 'insert')).toBe(true);
  });
});

describe('MongoDB E2E fixture test', () => {
  const mongoSchema: DatabaseSchema = {
    dialect: 'mongodb',
    schemaHash: 'e2e-mongo',
    introspectedAt: '2025-01-01T00:00:00.000Z',
    tables: [
      {
        name: 'users',
        columns: [
          { name: '_id', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 255 },
          { name: 'firstName', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'lastName', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'role', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'createdAt', logicalType: 'timestamp', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'isActive', logicalType: 'boolean', nativeType: 'boolean', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['_id'],
        foreignKeys: [],
        uniqueConstraints: [['email']],
      },
      {
        name: 'products',
        columns: [
          { name: '_id', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'name', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'price', logicalType: 'float', nativeType: 'number', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'sku', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'description', logicalType: 'string', nativeType: 'string', nullable: true, isPrimaryKey: false, isUnique: false },
          { name: 'inStock', logicalType: 'boolean', nativeType: 'boolean', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['_id'],
        foreignKeys: [],
        uniqueConstraints: [['sku']],
      },
      {
        name: 'orders',
        columns: [
          { name: '_id', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'userId', logicalType: 'uuid', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'status', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'total', logicalType: 'float', nativeType: 'number', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'createdAt', logicalType: 'timestamp', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['_id'],
        foreignKeys: [],
        uniqueConstraints: [],
      },
    ],
  };

  const e2eConfig: SeedForgeConfig = {
    connection: { dialect: 'mongodb', connectionString: CONNECTION_STRING, database: DATABASE },
    tables: {
      users: {
        count: 10,
        fields: {
          _id: { kind: 'uuid', params: {} },
          firstName: { kind: 'firstName', params: {} },
          lastName: { kind: 'lastName', params: {} },
          role: { kind: 'weighted-categorical', params: { values: { customer: 0.8, admin: 0.2 } } },
          isActive: { kind: 'boolean-skewed', params: { skew: 0.8 } },
        },
      },
      products: {
        count: 5,
        fields: {
          _id: { kind: 'uuid', params: {} },
          name: { kind: 'faker', params: { method: 'commerce.productName' } },
          description: { kind: 'faker', params: { method: 'lorem.sentence' } },
          inStock: { kind: 'boolean-skewed', params: { skew: 0.7 } },
        },
      },
      orders: {
        countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
        fields: {
          _id: { kind: 'uuid', params: {} },
          status: { kind: 'weighted-categorical', params: { values: { pending: 0.4, shipped: 0.3, delivered: 0.2, cancelled: 0.1 } } },
        },
      },
    },
  };

  const allNames = ['users', 'products', 'orders'];

  itMongo('seeds the full e-commerce fixture end-to-end', async () => {
    const mongoGraph = buildGraph(mongoSchema);
    const inferred = analyzeSchema(mongoSchema);
    const plan = buildGenerationPlan(mongoSchema, e2eConfig, inferred);

    const client = new MongoClient(CONNECTION_STRING);
    await client.connect();
    const db = client.db(DATABASE);
    for (const name of allNames) {
      await db.collection(name).deleteMany({});
    }
    await client.close();

    const emitter = new WriteProgressEmitter();
    const progressEvents: any[] = [];
    emitter.on('progress', (e) => progressEvents.push(e));

    const seed = 42;
    const batchIter = generate(mongoGraph, plan, mongoSchema, seed);
    const result = await write(
      { connectionString: CONNECTION_STRING, database: DATABASE },
      batchIter,
      mongoGraph,
      mongoSchema,
      { mode: 'fresh', progressEmitter: emitter },
    );

    const expectedCounts: Record<string, number> = {};
    const { rowsWritten } = result;
    for (const name of allNames) {
      expectedCounts[name] = rowsWritten[name] ?? 0;
    }

    expect(progressEvents.length).toBeGreaterThanOrEqual(allNames.length);

    const client2 = new MongoClient(CONNECTION_STRING);
    await client2.connect();
    const db2 = client2.db(DATABASE);
    for (const name of allNames) {
      const count = await db2.collection(name).countDocuments();
      expect(count).toBe(expectedCounts[name]);
    }

    // Verify FK integrity: every userId in orders matches a _id in users
    for (const doc of await db2.collection('orders').find({}).toArray()) {
      if (doc.userId) {
        const parent = await db2.collection('users').findOne({ _id: doc.userId });
        expect(parent).not.toBeNull();
      }
    }

    await client2.close();
  });

  itMongo('fresh mode rejects non-empty collections (best-effort guard)', async () => {
    const mongoGraph = buildGraph(mongoSchema);
    const inferred = analyzeSchema(mongoSchema);
    const plan = buildGenerationPlan(mongoSchema, e2eConfig, inferred);

    const client = new MongoClient(CONNECTION_STRING);
    await client.connect();
    const db = client.db(DATABASE);

    // Seed some data so fresh mode will reject a second write
    const seedBatch: GenerationBatch = {
      table: 'users',
      phase: 'insert',
      rows: [{ _id: 'a0000000-0000-0000-0000-000000000001', email: 'test@test.com', firstName: 'Test', lastName: 'User', role: 'customer', createdAt: new Date().toISOString(), isActive: true }],
    };
    await db.collection('users').insertMany(seedBatch.rows);

    const preCounts: Record<string, number> = {};
    for (const name of allNames) {
      preCounts[name] = await db.collection(name).countDocuments();
    }

    await client.close();

    async function* emptyBatch() {
      yield { table: 'products', phase: 'insert' as const, rows: [{ _id: 'b0000000-0000-0000-0000-000000000001', name: 'Test', price: 10, sku: 'TST-001', description: 'desc', inStock: true }] };
    }

    await expect(
      write(
        { connectionString: CONNECTION_STRING, database: DATABASE },
        emptyBatch(),
        mongoGraph,
        mongoSchema,
        { mode: 'fresh' },
      ),
    ).rejects.toThrow(/not empty/);

    const client2 = new MongoClient(CONNECTION_STRING);
    await client2.connect();
    const db2 = client2.db(DATABASE);
    for (const name of allNames) {
      const postCount = await db2.collection(name).countDocuments();
      expect(postCount).toBe(preCounts[name]!);
    }
    await client2.close();
  });
});
