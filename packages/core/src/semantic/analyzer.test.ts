import { describe, it, expect } from 'vitest';
import { analyzeSchema } from './analyzer.js';
import type { DatabaseSchema } from '../types/index.js';

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
        foreignKeys: [
          { columns: ['referred_by'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'SET NULL' },
        ],
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
        foreignKeys: [
          { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' },
        ],
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

describe('analyzeSchema', () => {
  const schema = ecommerceSchema();

  it('should resolve at least 80% of all columns above threshold', () => {
    const matches = analyzeSchema(schema);
    const resolved = matches.filter((m) => m.source === 'rule');
    const pct = resolved.length / matches.length;
    expect(pct).toBeGreaterThanOrEqual(0.8);
  });

  it('should resolve users.role as weighted-categorical with actual enum values', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'users' && m.column === 'role');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('enum');
    expect(match!.suggestedGenerator.kind).toBe('weighted-categorical');
    const params = match!.suggestedGenerator.params.values as string[];
    expect(params).toEqual(['customer', 'admin']);
  });

  it('should resolve orders.status as weighted-categorical with actual enum values', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'orders' && m.column === 'status');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('enum');
    expect(match!.suggestedGenerator.kind).toBe('weighted-categorical');
    const params = match!.suggestedGenerator.params.values as string[];
    expect(params).toEqual(['pending', 'shipped', 'delivered', 'cancelled']);
  });

  it('should resolve users.email as email', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'users' && m.column === 'email');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('email');
    expect(match!.confidence).toBe(1);
  });

  it('should resolve users.is_active as boolean with skewed probability', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'users' && m.column === 'is_active');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('boolean');
    expect(match!.suggestedGenerator.kind).toBe('boolean-skewed');
    expect((match!.suggestedGenerator.params.skew as number) === 0.8);
  });

  it('should resolve users.created_at as timestamp', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'users' && m.column === 'created_at');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('timestamp');
    expect(match!.suggestedGenerator.kind).toBe('recent-timestamp');
  });

  it('should resolve orders.updated_at as dependent on created_at', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'orders' && m.column === 'updated_at');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('timestamp');
    expect(match!.suggestedGenerator.kind).toBe('dependent-timestamp');
    expect(match!.suggestedGenerator.params.dependsOn).toBe('created_at');
  });

  it('should resolve products.price as currency', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'products' && m.column === 'price');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('currency');
    expect(match!.suggestedGenerator.kind).toBe('log-normal-currency');
  });

  it('should resolve reviews.body as long text', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'reviews' && m.column === 'body');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('longText');
    expect(match!.suggestedGenerator.kind).toBe('faker');
  });

  it('should resolve FK columns like product_id / user_id as foreignKey', () => {
    const matches = analyzeSchema(schema);
    const productIdMatches = matches.filter(
      (m) => m.column === 'product_id' && m.semanticType === 'foreignKey',
    );
    expect(productIdMatches.length).toBeGreaterThanOrEqual(2);
    for (const m of productIdMatches) {
      expect(m.suggestedGenerator.params.referencedTable).toBe('products');
    }
  });

  it('should resolve referred_by as uuid (falls through from FK to uuid rule)', () => {
    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.table === 'users' && m.column === 'referred_by');
    expect(match).toBeDefined();
    expect(match!.source).toBe('rule');
    expect(match!.semanticType).toBe('uuid');
  });
});

describe('analyzeSchema with check constraints', () => {
  it('should resolve rating with bounded-integer from check constraint', () => {
    const schema: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'test-check',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'reviews',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'rating', logicalType: 'integer', nativeType: 'int4', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
          checkConstraints: [
            { name: 'rating_check', expression: 'rating >= 1 AND rating <= 5' },
          ],
        },
      ],
    };

    const matches = analyzeSchema(schema);
    const match = matches.find((m) => m.column === 'rating');
    expect(match).toBeDefined();
    expect(match!.semanticType).toBe('bounded-integer');
    expect(match!.suggestedGenerator.params.min).toBe(1);
    expect(match!.suggestedGenerator.params.max).toBe(5);
  });
});
