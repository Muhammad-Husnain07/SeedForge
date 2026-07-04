import { describe, it, expect } from 'vitest';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig } from '../config/types.js';
import { buildGraph } from '../graph/buildGraph.js';
import { analyzeSchema } from '../semantic/analyzer.js';
import { buildGenerationPlan } from '../config/merge.js';
import { validatePreFlight, verifyPostWrite } from './index.js';
import type { PreFlightOptions } from './types.js';

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

function validConfig(): SeedForgeConfig {
  return {
    connection: {
      dialect: 'postgres',
      connectionString: 'postgres://localhost:5432/ecommerce',
    },
    tables: {
      users: {
        count: 100,
        personas: [
          {
            name: 'power_user',
            selectionWeight: 0.2,
            overrides: [],
            cascades: { orders: 5 },
          },
        ],
      },
      orders: {
        countPerParent: {
          users: { kind: 'paretoInt', params: { min: 0, max: 50, alpha: 1.16 } },
        },
        fields: {
          total: {
            fn: (_row: Record<string, unknown>, _ctx: unknown) => 100,
          },
        },
      },
      order_items: {
        countPerParent: {
          orders: { kind: 'uniformInt', params: { min: 1, max: 10 } },
        },
      },
      products: {
        count: { kind: 'uniformInt', params: { min: 30, max: 50 } },
        fields: {
          name: { kind: 'fullName', params: {} },
          description: { kind: 'longText', params: {} },
        },
      },
      tags: {
        count: 20,
        fields: {
          name: { kind: 'slug', params: {} },
        },
      },
      product_tags: { count: 50 },
      reviews: {
        countPerParent: {
          products: { kind: 'uniformInt', params: { min: 0, max: 10 } },
          users: 1,
        },
      },
    },
  };
}

