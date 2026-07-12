import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyColumns, anonymizeRow, isSensitiveSemanticType } from './anonymizer.js';
import { clone, formatCloneSummary } from './clone.js';
import type { DatabaseSchema } from '@seed-forge/core';
import type { AnonymizedColumn } from './types.js';

// ─── Sensitive type classification ─────────────────────────────────────

describe('isSensitiveSemanticType', () => {
  it('classifies email as sensitive', () => {
    expect(isSensitiveSemanticType('email')).toBe(true);
  });

  it('classifies phone as sensitive', () => {
    expect(isSensitiveSemanticType('phone')).toBe(true);
  });

  it('classifies name variants as sensitive', () => {
    expect(isSensitiveSemanticType('firstName')).toBe(true);
    expect(isSensitiveSemanticType('lastName')).toBe(true);
    expect(isSensitiveSemanticType('fullName')).toBe(true);
  });

  it('classifies address components as sensitive', () => {
    expect(isSensitiveSemanticType('street')).toBe(true);
    expect(isSensitiveSemanticType('city')).toBe(true);
    expect(isSensitiveSemanticType('state')).toBe(true);
    expect(isSensitiveSemanticType('zip')).toBe(true);
    expect(isSensitiveSemanticType('country')).toBe(true);
  });

  it('classifies longText, url, ip, imageUrl as sensitive', () => {
    expect(isSensitiveSemanticType('longText')).toBe(true);
    expect(isSensitiveSemanticType('url')).toBe(true);
    expect(isSensitiveSemanticType('ip')).toBe(true);
    expect(isSensitiveSemanticType('imageUrl')).toBe(true);
  });

  it('classifies non-sensitive types as not sensitive', () => {
    expect(isSensitiveSemanticType('uuid')).toBe(false);
    expect(isSensitiveSemanticType('enum')).toBe(false);
    expect(isSensitiveSemanticType('bounded-integer')).toBe(false);
    expect(isSensitiveSemanticType('boolean')).toBe(false);
    expect(isSensitiveSemanticType('timestamp')).toBe(false);
    expect(isSensitiveSemanticType('currency')).toBe(false);
    expect(isSensitiveSemanticType('foreignKey')).toBe(false);
    expect(isSensitiveSemanticType('slug')).toBe(false);
    expect(isSensitiveSemanticType('unresolved')).toBe(false);
  });
});

// ─── classifyColumns ───────────────────────────────────────────────────

describe('classifyColumns', () => {
    const mockSchema: DatabaseSchema = {
    dialect: 'postgres',
    introspectedAt: new Date().toISOString(),
    schemaHash: 'abc',
    tables: [
      {
        name: 'users',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'tier', logicalType: 'string', nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false, enumValues: ['free', 'pro'] },
          { name: 'order_total', logicalType: 'float', nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [],
        uniqueConstraints: [],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer', nativeType: 'int', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'total', logicalType: 'float', nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
        uniqueConstraints: [],
      },
    ],
  };

  const mockMatches = [
    { table: 'users', column: 'email', semanticType: 'email', confidence: 1, suggestedGenerator: { kind: 'faker', params: { method: 'internet.email' } }, source: 'rule' },
    { table: 'users', column: 'name', semanticType: 'fullName', confidence: 1, suggestedGenerator: { kind: 'fullName', params: {} }, source: 'rule' },
    { table: 'users', column: 'tier', semanticType: 'enum', confidence: 1, suggestedGenerator: { kind: 'weighted-categorical', params: { values: { free: 0.7, pro: 0.3 } } }, source: 'rule' },
    { table: 'orders', column: 'user_id', semanticType: 'foreignKey', confidence: 0.8, suggestedGenerator: { kind: 'fk-reference', params: { referencedTable: 'users', referencedColumn: 'id' } }, source: 'rule' },
  ];

  it('marks email as replace when not PK', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const emailCol = result.columns.find((c) => c.column === 'email');
    expect(emailCol?.strategy).toBe('replace');
    expect(emailCol?.generator?.kind).toBe('faker');
  });

  it('marks fullName as replace', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const nameCol = result.columns.find((c) => c.column === 'name');
    expect(nameCol?.strategy).toBe('replace');
    expect(nameCol?.generator?.kind).toBe('fullName');
  });

  it('keeps PK columns even if sensitive', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const pkCol = result.columns.find((c) => c.column === 'id');
    expect(pkCol?.strategy).toBe('keep');
  });

  it('keeps non-sensitive resolved columns', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const tierCol = result.columns.find((c) => c.column === 'tier');
    expect(tierCol?.strategy).toBe('keep');
  });

  it('keeps unresolved columns', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const totalCol = result.columns.find((c) => c.column === 'total');
    expect(totalCol?.strategy).toBe('keep');
  });

  it('keeps FK columns', () => {
    const result = classifyColumns(mockSchema, mockMatches);
    const fkCol = result.columns.find((c) => c.column === 'user_id');
    expect(fkCol?.strategy).toBe('keep');
  });
});

// ─── anonymizeRow ──────────────────────────────────────────────────────

