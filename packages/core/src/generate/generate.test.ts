import { describe, it, expect, vi } from 'vitest';
import { buildGraph } from '../graph/buildGraph.js';
import { analyzeSchema } from '../semantic/analyzer.js';
import { buildGenerationPlan } from '../config/merge.js';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig } from '../config/types.js';
import { generate } from './engine.js';
import type { GenerationBatch } from './types.js';

function ecommerceSchema(): DatabaseSchema {
  return {
    dialect: 'postgres',
    schemaHash: 'test',
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
          { name: 'sku', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'description', logicalType: 'string', nativeType: 'text', nullable: true, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [['sku']],
      },
      {
        name: 'tags',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        uniqueConstraints: [['name']],
      },
      {
        name: 'product_tags',
        columns: [
          { name: 'product_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: false },
          { name: 'tag_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: false },
        ],
        primaryKey: ['product_id', 'tag_id'],
        foreignKeys: [
          { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'CASCADE' },
          { columns: ['tag_id'], referencedTable: 'tags', referencedColumns: ['id'], onDelete: 'CASCADE' },
        ],
        uniqueConstraints: [],
      },
      {
        name: 'orders',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'status', logicalType: 'enum', nativeType: 'order_status', nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['pending', 'shipped', 'delivered', 'cancelled'] },
          { name: 'total', logicalType: 'float', nativeType: 'numeric', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'created_at', logicalType: 'timestamp', nativeType: 'timestamptz', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'updated_at', logicalType: 'timestamp', nativeType: 'timestamptz', nullable: true, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }],
        uniqueConstraints: [],
      },
      {
        name: 'order_items',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'order_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'product_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'quantity', logicalType: 'integer', nativeType: 'int4', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'unit_price', logicalType: 'float', nativeType: 'numeric', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [
          { columns: ['order_id'], referencedTable: 'orders', referencedColumns: ['id'], onDelete: 'CASCADE' },
          { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'CASCADE' },
        ],
        uniqueConstraints: [],
      },
      {
        name: 'reviews',
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'product_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'rating', logicalType: 'integer', nativeType: 'int4', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'body', logicalType: 'string', nativeType: 'text', nullable: true, isPrimaryKey: false, isUnique: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [
          { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'CASCADE' },
          { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' },
        ],
        uniqueConstraints: [],
      },
    ],
  };
}

function ecommerceConfig(): SeedForgeConfig {
  return {
    connection: { dialect: 'postgres', connectionString: 'postgres://localhost:5432/test' },
    tables: {
      users: { count: 10 },
      products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
      tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
      product_tags: { count: 8 },
      orders: {
        countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
        fields: {
          total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
        },
      },
      order_items: {
        countPerParent: { orders: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
      },
      reviews: {
        countPerParent: { products: { kind: 'uniformInt', params: { min: 0, max: 3 } } },
      },
    },
  };
}

async function collectRows(
  schema: DatabaseSchema,
  config: SeedForgeConfig,
  seed: number,
): Promise<Record<string, Record<string, unknown>[]>> {
  const graph = buildGraph(schema);
  const inferred = analyzeSchema(schema);
  const plan = buildGenerationPlan(schema, config, inferred);

  const rowsByTable: Record<string, Record<string, unknown>[]> = {};

  for await (const batch of generate(graph, plan, schema, seed)) {
    if (batch.phase === 'insert') {
      if (!rowsByTable[batch.table]) rowsByTable[batch.table] = [];
      for (const r of batch.rows) {
        rowsByTable[batch.table]!.push(r);
      }
    }
  }

  return rowsByTable;
}

function toNDJSON(rows: Record<string, unknown>[]): string {
  return rows
    .map((r) => JSON.stringify(r, Object.keys(r).sort()))
    .join('\n') + '\n';
}

function collectAllBatches(
  batches: GenerationBatch[],
): Record<string, { insert: Record<string, unknown>[]; patch: Record<string, unknown>[] }> {
  const result: Record<string, { insert: Record<string, unknown>[]; patch: Record<string, unknown>[] }> = {};
  for (const batch of batches) {
    if (!result[batch.table]) result[batch.table] = { insert: [], patch: [] };
    if (batch.phase === 'insert') {
      result[batch.table]!.insert.push(...batch.rows);
    } else {
      result[batch.table]!.patch.push(...batch.rows);
    }
  }
  return result;
}

async function collectBatches(
  schema: DatabaseSchema,
  config: SeedForgeConfig,
  seed: number,
): Promise<GenerationBatch[]> {
  const graph = buildGraph(schema);
  const inferred = analyzeSchema(schema);
  const plan = buildGenerationPlan(schema, config, inferred);
  const batches: GenerationBatch[] = [];
  for await (const batch of generate(graph, plan, schema, seed)) {
    batches.push(batch);
  }
  return batches;
}

function validateFK(
  rowsByTable: Record<string, Record<string, unknown>[]>,
  schema: DatabaseSchema,
): string[] {
  const pkSets: Record<string, Set<string>> = {};
  for (const table of schema.tables) {
    const pkCol = table.primaryKey[0];
    if (pkCol) {
      pkSets[table.name] = new Set(
        (rowsByTable[table.name] ?? []).map((r) => JSON.stringify(r[pkCol])),
      );
    }
  }

  const errors: string[] = [];
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys) {
      const fkCol = fk.columns[0]!;
      for (const row of rowsByTable[table.name] ?? []) {
        const val = row[fkCol];
        if (val == null) continue;
        const parentPKs = pkSets[fk.referencedTable];
        if (!parentPKs || !parentPKs.has(JSON.stringify(val))) {
          errors.push(
            `FK violation: ${table.name}.${fkCol}=${JSON.stringify(val)} references ${fk.referencedTable}.${fk.referencedColumns[0]} but no such PK exists`,
          );
        }
      }
    }
  }
  return errors;
}

