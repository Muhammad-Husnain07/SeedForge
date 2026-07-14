import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { introspect } from './introspect.js';

let dbPath: string;
let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'sf-sqlite-test-'));
  dbPath = join(fixtureDir, 'test.db');

  const mod = await import('sql.js');
  const initSqlJs = mod.default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE users (
      id    TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL,
      role  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE posts (
      id        TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title     TEXT NOT NULL,
      body      TEXT,
      published INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
});

afterAll(() => {
  try { unlinkSync(dbPath); } catch { /* ignore */ }
});

describe('introspect', () => {
  it('should introspect all tables and columns', async () => {
    const schema = await introspect({ connectionString: dbPath });

    expect(schema.dialect).toBe('sqlite');
    expect(schema.tables).toHaveLength(2);

    const users = schema.tables.find((t) => t.name === 'users');
    expect(users).toBeDefined();
    expect(users!.columns).toHaveLength(5);
    expect(users!.primaryKey).toEqual(['id']);

    const emailCol = users!.columns.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol!.logicalType).toBe('string');
    expect(emailCol!.nullable).toBe(false);
    expect(emailCol!.isUnique).toBe(true);

    const roleCol = users!.columns.find((c) => c.name === 'role');
    expect(roleCol).toBeDefined();
    expect(roleCol!.logicalType).toBe('string');
    expect(roleCol!.defaultValue).toMatch(/user/);

    const posts = schema.tables.find((t) => t.name === 'posts');
    expect(posts).toBeDefined();
    expect(posts!.foreignKeys).toHaveLength(1);
    expect(posts!.foreignKeys[0].columns).toEqual(['author_id']);
    expect(posts!.foreignKeys[0].referencedTable).toBe('users');
    expect(posts!.foreignKeys[0].onDelete).toBe('CASCADE');
  });
});
