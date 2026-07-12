import { describe, it, expect } from 'vitest';
import { defineConfig } from './defineConfig.js';
import { buildGenerationPlan, SeedForgeConfigError } from './merge.js';
import { validateConfig } from './validate.js';
import { analyzeSchema } from '../semantic/analyzer.js';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig } from './types.js';

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
            fn: (_row: Record<string, unknown>, _ctx: Record<string, unknown>) => 100,
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

describe('defineConfig', () => {
  it('returns the same object', () => {
    const config = validConfig();
    expect(defineConfig(config)).toBe(config);
  });
});

describe('validateConfig', () => {
  const schema = ecommerceSchema();

  it('passes a valid config with no issues', () => {
    const config = validConfig();
    const issues = validateConfig(config, schema);
    expect(issues).toHaveLength(0);
  });

  it('flags an unknown table name', () => {
    const config: SeedForgeConfig = {
      ...validConfig(),
      tables: { ...validConfig().tables, does_not_exist: { count: 5 } },
    };
    const issues = validateConfig(config, schema);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]!.path).toContain('does_not_exist');
    expect(issues[0]!.message.toLowerCase()).toContain('not found');
  });

  it('flags an unknown column name in fields', () => {
    const config: SeedForgeConfig = {
      ...validConfig(),
      tables: {
        ...validConfig().tables,
        users: {
          count: 10,
          fields: { nonexistent_column: { kind: 'email', params: {} } },
        },
      },
    };
    const issues = validateConfig(config, schema);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]!.path).toContain('nonexistent_column');
  });

  it('flags a type-incompatible generator', () => {
    const config: SeedForgeConfig = {
      ...validConfig(),
      tables: {
        ...validConfig().tables,
        users: {
          fields: { is_active: { kind: 'currency', params: { mean: 4, stdDev: 1.5 } } },
        },
      },
    };
    const issues = validateConfig(config, schema);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]!.message.toLowerCase()).toContain('currency');
    expect(issues[0]!.message.toLowerCase()).toContain('boolean');
  });

  it('flags an unknown parent table in countPerParent', () => {
    const config: SeedForgeConfig = {
      ...validConfig(),
      tables: {
        orders: {
          countPerParent: { ghost_table: 5 },
        },
      },
    };
    const issues = validateConfig(config, schema);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]!.path).toContain('ghost_table');
  });
});

describe('buildGenerationPlan', () => {
  const schema = ecommerceSchema();

  it('produces a fully-resolved plan with no errors for valid config', () => {
    const config = validConfig();
    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);

    const tableNames = Object.keys(plan.tables);
    expect(tableNames.sort()).toEqual([
      'order_items', 'orders', 'product_tags', 'products', 'reviews', 'tags', 'users',
    ]);

    for (const [, t] of Object.entries(plan.tables)) {
      expect(t.fields.length).toBeGreaterThan(0);
      for (const f of t.fields) {
        expect(f.source === 'config' || f.source === 'inferred');
        expect(f.generator).toBeDefined();
      }
    }
  });

  it('config override wins over inferred matches', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        users: {
          count: 10,
          fields: { email: { kind: 'email', params: {} } },
        },
        products: {
          fields: { name: { kind: 'fullName', params: {} }, description: { kind: 'longText', params: {} } },
        },
        tags: {
          fields: { name: { kind: 'slug', params: {} } },
        },
      },
    };
    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);

    const userFields = plan.tables['users']!.fields;
    const emailField = userFields.find((f) => f.column === 'email');
    expect(emailField).toBeDefined();
    expect(emailField!.source).toBe('config');
    expect(emailField!.confidence).toBe(1);
  });

  it('throws when an unresolved column has no config override', () => {
    const schemaNoName: DatabaseSchema = {
      ...schema,
      tables: schema.tables.map((t) => ({
        ...t,
        columns: t.columns.map((c) => ({
          ...c,
          name: c.name === 'email' ? 'weird_column' : c.name,
          logicalType: c.name === 'email' ? 'string' as const : c.logicalType,
        })),
      })),
    };

    const inferred = analyzeSchema(schemaNoName);
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {},
    };

    expect(() => buildGenerationPlan(schemaNoName, config, inferred)).toThrow(SeedForgeConfigError);
  });

  it('preserves countPerParent in the plan', () => {
    const config = validConfig();
    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);
    expect(plan.tables['orders']!.countPerParent['users']).toBeDefined();
    expect(plan.tables['order_items']!.countPerParent['orders']).toBeDefined();
  });

  it('preserves personas in the plan', () => {
    const config = validConfig();
    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);
    expect(plan.tables['users']!.personas).toHaveLength(1);
    expect(plan.tables['users']!.personas[0]!.name).toBe('power_user');
  });

  it('preserves derived field config in the plan', () => {
    const config = validConfig();
    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);

    const totalField = plan.tables['orders']!.fields.find((f) => f.column === 'total');
    expect(totalField).toBeDefined();
    expect(totalField!.source).toBe('config');
    expect(totalField!.generator.kind).toBe('derived');
  });

  it('uses inferred matches when no config override exists', () => {
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {
        products: {
          fields: { name: { kind: 'fullName', params: {} }, description: { kind: 'longText', params: {} } },
        },
        tags: {
          fields: { name: { kind: 'slug', params: {} } },
        },
      },
    };

    const inferred = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, inferred);

    const userEmail = plan.tables['users']!.fields.find((f) => f.column === 'email');
    expect(userEmail).toBeDefined();
    expect(userEmail!.source).toBe('inferred');
  });

  it('throws SeedForgeConfigError type', () => {
    const schemaEmpty: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'empty',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'foo',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'bar', logicalType: 'string', nativeType: 'text', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
    };

    const inferred = analyzeSchema(schemaEmpty);
    const config: SeedForgeConfig = {
      connection: { dialect: 'postgres', connectionString: '' },
      tables: {},
    };

    try {
      buildGenerationPlan(schemaEmpty, config, inferred);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SeedForgeConfigError);
      expect((e as SeedForgeConfigError).name).toBe('SeedForgeConfigError');
    }
  });
});
