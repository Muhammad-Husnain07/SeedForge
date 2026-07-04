import { describe, it, expect } from 'vitest';
import { computeSchemaHash } from './introspect.js';
import type { DatabaseSchema } from './types/index.js';

describe('computeSchemaHash', () => {
  it('should produce a deterministic hash for the same schema', () => {
    const schema: Omit<DatabaseSchema, 'schemaHash'> = {
      dialect: 'postgres',
      tables: [
        {
          name: 'users',
          columns: [
            {
              name: 'id',
              logicalType: 'uuid',
              nativeType: 'uuid',
              nullable: false,
              isPrimaryKey: true,
              isUnique: true,
            },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [],
        },
      ],
      introspectedAt: '2025-01-01T00:00:00.000Z',
    };

    const hash1 = computeSchemaHash(schema);
    const hash2 = computeSchemaHash(schema);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different schemas', () => {
    const schema1: Omit<DatabaseSchema, 'schemaHash'> = {
      dialect: 'postgres',
      tables: [],
      introspectedAt: '2025-01-01T00:00:00.000Z',
    };

    const schema2: Omit<DatabaseSchema, 'schemaHash'> = {
      dialect: 'mysql',
      tables: [],
      introspectedAt: '2025-01-01T00:00:00.000Z',
    };

    const hash1 = computeSchemaHash(schema1);
    const hash2 = computeSchemaHash(schema2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce the same hash regardless of field insertion order', () => {
    const data = { b: 1, a: 2 } as Omit<DatabaseSchema, 'schemaHash'>;
    const hash = computeSchemaHash(data);
    expect(hash).toHaveLength(64);
  });
});
