import { describe, it, expect } from 'vitest';
import { introspect } from './introspect.js';
import type { TableSchema } from '@seed-forge/core';

const SCHEMA_PATH = '../../fixtures/ecommerce/schema.drizzle.ts';

const ALL_TABLE_NAMES = [
  'users',
  'products',
  'tags',
  'product_tags',
  'orders',
  'order_items',
  'reviews',
].sort();

const CANONICAL: Omit<TableSchema, 'columns'> & { columns: { name: string; logicalType: string; nullable: boolean; isPrimaryKey: boolean; isUnique: boolean; enumValues?: string[]; maxLength?: number; precision?: number; scale?: number }[] }[] = [
  {
    name: 'order_items', primaryKey: ['id'],
    columns: [
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'order_id', logicalType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'product_id', logicalType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'quantity', logicalType: 'integer', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'unit_price', logicalType: 'float', nullable: false, isPrimaryKey: false, isUnique: false, precision: 12, scale: 2 },
    ],
    foreignKeys: [
      { columns: ['order_id'], referencedTable: 'orders', referencedColumns: ['id'], onDelete: 'cascade' },
      { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'cascade' },
    ],
    uniqueConstraints: [],
  },
  {
    name: 'orders', primaryKey: ['id'],
    columns: [
      { name: 'created_at', logicalType: 'timestamp', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'status', logicalType: 'enum', nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['pending', 'shipped', 'delivered', 'cancelled'] },
      { name: 'total', logicalType: 'float', nullable: false, isPrimaryKey: false, isUnique: false, precision: 14, scale: 2 },
      { name: 'user_id', logicalType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'cascade' },
    ],
    uniqueConstraints: [],
  },
  {
    name: 'product_tags', primaryKey: ['product_id', 'tag_id'],
    columns: [
      { name: 'product_id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'tag_id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
    ],
    foreignKeys: [
      { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'cascade' },
      { columns: ['tag_id'], referencedTable: 'tags', referencedColumns: ['id'], onDelete: 'cascade' },
    ],
    uniqueConstraints: [],
  },
  {
    name: 'products', primaryKey: ['id'],
    columns: [
      { name: 'description', logicalType: 'string', nullable: true, isPrimaryKey: false, isUnique: false },
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'name', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 255 },
      { name: 'price', logicalType: 'float', nullable: false, isPrimaryKey: false, isUnique: false, precision: 12, scale: 2 },
      { name: 'sku', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 50 },
    ],
    foreignKeys: [],
    uniqueConstraints: [['sku']],
  },
  {
    name: 'reviews', primaryKey: ['id'],
    columns: [
      { name: 'body', logicalType: 'string', nullable: true, isPrimaryKey: false, isUnique: false },
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'product_id', logicalType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'rating', logicalType: 'integer', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'user_id', logicalType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
    ],
    foreignKeys: [
      { columns: ['product_id'], referencedTable: 'products', referencedColumns: ['id'], onDelete: 'cascade' },
      { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'cascade' },
    ],
    uniqueConstraints: [],
  },
  {
    name: 'tags', primaryKey: ['id'],
    columns: [
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'name', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: true, maxLength: 100 },
    ],
    foreignKeys: [],
    uniqueConstraints: [['name']],
  },
  {
    name: 'users', primaryKey: ['id'],
    columns: [
      { name: 'created_at', logicalType: 'timestamp', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'email', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: true },
      { name: 'first_name', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 100 },
      { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
      { name: 'is_active', logicalType: 'boolean', nullable: false, isPrimaryKey: false, isUnique: false },
      { name: 'last_name', logicalType: 'string', nullable: false, isPrimaryKey: false, isUnique: false, maxLength: 100 },
      { name: 'referred_by', logicalType: 'uuid', nullable: true, isPrimaryKey: false, isUnique: false },
      { name: 'role', logicalType: 'enum', nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['customer', 'admin'] },
    ],
    foreignKeys: [
      { columns: ['referred_by'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'set null' },
    ],
    uniqueConstraints: [['email']],
  },
];

type CanonicalCol = (typeof CANONICAL)[number]['columns'][number];

function compareAgainstCanonical(actual: TableSchema[], canonical: typeof CANONICAL): void {
  const sortTables = (ts: typeof actual) => [...ts].sort((a, b) => a.name.localeCompare(b.name));
  const canonicalSorted = [...canonical].sort((a, b) => a.name.localeCompare(b.name));
  const actualSorted = sortTables(actual);

  expect(actualSorted.length).toBe(canonicalSorted.length);

  for (let i = 0; i < actualSorted.length; i++) {
    const act = actualSorted[i];
    const exp = canonicalSorted[i];

    expect(act.name).toBe(exp.name);
    expect(act.primaryKey).toEqual(exp.primaryKey);

    const sortCols = (cs: typeof act.columns) =>
      [...cs].sort((a, b) => a.name.localeCompare(b.name));
    const actCols = sortCols(act.columns);
    const expCols: CanonicalCol[] = [...exp.columns].sort((a, b) => a.name.localeCompare(b.name));

    expect(actCols.length).toBe(expCols.length);
    for (let j = 0; j < actCols.length; j++) {
      expect(actCols[j].name).toBe(expCols[j].name);
      expect(actCols[j].logicalType).toBe(expCols[j].logicalType);
      expect(actCols[j].nullable).toBe(expCols[j].nullable);
      expect(actCols[j].isPrimaryKey).toBe(expCols[j].isPrimaryKey);
      expect(actCols[j].isUnique).toBe(expCols[j].isUnique);
      if (expCols[j].enumValues) expect(actCols[j].enumValues).toEqual(expCols[j].enumValues);
      if (expCols[j].maxLength !== undefined) expect(actCols[j].maxLength).toBe(expCols[j].maxLength);
      if (expCols[j].precision !== undefined) expect(actCols[j].precision).toBe(expCols[j].precision);
      if (expCols[j].scale !== undefined) expect(actCols[j].scale).toBe(expCols[j].scale);
    }

    const sortFk = (fks: typeof act.foreignKeys) =>
      [...fks].sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(',')));
    const actFks = sortFk(act.foreignKeys);
    const expFks = sortFk(exp.foreignKeys);
    expect(actFks.length).toBe(expFks.length);
    for (let j = 0; j < actFks.length; j++) {
      expect(actFks[j].columns).toEqual(expFks[j].columns);
      expect(actFks[j].referencedTable).toBe(expFks[j].referencedTable);
      expect(actFks[j].referencedColumns).toEqual(expFks[j].referencedColumns);
      expect(actFks[j].onDelete ?? undefined).toBe(expFks[j].onDelete);
    }

    const sortUc = (ucs: string[][]) =>
      [...ucs].sort((a, b) => a.join(',').localeCompare(b.join(',')));
    expect(sortUc(act.uniqueConstraints)).toEqual(sortUc(exp.uniqueConstraints));
  }
}

