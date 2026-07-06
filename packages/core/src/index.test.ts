import { describe, it, expect } from 'vitest';
import { name } from './index.js';
import type { DatabaseSchema } from './types/index.js';

describe('@seed-forge/core', () => {
  it('should export its name', () => {
    expect(name).toBe('@seed-forge/core');
  });

  it('should round-trip a DatabaseSchema through JSON', () => {
    const schema: DatabaseSchema = {
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
            {
              name: 'email',
              logicalType: 'string',
              nativeType: 'varchar',
              nullable: false,
              isPrimaryKey: false,
              isUnique: true,
              maxLength: 255,
            },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          uniqueConstraints: [['email']],
        },
      ],
      introspectedAt: '2025-01-01T00:00:00.000Z',
      schemaHash: 'abc123',
    };

    const json = JSON.stringify(schema);
    const parsed = JSON.parse(json) as DatabaseSchema;
    expect(parsed).toEqual(schema);
  });
});
