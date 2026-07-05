import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildGraph } from '../graph/buildGraph.js';
import { analyzeSchema } from '../semantic/analyzer.js';
import { buildGenerationPlan } from '../config/merge.js';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig } from '../config/types.js';
import { generate } from './engine.js';
import { generateParallel } from './parallel.js';

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
      },
      order_items: {
        countPerParent: { orders: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
      },
    },
  };
}

const REF_DATE = new Date('2025-01-01T00:00:00.000Z').getTime();

async function collectRowsSequential(
  schema: DatabaseSchema,
  config: SeedForgeConfig,
  seed: number,
): Promise<Record<string, Record<string, unknown>[]>> {
  const graph = buildGraph(schema);
  const inferred = analyzeSchema(schema);
  const plan = buildGenerationPlan(schema, config, inferred);

  const rowsByTable: Record<string, Record<string, unknown>[]> = {};
  for await (const batch of generate(graph, plan, schema, seed, { refDate: REF_DATE })) {
    if (batch.phase === 'insert') {
      if (!rowsByTable[batch.table]) rowsByTable[batch.table] = [];
      for (const r of batch.rows) {
        rowsByTable[batch.table]!.push(r);
      }
    }
  }
  return rowsByTable;
}

async function collectRowsParallel(
  schema: DatabaseSchema,
  config: SeedForgeConfig,
  seed: number,
): Promise<Record<string, Record<string, unknown>[]>> {
  const graph = buildGraph(schema);
  const inferred = analyzeSchema(schema);
  const plan = buildGenerationPlan(schema, config, inferred);

  const rowsByTable: Record<string, Record<string, unknown>[]> = {};
  for await (const batch of generateParallel(graph, plan, schema, seed, { refDate: REF_DATE })) {
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

describe('generateParallel determinism', () => {
  const schema = ecommerceSchema();
  const config = ecommerceConfig();

  it('produces same output as sequential generate for seed=42', async () => {
    const parRows = await collectRowsParallel(schema, config, 42);
    const seqRows = await collectRowsSequential(schema, config, 42);

    const allTables = new Set([...Object.keys(seqRows), ...Object.keys(parRows)]);

    for (const table of allTables) {
      const ndjsonSeq = toNDJSON(seqRows[table] ?? []);
      const ndjsonPar = toNDJSON(parRows[table] ?? []);
      expect(ndjsonSeq, `Table ${table} differs between sequential and parallel`).toBe(ndjsonPar);
    }
  });

  it('produces same output as sequential generate for seed=1', async () => {
    const seqRows = await collectRowsSequential(schema, config, 1);
    const parRows = await collectRowsParallel(schema, config, 1);

    const allTables = new Set([...Object.keys(seqRows), ...Object.keys(parRows)]);

    for (const table of allTables) {
      const ndjsonSeq = toNDJSON(seqRows[table] ?? []);
      const ndjsonPar = toNDJSON(parRows[table] ?? []);
      expect(ndjsonSeq, `Table ${table} differs between sequential and parallel`).toBe(ndjsonPar);
    }
  });

  it('all FK references are valid in parallel output', async () => {
    const parRows = await collectRowsParallel(schema, config, 42);

    const pkSets: Record<string, Set<string>> = {};
    for (const table of schema.tables) {
      const pkCol = table.primaryKey[0];
      if (pkCol) {
        pkSets[table.name] = new Set(
          (parRows[table.name] ?? []).map((r) => JSON.stringify(r[pkCol])),
        );
      }
    }

    const errors: string[] = [];
    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        const fkCol = fk.columns[0]!;
        for (const row of parRows[table.name] ?? []) {
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
    expect(errors).toEqual([]);
  });

  it('parallel output is deterministic (same seed produces same result)', async () => {
    const parRows1 = await collectRowsParallel(schema, config, 42);
    const parRows2 = await collectRowsParallel(schema, config, 42);

    const allTables = new Set([...Object.keys(parRows1), ...Object.keys(parRows2)]);
    for (const table of allTables) {
      const ndjson1 = toNDJSON(parRows1[table] ?? []);
      const ndjson2 = toNDJSON(parRows2[table] ?? []);
      expect(ndjson1, `Table ${table} differs between parallel runs`).toBe(ndjson2);
    }
  }, 20_000);
});