describe('generate', () => {
  const schema = ecommerceSchema();
  const config = ecommerceConfig();
  const seed = 42;

  it('produces deterministic output (snapshot test)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const rows1 = await collectRows(schema, config, seed);
    const rows2 = await collectRows(schema, config, seed);
    vi.useRealTimers();

    const allTables = new Set([...Object.keys(rows1), ...Object.keys(rows2)]);

    for (const table of allTables) {
      const ndjson1 = toNDJSON(rows1[table] ?? []);
      const ndjson2 = toNDJSON(rows2[table] ?? []);
      expect(ndjson1).toBe(ndjson2);
    }
  });

  it('different seed produces different output', async () => {
    const rowsSeed42 = await collectRows(schema, config, 42);
    const rowsSeed1 = await collectRows(schema, config, 1);

    const allTables = new Set([...Object.keys(rowsSeed42), ...Object.keys(rowsSeed1)]);

    let anyDifferent = false;
    for (const table of allTables) {
      const ndjson42 = toNDJSON(rowsSeed42[table] ?? []);
      const ndjson1 = toNDJSON(rowsSeed1[table] ?? []);
      if (ndjson42 !== ndjson1) anyDifferent = true;
    }

    expect(anyDifferent).toBe(true);
  });

  it('different seed still produces valid FK references', async () => {
    const rows1 = await collectRows(schema, config, 1);
    const errors1 = validateFK(rows1, schema);
    expect(errors1).toEqual([]);

    const rows99 = await collectRows(schema, config, 99);
    const errors99 = validateFK(rows99, schema);
    expect(errors99).toEqual([]);
  });

  it('all FK references are valid (referential integrity)', async () => {
    const rows = await collectRows(schema, config, seed);
    const errors = validateFK(rows, schema);
    expect(errors).toEqual([]);
  });

  it('self-referential table emits patch phase', async () => {
    const batches = await collectBatches(schema, config, seed);
    const byTable = collectAllBatches(batches);

    expect(byTable['users']).toBeDefined();
    expect(byTable['users']!.insert.length).toBeGreaterThan(0);

    const patchBatches = batches.filter((b) => b.phase === 'patch');
    expect(patchBatches.length).toBeGreaterThanOrEqual(1);
    expect(patchBatches[0]!.table).toBe('users');
    expect(patchBatches[0]!.patchInfo?.patchColumn).toBe('referred_by');
  });

  it('patch batch values reference existing PKs', async () => {
    const batches = await collectBatches(schema, config, seed);
    const byTable = collectAllBatches(batches);

    const userPKs = new Set(
      (byTable['users']?.insert ?? []).map((r) => JSON.stringify(r.id)),
    );

    for (const batch of batches) {
      if (batch.phase === 'patch' && batch.table === 'users') {
        for (const row of batch.rows) {
          const fkVal = row['referred_by'];
          if (fkVal != null) {
            expect(userPKs.has(JSON.stringify(fkVal))).toBe(true);
          }
        }
      }
    }
  });

  it('no rows have duplicate PKs', async () => {
    const rows = await collectRows(schema, config, seed);

    for (const table of schema.tables) {
      const tableRows = rows[table.name] ?? [];
      const pkCol = table.primaryKey[0];
      if (!pkCol || table.primaryKey.length > 1) continue;

      const seen = new Set<string>();
      for (const r of tableRows) {
        const pkVal = JSON.stringify(r[pkCol]);
        expect(seen.has(pkVal)).toBe(false);
        seen.add(pkVal);
      }
    }
  });

  it('no rows violate unique constraints', async () => {
    const rows = await collectRows(schema, config, seed);

    for (const table of schema.tables) {
      if (table.uniqueConstraints.length === 0) continue;
      const tableRows = rows[table.name] ?? [];

      for (const constraint of table.uniqueConstraints) {
        const seen = new Set<string>();
        for (const r of tableRows) {
          const key = constraint.map((c) => JSON.stringify(r[c])).join('|');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('generates rows for all tables in the schema', async () => {
    const rows = await collectRows(schema, config, seed);

    for (const table of schema.tables) {
      expect(rows[table.name]).toBeDefined();
      expect(rows[table.name]!.length).toBeGreaterThan(0);
    }
  });

  it('respects insertion order from graph', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;

    const usersIdx = order.indexOf('users');
    const productsIdx = order.indexOf('products');
    const ordersIdx = order.indexOf('orders');
    const orderItemsIdx = order.indexOf('order_items');

    expect(usersIdx).toBeLessThan(ordersIdx);
    expect(ordersIdx).toBeLessThan(orderItemsIdx);
    expect(productsIdx).toBeLessThan(orderItemsIdx);
  });

  it('junction table cardinality matches configuration', async () => {
    const rows = await collectRows(schema, config, seed);
    const productTags = rows['product_tags'] ?? [];
    expect(productTags.length).toBeGreaterThan(0);
    expect(productTags.length).toBeLessThanOrEqual(40);
  });

  it('nullable columns contain some nulls', async () => {
    const rows = await collectRows(schema, config, seed);

    const nullableCols = new Set<string>();
    for (const table of schema.tables) {
      for (const col of table.columns) {
        if (col.nullable) nullableCols.add(`${table.name}.${col.name}`);
      }
    }

    let hasNull = false;
    for (const table of schema.tables) {
      for (const row of rows[table.name] ?? []) {
        for (const col of table.columns) {
          if (col.nullable && row[col.name] === null) {
            hasNull = true;
            break;
          }
        }
        if (hasNull) break;
      }
      if (hasNull) break;
    }

    expect(hasNull).toBe(true);
  });

  it('yields multiple batches for a large table', async () => {
    const largeSchema: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'large',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'large',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 255 },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
    };

    const largeConfig: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        large: { count: 2500 },
      },
    };

    const batches = await collectBatches(largeSchema, largeConfig, seed);
    const largeBatches = batches.filter((b) => b.table === 'large' && b.phase === 'insert');

    expect(largeBatches.length).toBeGreaterThanOrEqual(3);

    let totalRows = 0;
    for (const b of largeBatches) totalRows += b.rows.length;
    expect(totalRows).toBe(2500);
  });

  it('throws GenerationError on unsatisfiable unique constraint', async () => {
    const tinySchema: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'tiny',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'tiny',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'val', logicalType: 'integer', nativeType: 'int4', nullable: false, isPrimaryKey: false, isUnique: true },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [['val']],
        },
      ],
    };

    const tinyConfig: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        tiny: {
          count: 1000,
          fields: {
            val: { kind: 'bounded-integer', params: { min: 0, max: 3 } },
          },
        },
      },
    };

    const graph = buildGraph(tinySchema);
    const inferred = analyzeSchema(tinySchema);
    const plan = buildGenerationPlan(tinySchema, tinyConfig, inferred);

    const { GenerationError } = await import('./types.js');
    let caughtError: unknown = null;

    const gen = generate(graph, plan, tinySchema, seed);
    try {
      for await (const _unused of gen) {
        // no-op: just iterating to trigger potential error
      }
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(GenerationError);
    if (caughtError instanceof GenerationError) {
      expect(caughtError.table).toBe('tiny');
    }
  });
});

describe('generate with different seeds', () => {
  const schema = ecommerceSchema();
  const config = ecommerceConfig();

  it('seed=42 and seed=1 produce different NDJSON', async () => {
    const rows42 = await collectRows(schema, config, 42);
    const rows1 = await collectRows(schema, config, 1);

    const tables = Object.keys(rows42);
    let totalDiff = 0;
    for (const table of tables) {
      const ndjson42 = toNDJSON(rows42[table]!);
      const ndjson1 = toNDJSON(rows1[table]!);
      if (ndjson42 !== ndjson1) totalDiff++;
    }

    expect(totalDiff).toBeGreaterThan(0);
  });

  it('seed=42 and seed=1 both produce valid FK refs', async () => {
    const rows42 = await collectRows(schema, config, 42);
    const rows1 = await collectRows(schema, config, 1);
    expect(validateFK(rows42, schema)).toEqual([]);
    expect(validateFK(rows1, schema)).toEqual([]);
  });
});
