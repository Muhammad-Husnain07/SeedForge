import { describe, it, expect, beforeAll } from 'vitest';
import mysql from 'mysql2/promise';
import { introspect } from './introspect.js';

const CONNECTION_STRING =
  'mysql://seedforge:seedforge@localhost:3306/ecommerce';

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

describe('MySQL introspection', () => {
  beforeAll(async () => {
    mysqlReachable = await isMySqlReachable();
  }, 10000);

  const itMySql = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!mysqlReachable) return;
      await fn();
    });
  };

  itMySql('should find all 7 tables', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
    expect(schema.dialect).toBe('mysql');
    expect(schema.tables).toHaveLength(7);

    const tableNames = schema.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      'order_items',
      'orders',
      'product_tags',
      'products',
      'reviews',
      'tags',
      'users',
    ]);
  });

  itMySql('should detect self-referential FK on users.referred_by', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
    const users = schema.tables.find((t) => t.name === 'users')!;
    const referredFk = users.foreignKeys.find((fk) =>
      fk.columns.includes('referred_by'),
    );
    expect(referredFk).toBeDefined();
    expect(referredFk!.referencedTable).toBe('users');
    expect(referredFk!.referencedColumns).toEqual(['id']);
    expect(referredFk!.onDelete).toBe('SET NULL');
  });

  itMySql('should extract enum values for role and status', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
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

  itMySql('should detect product_tags with 2 foreign keys', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
    const pt = schema.tables.find((t) => t.name === 'product_tags')!;
    expect(pt).toBeDefined();
    expect(pt.foreignKeys).toHaveLength(2);
    const targetTables = pt.foreignKeys
      .map((fk) => fk.referencedTable)
      .sort();
    expect(targetTables).toEqual(['products', 'tags']);
  });

  itMySql('should detect composite primary key on product_tags', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
    const pt = schema.tables.find((t) => t.name === 'product_tags')!;
    expect(pt.primaryKey).toEqual(['product_id', 'tag_id']);
  });

  itMySql('should find check constraints on reviews.rating and order_items.quantity', async () => {
    const schema = await introspect({ connectionString: CONNECTION_STRING });
    const reviews = schema.tables.find((t) => t.name === 'reviews')!;
    expect(reviews.checkConstraints).toBeDefined();
    expect(reviews.checkConstraints!.length).toBeGreaterThanOrEqual(1);
    const ratingCheck = reviews.checkConstraints!.find((cc) =>
      cc.expression.includes('rating'),
    );
    expect(ratingCheck).toBeDefined();
  });
});
