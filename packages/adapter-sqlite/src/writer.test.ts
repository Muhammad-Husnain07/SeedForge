import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { introspect } from './introspect.js';
import { write } from './writer.js';
import type { RelationshipGraph, DatabaseSchema, GenerationBatch } from '@seed-forge/core';

let dbPath: string;
let schema: DatabaseSchema;
let graph: RelationshipGraph;

beforeAll(async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sf-sqlite-writer-'));
  dbPath = join(tmpDir, 'test.db');

  const mod = await import('sql.js');
  const initSqlJs = mod.default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE users (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE posts (
      id        TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title     TEXT NOT NULL
    )
  `);
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  schema = await introspect({ connectionString: dbPath });
  graph = {
    insertionOrder: ['users', 'posts'],
    edges: [],
  } as unknown as RelationshipGraph;
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch { /* ignore */ }
});

describe('write', () => {
  it('should write rows in fresh mode', async () => {
    const usersBatch: GenerationBatch = {
      phase: 'insert',
      table: 'users',
      rows: [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob' },
      ],
    };

    const postsBatch: GenerationBatch = {
      phase: 'insert',
      table: 'posts',
      rows: [
        { id: 'p1', author_id: 'u1', title: 'Post 1' },
        { id: 'p2', author_id: 'u2', title: 'Post 2' },
      ],
    };

    function* gen() {
      yield usersBatch;
      yield postsBatch;
    }

    const result = await write(
      { connectionString: dbPath },
      gen(),
      graph,
      { ...schema, dialect: 'sqlite' as const },
      { mode: 'fresh' },
    );

    expect(result.rowsWritten.users).toBe(2);
    expect(result.rowsWritten.posts).toBe(2);
    expect(result.elapsedMs).toBeGreaterThan(0);

    const reIntrospected = await introspect({ connectionString: dbPath });
    const reUsers = reIntrospected.tables.find((t) => t.name === 'users');
    expect(reUsers).toBeDefined();
    expect(reUsers!.estimatedRowCount).toBeUndefined();
  });

  it('should reject fresh mode when tables have rows', async () => {
    async function* gen() {}

    await expect(
      write(
        { connectionString: dbPath },
        gen(),
        graph,
        { ...schema, dialect: 'sqlite' as const },
        { mode: 'fresh' },
      ),
    ).rejects.toThrow(/not empty/);
  });

  it('should truncate and reseed in truncate mode', async () => {
    const truncateBatch: GenerationBatch = {
      phase: 'insert',
      table: 'users',
      rows: [{ id: 'u3', name: 'Charlie' }],
    };

    function* gen() {
      yield truncateBatch;
    }

    const result = await write(
      { connectionString: dbPath },
      gen(),
      graph,
      { ...schema, dialect: 'sqlite' as const },
      { mode: 'truncate' },
    );

    expect(result.rowsWritten.users).toBe(1);
  });
});