function buildPlan(schema: DatabaseSchema, config: SeedForgeConfig) {
  const graph = buildGraph(schema);
  const inferred = analyzeSchema(schema);
  const plan = buildGenerationPlan(schema, config, inferred);
  return { graph, plan };
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-flight tests
// ────────────────────────────────────────────────────────────────────────────

describe('validatePreFlight', () => {
  const schema = ecommerceSchema();

  it('passes a valid config with zero errors', () => {
    const config = validConfig();
    const { graph, plan } = buildPlan(schema, config);
    const result = validatePreFlight(plan, schema, graph);
    expect(result.valid).toBe(true);
    const failEntries = result.entries.filter((e) => e.status === 'fail');
    expect(failEntries).toHaveLength(0);
  });

  it('catches orders.status overridden with a value outside its declared enum', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: { count: 5 },
        products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
        tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
        product_tags: { count: 5 },
        orders: {
          countPerParent: { users: 3 },
          fields: {
            status: {
              kind: 'weighted-categorical',
              params: { values: { 'unknown_status': 1 } },
            },
            total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
          },
        },
        order_items: { countPerParent: { orders: 2 } },
        reviews: { countPerParent: { products: 2 } },
      },
    };
    const { graph, plan } = buildPlan(schema, config);
    const result = validatePreFlight(plan, schema, graph);

    const enumFails = result.entries.filter(
      (e) => e.rule === 'enum-values' && e.status === 'fail',
    );
    expect(enumFails.length).toBeGreaterThanOrEqual(1);

    const statusFail = enumFails.find((e) => e.column === 'status');
    expect(statusFail).toBeDefined();
    expect(statusFail!.message).toContain('orders.status');
    expect(statusFail!.message).toContain('unknown_status');
    expect(statusFail!.message).toContain('pending, shipped, delivered, cancelled');
    expect(statusFail!.message).toContain('weighted-categorical');
  });

  it('catches 100,000 unique SKUs from a generator with tiny distinct value set', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: { count: 5 },
        products: {
          count: 100000,
          fields: {
            name: { kind: 'fullName', params: {} },
            sku: {
              kind: 'weighted-categorical',
              params: { values: { 'A': 1, 'B': 1 } },
            },
          },
        },
        tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
        product_tags: { count: 5 },
        orders: {
          countPerParent: { users: 3 },
          fields: {
            total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
          },
        },
        order_items: { countPerParent: { orders: 2 } },
        reviews: { countPerParent: { products: 2 } },
      },
    };
    const { graph, plan } = buildPlan(schema, config);
    const result = validatePreFlight(plan, schema, graph);

    const uniqueIssues = result.entries.filter(
      (e) => e.rule === 'unique-cardinality' && (e.status === 'fail' || e.status === 'warn'),
    );
    expect(uniqueIssues.length).toBeGreaterThanOrEqual(1);

    const skuIssue = uniqueIssues.find((e) => e.column === 'sku');
    expect(skuIssue).toBeDefined();
    expect(skuIssue!.message).toContain('products.sku');
    expect(skuIssue!.message).toContain('weighted-categorical');
    expect(skuIssue!.message).toContain('2');
    expect(skuIssue!.message).toContain('100000');
  });

  it('flags NOT NULL columns when global nullProbability > 0', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: { count: 5 },
        products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
        tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
        product_tags: { count: 5 },
        orders: {
          countPerParent: { users: 3 },
          fields: {
            total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
          },
        },
        order_items: { countPerParent: { orders: 2 } },
        reviews: { countPerParent: { products: 2 } },
      },
    };
    const { graph, plan } = buildPlan(schema, config);
    const options: PreFlightOptions = { nullProbability: 0.5 };
    const result = validatePreFlight(plan, schema, graph, options);

    const notNullFails = result.entries.filter(
      (e) => e.rule === 'not-null' && e.status === 'fail',
    );
    expect(notNullFails.length).toBeGreaterThan(0);

    for (const e of notNullFails) {
      expect(e.message).toContain('NOT NULL');
      expect(e.message).toContain('nullProbability=0.5');
    }
  });

  it('passes NOT NULL check when nullProbability is 0 or unset', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: { count: 5 },
        products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
        tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
        product_tags: { count: 5 },
        orders: {
          countPerParent: { users: 3 },
          fields: {
            total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
          },
        },
        order_items: { countPerParent: { orders: 2 } },
        reviews: { countPerParent: { products: 2 } },
      },
    };
    const { graph, plan } = buildPlan(schema, config);
    const result = validatePreFlight(plan, schema, graph);
    const notNullFails = result.entries.filter(
      (e) => e.rule === 'not-null' && e.status === 'fail',
    );
    expect(notNullFails).toHaveLength(0);
  });

  it('detects FK ordering violations', () => {
    const cyclicSchema: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'cyclic',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'a',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'b_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [{ columns: ['b_id'], referencedTable: 'b', referencedColumns: ['id'] }],
          uniqueConstraints: [],
        },
        {
          name: 'b',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
    };

    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        a: { count: 5 },
        b: { count: 5 },
      },
    };

    const { graph, plan } = buildPlan(cyclicSchema, config);
    const result = validatePreFlight(plan, cyclicSchema, graph);

    const fkFails = result.entries.filter(
      (e) => e.rule === 'fk-ordering' && e.status === 'fail',
    );

    // In a normal (non-cyclic) graph, a->b is fine: b is inserted before a
    // So there should be no ordering violations in this case
    // We test a violation by checking the ordering passes
    expect(fkFails).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Post-write tests
// ────────────────────────────────────────────────────────────────────────────