describe('anonymizeRow', () => {
  it('replaces sensitive columns and keeps non-sensitive', () => {
    const columns: AnonymizedColumn[] = [
      { table: 'users', column: 'email', strategy: 'replace', semanticType: 'email', generator: { kind: 'faker', params: { method: 'internet.email' } } },
      { table: 'users', column: 'order_total', strategy: 'keep', semanticType: 'currency' },
    ];
    const row = { email: 'original@test.com', order_total: 42.5 };
    const result = anonymizeRow(row, 'users', columns, () => 'replaced@test.com');
    expect(result.email).toBe('replaced@test.com');
    expect(result.order_total).toBe(42.5);
  });

  it('handles undefined values in source row', () => {
    const columns: AnonymizedColumn[] = [
      { table: 'users', column: 'email', strategy: 'replace', semanticType: 'email', generator: { kind: 'faker', params: { method: 'internet.email' } } },
    ];
    const row: Record<string, unknown> = {};
    const result = anonymizeRow(row, 'users', columns, () => 'test@test.com');
    expect(result.email).toBeUndefined();
  });
});

// ─── clone orchestrator (with mock sample) ────────────────────────────

describe('clone', () => {
  const testDir = path.join(process.cwd(), '.test-clone-output');

  const mockSchema: DatabaseSchema = {
    dialect: 'postgres',
    introspectedAt: new Date().toISOString(),
    schemaHash: 'abc',
    tables: [
      {
        name: 'users',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'full_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'first_name', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'phone', logicalType: 'string', nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'tier', logicalType: 'string', nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false, enumValues: ['free', 'pro'] },
          { name: 'order_total', logicalType: 'float', nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [],
        uniqueConstraints: [],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer', nativeType: 'int', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'total', logicalType: 'float', nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
        uniqueConstraints: [],
      },
    ],
  };

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('writes anonymized NDJSON files and returns summary', async () => {
    const mockSampleFn = (
      _config: Record<string, unknown>,
      tableName: string,
    ): Promise<Record<string, unknown>[]> => {

      if (tableName === 'users') {
        return Promise.resolve([
          { id: 'u1', email: 'alice@real.com', full_name: 'Alice Smith', first_name: 'Alice', phone: '555-0100', tier: 'free', order_total: 10 },
          { id: 'u2', email: 'bob@real.com', full_name: 'Bob Jones', first_name: 'Bob', phone: '555-0200', tier: 'pro', order_total: 50 },
        ]);
      }
      if (tableName === 'orders') {
        return Promise.resolve([
          { id: 1, user_id: 'u1', total: 25 },
          { id: 2, user_id: 'u2', total: 75 },
        ]);
      }
      return Promise.resolve([]);
    };

    const summary = await clone(
      {
        sourceConnection: 'postgresql://test:test@localhost:5432/test',
        dialect: 'postgres',
        anonymize: true,
        iUnderstandTheRisk: true,
        outputDir: testDir,
      },
      mockSampleFn,
      mockSchema,
    );

    expect(summary.totalRows).toBe(4);
    expect(summary.tables).toHaveLength(2);

    const usersFile = await fs.readFile(path.join(testDir, 'users.ndjson'), 'utf-8');
    const userRows: Record<string, unknown>[] = usersFile.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(userRows).toHaveLength(2);
    // Email should be replaced (different from original)
    expect(userRows[0]?.email as string).not.toBe('alice@real.com');
    expect(userRows[0]?.email).toBeTruthy();
    // full_name should be replaced
    expect(userRows[0]?.full_name as string).not.toBe('Alice Smith');
    expect(userRows[0]?.full_name).toBeTruthy();
    // first_name should be replaced
    expect(userRows[0]?.first_name as string).not.toBe('Alice');
    expect(userRows[0]?.first_name).toBeTruthy();
    // phone should be replaced
    expect(userRows[0]?.phone as string).not.toBe('555-0100');
    expect(userRows[0]?.phone).toBeTruthy();
    // Non-sensitive fields should stay
    expect(userRows[0]?.tier).toBe('free');
    expect(userRows[0]?.order_total).toBe(10);
    // PK should stay
    expect(userRows[0]?.id).toBe('u1');

    const ordersFile = await fs.readFile(path.join(testDir, 'orders.ndjson'), 'utf-8');
    const orderRows: Record<string, unknown>[] = ordersFile.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(orderRows).toHaveLength(2);
    // FK should stay
    expect(orderRows[0]?.user_id).toBe('u1');
    expect(orderRows[0]?.total).toBe(25);
  });

  it('returns empty summary when no rows sampled', async () => {
    const mockEmpty = (): Promise<Record<string, unknown>[]> => Promise.resolve([]);
    const summary = await clone(
      {
        sourceConnection: 'postgresql://test:test@localhost:5432/test',
        dialect: 'postgres',
        anonymize: true,
        iUnderstandTheRisk: true,
        outputDir: testDir,
      },
      mockEmpty,
      mockSchema,
    );
    expect(summary.totalRows).toBe(0);
    expect(summary.tables).toHaveLength(0);
  });
});

// ─── formatCloneSummary ────────────────────────────────────────────────

describe('formatCloneSummary', () => {
  it('includes table names, row counts, and column actions', () => {
    const summary = {
      tables: [
        {
          table: 'users',
          totalRows: 10,
          replacedColumns: 2,
          keptColumns: 3,
          columns: [
            { table: 'users', column: 'email', strategy: 'replace' as const, semanticType: 'email' },
            { table: 'users', column: 'tier', strategy: 'keep' as const, semanticType: 'enum' },
          ],
        },
      ],
      totalRows: 10,
      outputDir: './out',
    };

    const output = formatCloneSummary(summary);
    expect(output).toContain('users');
    expect(output).toContain('10 rows');
    expect(output).toContain('2 replaced');
    expect(output).toContain('3 kept');
    expect(output).toContain('✎ email');
    expect(output).toContain('· tier');
  });
});
