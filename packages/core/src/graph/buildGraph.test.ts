import { describe, it, expect } from 'vitest';
import { buildGraph } from './buildGraph.js';
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

describe('buildGraph', () => {
  const schema = ecommerceSchema();

  it('should have all 7 table nodes', () => {
    const graph = buildGraph(schema);
    expect(graph.nodes).toHaveLength(7);
    expect(graph.nodes.sort()).toEqual([
      'order_items', 'orders', 'product_tags', 'products', 'reviews', 'tags', 'users',
    ]);
  });

  it('should detect self-referential FK on users.referred_by', () => {
    const graph = buildGraph(schema);
    const selfRef = graph.edges.find((e) => e.type === 'self-referential');
    expect(selfRef).toBeDefined();
    expect(selfRef!.from).toBe('users');
    expect(selfRef!.to).toBe('users');
    expect(selfRef!.foreignKey.columns).toEqual(['referred_by']);
  });

  it('should classify product_tags as many-to-many between products and tags', () => {
    const graph = buildGraph(schema);
    const mnEdge = graph.edges.find(
      (e) => e.type === 'many-to-many' && e.viaJunctionTable === 'product_tags',
    );
    expect(mnEdge).toBeDefined();
    expect(
      (mnEdge!.from === 'products' && mnEdge!.to === 'tags') ||
      (mnEdge!.from === 'tags' && mnEdge!.to === 'products'),
    ).toBe(true);
  });

  it('should not have raw one-to-many edges from product_tags', () => {
    const graph = buildGraph(schema);
    const rawPtEdges = graph.edges.filter(
      (e) => e.from === 'product_tags' && e.type === 'one-to-many',
    );
    expect(rawPtEdges).toHaveLength(0);
  });

  it('should have correct edge count (excluding self-ref, including M:N)', () => {
    const graph = buildGraph(schema);
    const ordered = graph.edges.filter((e) => e.type !== 'self-referential');
    expect(ordered.length).toBeGreaterThanOrEqual(6);
  });

  it('should put root tables (users, tags, products) before orders', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;
    const usersIdx = order.indexOf('users');
    const tagsIdx = order.indexOf('tags');
    const productsIdx = order.indexOf('products');
    const ordersIdx = order.indexOf('orders');

    expect(usersIdx).toBeLessThan(ordersIdx);
    expect(tagsIdx).toBeLessThan(ordersIdx);
    expect(productsIdx).toBeLessThan(ordersIdx);
  });

  it('should put orders before order_items', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('order_items'));
  });

  it('should put products before order_items', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('order_items'));
  });

  it('should put products and users before reviews', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('reviews'));
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('reviews'));
  });

  it('should put products and tags before product_tags', () => {
    const graph = buildGraph(schema);
    const order = graph.insertionOrder;
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('product_tags'));
    expect(order.indexOf('tags')).toBeLessThan(order.indexOf('product_tags'));
  });

  it('should flag self-referential users.referred_by in cycles', () => {
    const graph = buildGraph(schema);
    expect(graph.cycles.length).toBeGreaterThanOrEqual(1);
    const userCycle = graph.cycles.find((c) => c[0] === 'users');
    expect(userCycle).toBeDefined();
  });

  it('should not have hard-error multi-table cycles for e-commerce', () => {
    const graph = buildGraph(schema);
    const hardCycles = graph.cycles.filter((c) => c.length > 1);
    expect(hardCycles).toHaveLength(0);
  });

  it('should detect one-to-one when FK column is unique', () => {
    const oneToOneSchema: DatabaseSchema = {
      dialect: 'postgres',
      schemaHash: 'test2',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
        {
          name: 'profiles',
          columns: [
            { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: true },
            { name: 'bio', logicalType: 'string', nativeType: 'text', nullable: true, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['id'],
          foreignKeys: [
            { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
          ],
          uniqueConstraints: [['user_id']],
        },
      ],
    };

    const graph = buildGraph(oneToOneSchema);
    const oto = graph.edges.find((e) => e.type === 'one-to-one');
    expect(oto).toBeDefined();
    expect(oto!.from).toBe('profiles');
    expect(oto!.to).toBe('users');
  });
});

describe('buildGraph MongoDB heuristic', () => {
  it('should infer relationships from userId-style fields', () => {
    const mongoSchema: DatabaseSchema = {
      dialect: 'mongodb',
      schemaHash: 'mongo-test',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'users',
          columns: [
            { name: '_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'name', logicalType: 'string', nativeType: 'string', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['_id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
        {
          name: 'orders',
          columns: [
            { name: '_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'userId', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
            { name: 'total', logicalType: 'float', nativeType: 'float', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['_id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
    };

    const documents: Record<string, Record<string, unknown>[]> = {
      users: [
        { _id: { $oid: '650000000000000000000001' }, name: 'Alice' },
        { _id: { $oid: '650000000000000000000002' }, name: 'Bob' },
      ],
      orders: [
        { _id: { $oid: '650000000000000000000010' }, userId: { $oid: '650000000000000000000001' }, total: 100 },
        { _id: { $oid: '650000000000000000000011' }, userId: { $oid: '650000000000000000000002' }, total: 200 },
      ],
    };

    const graph = buildGraph(mongoSchema, { mongoDocuments: documents });
    const inferredEdge = graph.edges.find(
      (e) => e.from === 'orders' && e.to === 'users',
    );
    expect(inferredEdge).toBeDefined();
    expect(inferredEdge!.foreignKey.columns).toContain('userId');
  });

  it('should not infer relationships below confidence threshold', () => {
    const mongoSchema: DatabaseSchema = {
      dialect: 'mongodb',
      schemaHash: 'mongo-test2',
      introspectedAt: '2025-01-01T00:00:00.000Z',
      tables: [
        {
          name: 'users',
          columns: [
            { name: '_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          ],
          primaryKey: ['_id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
        {
          name: 'orders',
          columns: [
            { name: '_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
            { name: 'userId', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          ],
          primaryKey: ['_id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
    };

    const documents: Record<string, Record<string, unknown>[]> = {
      users: [
        { _id: { $oid: '650000000000000000000001' }, name: 'Alice' },
        { _id: { $oid: '650000000000000000000002' }, name: 'Bob' },
      ],
      orders: [
        { _id: { $oid: '650000000000000000000010' }, userId: { $oid: '650000000000000000009999' }, total: 100 },
        { _id: { $oid: '650000000000000000000011' }, userId: { $oid: '650000000000000000000002' }, total: 200 },
      ],
    };

    const graph = buildGraph(mongoSchema, { mongoDocuments: documents, mongoConfidenceThreshold: 0.9 });
    const inferredEdge = graph.edges.find(
      (e) => e.from === 'orders' && e.to === 'users',
    );
    expect(inferredEdge).toBeUndefined();
  });
});