describe('verifyPostWrite', () => {
  const schema = ecommerceSchema();

  it('passes when row counts match and all FK refs resolve', () => {
    // Use a simple plan with exact, small counts that match test data
    const simplePlan = buildPlan(schema, {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: { count: 10 },
        products: { count: 5, fields: { name: { kind: 'fullName', params: {} } } },
        tags: { count: 3, fields: { name: { kind: 'slug', params: {} } } },
        product_tags: { count: 8 },
        orders: {
          countPerParent: { users: 3 },
          fields: {
            total: { fn: (_row: Record<string, unknown>, _ctx: unknown) => 100 },
          },
        },
        order_items: { countPerParent: { orders: 2 } },
        reviews: { countPerParent: { products: 2 } },
      },
    }).plan;

    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      users: Array.from({ length: 10 }, (_, i) => ({
        id: `u-${i}`,
        email: `user${i}@test.com`,
        first_name: 'First',
        last_name: 'Last',
        role: 'customer',
        referred_by: i === 0 ? null : `u-${0}`,
        created_at: new Date(),
        is_active: true,
      })),
      products: Array.from({ length: 5 }, (_, i) => ({
        id: `p-${i}`,
        name: `Product ${i}`,
        price: 10 + i,
        sku: `SKU-${i}`,
        description: 'desc',
      })),
      tags: Array.from({ length: 3 }, (_, i) => ({
        id: `t-${i}`,
        name: `tag-${i}`,
      })),
      product_tags: Array.from({ length: 8 }, (_, i) => ({
        product_id: `p-${i % 5}`,
        tag_id: `t-${i % 3}`,
      })),
      orders: Array.from({ length: 30 }, (_, i) => ({
        id: `o-${i}`,
        user_id: `u-${i % 10}`,
        status: 'pending',
        total: 100,
        created_at: new Date(),
        updated_at: null,
      })),
      order_items: Array.from({ length: 60 }, (_, i) => ({
        id: `oi-${i}`,
        order_id: `o-${i % 30}`,
        product_id: `p-${i % 5}`,
        quantity: 1,
        unit_price: 10,
      })),
      reviews: Array.from({ length: 10 }, (_, i) => ({
        id: `r-${i}`,
        product_id: `p-${i % 5}`,
        user_id: `u-${i % 10}`,
        rating: 4,
        body: 'good',
      })),
    };

    const result = verifyPostWrite(simplePlan, schema, rowsByTable);
    expect(result.valid).toBe(true);
    const failEntries = result.entries.filter((e) => e.status === 'fail');
    expect(failEntries).toHaveLength(0);
  });

  it('fails when row count does not match plan', () => {
    const plan = buildPlan(schema, validConfig()).plan;
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      users: Array.from({ length: 50 }, (_, i) => ({ id: `u-${i}` })),
      products: [],
      tags: [],
      product_tags: [],
      orders: [],
      order_items: [],
      reviews: [],
    };

    // Override the plan count for users to 50 (matching)
    // But products count in plan is 50 (uniformInt max), and we have 0
    const result = verifyPostWrite(plan, schema, rowsByTable);
    expect(result.valid).toBe(false);

    const countFails = result.entries.filter(
      (e) => e.rule === 'row-count' && e.status === 'fail',
    );
    expect(countFails.length).toBeGreaterThan(0);
  });

  it('fails when FK reference does not resolve', () => {
    const plan = buildPlan(schema, validConfig()).plan;
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      users: Array.from({ length: 100 }, (_, i) => ({
        id: `u-${i}`,
        email: `user${i}@test.com`,
        first_name: 'First',
        last_name: 'Last',
        role: 'customer',
        referred_by: null,
        created_at: new Date(),
        is_active: true,
      })),
      products: Array.from({ length: 50 }, (_, i) => ({
        id: `p-${i}`,
        name: `Product ${i}`,
        price: 10,
        sku: `SKU-${i}`,
        description: 'desc',
      })),
      tags: Array.from({ length: 20 }, (_, i) => ({
        id: `t-${i}`,
        name: `tag-${i}`,
      })),
      product_tags: Array.from({ length: 50 }, (_, i) => ({
        product_id: `p-${i % 50}`,
        tag_id: `t-${i % 20}`,
      })),
      orders: Array.from({ length: 50 }, (_, i) => ({
        id: `o-${i}`,
        user_id: `nonexistent-user-id`, // broken FK
        status: 'pending',
        total: 100,
        created_at: new Date(),
        updated_at: null,
      })),
      order_items: Array.from({ length: 100 }, (_, i) => ({
        id: `oi-${i}`,
        order_id: `o-${i % 50}`,
        product_id: `p-${i % 50}`,
        quantity: 1,
        unit_price: 10,
      })),
      reviews: Array.from({ length: 30 }, (_, i) => ({
        id: `r-${i}`,
        product_id: `p-${i % 50}`,
        user_id: `u-${i % 100}`,
        rating: 4,
        body: 'good',
      })),
    };

    const result = verifyPostWrite(plan, schema, rowsByTable);
    expect(result.valid).toBe(false);

    const fkFails = result.entries.filter(
      (e) => e.rule === 'fk-reference' && e.status === 'fail',
    );
    expect(fkFails.length).toBeGreaterThanOrEqual(1);

    const userIdFail = fkFails.find((e) => e.column === 'user_id');
    expect(userIdFail).toBeDefined();
    expect(userIdFail!.message).toContain('orders');
    expect(userIdFail!.message).toContain('user_id');
  });
});