describe('Drizzle introspection', () => {
  it('should find all 7 tables', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    expect(schema.dialect).toBe('drizzle');
    expect(schema.tables).toHaveLength(7);
    const tableNames = schema.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(ALL_TABLE_NAMES);
  });

  it('should detect self-referential FK on users.referred_by', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const users = schema.tables.find((t) => t.name === 'users')!;
    const referredFk = users.foreignKeys.find((fk) =>
      fk.columns.includes('referred_by'),
    );
    expect(referredFk).toBeDefined();
    expect(referredFk!.referencedTable).toBe('users');
    expect(referredFk!.referencedColumns).toEqual(['id']);
    expect(referredFk!.onDelete).toBe('set null');
  });

  it('should extract enum values for role and status', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const users = schema.tables.find((t) => t.name === 'users')!;
    const roleCol = users.columns.find((c) => c.name === 'role')!;
    expect(roleCol.logicalType).toBe('enum');
    expect(roleCol.enumValues).toEqual(['customer', 'admin']);

    const orders = schema.tables.find((t) => t.name === 'orders')!;
    const statusCol = orders.columns.find((c) => c.name === 'status')!;
    expect(statusCol.logicalType).toBe('enum');
    expect(statusCol.enumValues).toEqual([
      'pending',
      'shipped',
      'delivered',
      'cancelled',
    ]);
  });

  it('should detect product_tags with 2 foreign keys', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const pt = schema.tables.find((t) => t.name === 'product_tags')!;
    expect(pt).toBeDefined();
    expect(pt.foreignKeys).toHaveLength(2);
    const targetTables = pt.foreignKeys
      .map((fk) => fk.referencedTable)
      .sort();
    expect(targetTables).toEqual(['products', 'tags']);
  });

  it('should detect composite primary key on product_tags', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const pt = schema.tables.find((t) => t.name === 'product_tags')!;
    expect(pt.primaryKey).toEqual(['product_id', 'tag_id']);
  });

  it('should detect unique constraints', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const users = schema.tables.find((t) => t.name === 'users')!;
    const emailCol = users.columns.find((c) => c.name === 'email')!;
    expect(emailCol.isUnique).toBe(true);

    const products = schema.tables.find((t) => t.name === 'products')!;
    const skuCol = products.columns.find((c) => c.name === 'sku')!;
    expect(skuCol.isUnique).toBe(true);
  });

  it('should map UUID PK columns correctly', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const users = schema.tables.find((t) => t.name === 'users')!;
    const idCol = users.columns.find((c) => c.name === 'id')!;
    expect(idCol.logicalType).toBe('uuid');
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.nullable).toBe(false);
  });

  it('should map price/discount as float with precision', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const products = schema.tables.find((t) => t.name === 'products')!;
    const priceCol = products.columns.find((c) => c.name === 'price')!;
    expect(priceCol.logicalType).toBe('float');
    expect(priceCol.nullable).toBe(false);
  });

  it('should check all order_items columns exist', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    const oi = schema.tables.find((t) => t.name === 'order_items')!;
    expect(oi.columns.find((c) => c.name === 'order_id')).toBeDefined();
    expect(oi.columns.find((c) => c.name === 'product_id')).toBeDefined();
    expect(oi.columns.find((c) => c.name === 'quantity')).toBeDefined();
    expect(oi.columns.find((c) => c.name === 'unit_price')).toBeDefined();
  });

  it('should match the canonical reference schema on every field that matters', async () => {
    const schema = await introspect({ schemaPath: SCHEMA_PATH });
    compareAgainstCanonical(schema.tables, CANONICAL);
  });
});
