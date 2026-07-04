import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferFromDocuments } from './infer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSeed(): Record<string, Record<string, unknown>[]> {
  const raw = readFileSync(
    resolve(__dirname, '../../../fixtures/ecommerce/mongo-seed.json'),
    'utf-8',
  );
  return JSON.parse(raw);
}

describe('Mongo inference', () => {
  const seed = loadSeed();

  it('should infer users collection with nested fields', () => {
    const table = inferFromDocuments('users', seed.users);
    expect(table.name).toBe('users');
    expect(table.columns.length).toBeGreaterThanOrEqual(8);

    const emailCol = table.columns.find((c) => c.name === 'email')!;
    expect(emailCol.logicalType).toBe('string');
    expect(emailCol.nullable).toBe(false);

    const isActiveCol = table.columns.find((c) => c.name === 'isActive')!;
    expect(isActiveCol.logicalType).toBe('boolean');
    expect(isActiveCol.nullable).toBe(false);

    const cityCol = table.columns.find((c) => c.name === 'address.city')!;
    expect(cityCol).toBeDefined();
    expect(cityCol.nullable).toBe(true);

    const zipCol = table.columns.find((c) => c.name === 'address.zip')!;
    expect(zipCol).toBeDefined();
  });

  it('should identify _id as uuid primary key', () => {
    const table = inferFromDocuments('users', seed.users);
    expect(table.primaryKey).toEqual(['_id']);
    const idCol = table.columns.find((c) => c.name === '_id')!;
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.logicalType).toBe('uuid');
  });

  it('should infer products collection with arrays', () => {
    const table = inferFromDocuments('products', seed.products);
    const ratingsCol = table.columns.find((c) => c.name === 'ratings')!;
    expect(ratingsCol).toBeDefined();
    expect(ratingsCol.logicalType).toBe('array');
  });

  it('should mark nullable fields correctly', () => {
    const table = inferFromDocuments('products', seed.products);
    const descCol = table.columns.find((c) => c.name === 'description')!;
    expect(descCol).toBeDefined();
    expect(descCol.nullable).toBe(true);
  });

  it('should infer orders collection with nested order items', () => {
    const table = inferFromDocuments('orders', seed.orders);
    const statusCol = table.columns.find((c) => c.name === 'status')!;
    expect(statusCol.logicalType).toBe('string');

    const itemsCol = table.columns.find((c) => c.name === 'items')!;
    expect(itemsCol).toBeDefined();
    expect(itemsCol.logicalType).toBe('array');
  });

  it('should infer dates as timestamp type', () => {
    const table = inferFromDocuments('users', seed.users);
    const createdAtCol = table.columns.find((c) => c.name === 'createdAt')!;
    expect(createdAtCol.logicalType).toBe('timestamp');
  });

  it('should return empty foreign keys and unique constraints', () => {
    const table = inferFromDocuments('users', seed.users);
    expect(table.foreignKeys).toEqual([]);
    expect(table.uniqueConstraints).toEqual([]);
  });
});
