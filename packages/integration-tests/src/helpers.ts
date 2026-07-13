import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import pg from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import {
  buildGraph,
  analyzeSchema,
  buildGenerationPlan,
  generate,
  validatePreFlight,
  verifyPostWrite,
  exportBundle,
  importBundle,
  computeConfigHash,
  WriteProgressEmitter,
} from '@seed-forge/core';
import type {
  DatabaseSchema,
  SeedForgeConfig,
  RelationshipGraph,
  GenerationPlan,
  GenerationBatch,
} from '@seed-forge/core';
import { introspect as pgIntrospect } from '@seed-forge/adapter-postgres';
import { introspect as mysqlIntrospect } from '@seed-forge/adapter-mysql';
import { introspect as mongoIntrospect } from '@seed-forge/adapter-mongodb';
import { write as pgWrite } from '@seed-forge/adapter-postgres';
import { write as mysqlWrite } from '@seed-forge/adapter-mysql';
import { write as mongoWrite } from '@seed-forge/adapter-mongodb';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures');

/* ------------------------------------------------------------------ */
/*  Container lifecycle                                                */
/* ------------------------------------------------------------------ */

let _pgContainer: StartedTestContainer | null = null;
let _mysqlContainer: StartedTestContainer | null = null;
let _mongoContainer: StartedTestContainer | null = null;

export async function startPostgres(): Promise<string> {
  if (process.env.CI_PG_CONN_STR) {
    return process.env.CI_PG_CONN_STR;
  }
  if (_pgContainer) {
    return `postgres://seedforge:seedforge@${_pgContainer.getHost()}:${_pgContainer.getMappedPort(5432)}/seedforge`;
  }
  _pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'seedforge',
      POSTGRES_PASSWORD: 'seedforge',
      POSTGRES_DB: 'seedforge',
    })
    .withExposedPorts(5432)
    .withStartupTimeout(60_000)
    .start();
  // Wait for Postgres to finish initializing and accept connections
  const pgConnStr = `postgres://seedforge:seedforge@${_pgContainer.getHost()}:${_pgContainer.getMappedPort(5432)}/seedforge`;
  const pgPool = new pg.Pool({ connectionString: pgConnStr, max: 1 });
  for (let i = 0; i < 30; i++) {
    try {
      await pgPool.query('SELECT 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pgPool.end();
  return pgConnStr;
}

export async function startMySQL(): Promise<string> {
  if (process.env.CI_MYSQL_CONN_STR) {
    return process.env.CI_MYSQL_CONN_STR;
  }
  if (_mysqlContainer) {
    return `mysql://seedforge:seedforge@${_mysqlContainer.getHost()}:${_mysqlContainer.getMappedPort(3306)}/seedforge`;
  }
  _mysqlContainer = await new GenericContainer('mysql:8')
    .withEnvironment({
      MYSQL_ROOT_PASSWORD: 'rootpass',
      MYSQL_USER: 'seedforge',
      MYSQL_PASSWORD: 'seedforge',
      MYSQL_DATABASE: 'seedforge',
    })
    .withExposedPorts(3306)
    .withStartupTimeout(60_000)
    .start();
  return `mysql://seedforge:seedforge@${_mysqlContainer.getHost()}:${_mysqlContainer.getMappedPort(3306)}/seedforge`;
}

export async function startMongoDB(): Promise<string> {
  if (process.env.CI_MONGO_CONN_STR) {
    return process.env.CI_MONGO_CONN_STR;
  }
  if (_mongoContainer) {
    return `mongodb://${_mongoContainer.getHost()}:${_mongoContainer.getMappedPort(27017)}`;
  }
  _mongoContainer = await new GenericContainer('mongo:7')
    .withExposedPorts(27017)
    .withStartupTimeout(60_000)
    .start();
  return `mongodb://${_mongoContainer.getHost()}:${_mongoContainer.getMappedPort(27017)}`;
}

export async function stopPostgres(): Promise<void> {
  if (_pgContainer) { await _pgContainer.stop(); _pgContainer = null; }
}

export async function stopMySQL(): Promise<void> {
  if (_mysqlContainer) { await _mysqlContainer.stop(); _mysqlContainer = null; }
}

export async function stopMongoDB(): Promise<void> {
  if (_mongoContainer) { await _mongoContainer.stop(); _mongoContainer = null; }
}

/* ------------------------------------------------------------------ */
/*  Schema loading / cleanup                                           */
/* ------------------------------------------------------------------ */

export async function loadFixtureSchemaPG(connStr: string, fixture: string): Promise<void> {
  const sqlPath = path.join(FIXTURES_DIR, fixture, 'schema.sql');
  const sql = await fs.readFile(sqlPath, 'utf-8');
  const pool = new pg.Pool({ connectionString: connStr });
  try {
    await clearAllTablesPG(pool);
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

export async function loadFixtureSchemaMySQL(connStr: string, fixture: string): Promise<void> {
  const sqlPath = path.join(FIXTURES_DIR, fixture, 'schema.mysql.sql');
  const sql = await fs.readFile(sqlPath, 'utf-8');
  const conn = await mysql.createConnection({ uri: connStr, multipleStatements: true });
  try {
    await clearAllTablesMySQL(conn);
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

export async function initMongoCollections(connStr: string, fixture: string, dbName: string): Promise<void> {
  const client = new MongoClient(connStr);
  try {
    await client.connect();
    const db = client.db(dbName);
    const existing = await db.listCollections().toArray();
    for (const c of existing) {
      await db.collection(c.name).drop();
    }
  } finally {
    await client.close();
  }
}

async function clearAllTablesPG(pool: pg.Pool): Promise<void> {
  const res = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = res.rows.map((r: { tablename: string }) => r.tablename);
  if (tables.length === 0) return;
  await pool.query('DROP TABLE IF EXISTS ' + tables.map((t: string) => `"${t}"`).join(', ') + ' CASCADE');
}

async function clearAllTablesMySQL(conn: mysql.Connection): Promise<void> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  );
  const tables = rows.map((r: any) => r.TABLE_NAME);
  if (tables.length === 0) return;
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) {
    await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

/* ------------------------------------------------------------------ */
/*  Truncate all tables for wipe step                                  */
/* ------------------------------------------------------------------ */

export async function truncateAllPG(connStr: string, tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const pool = new pg.Pool({ connectionString: connStr });
  try {
    await pool.query('TRUNCATE TABLE ' + tables.map((t: string) => `"${t}"`).join(', ') + ' CASCADE');
  } finally {
    await pool.end();
  }
}

export async function truncateAllMySQL(connStr: string, tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const conn = await mysql.createConnection({ uri: connStr });
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) {
      await conn.query(`TRUNCATE TABLE \`${t}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

export async function truncateAllMongo(connStr: string, dbName: string, tables: string[]): Promise<void> {
  const client = new MongoClient(connStr);
  try {
    await client.connect();
    const db = client.db(dbName);
    for (const t of tables) {
      await db.collection(t).deleteMany({});
    }
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Fixture configs                                                    */
/* ------------------------------------------------------------------ */

export function getFixtureConfig(fixture: string, connStr: string, dialect: 'postgres' | 'mysql'): SeedForgeConfig {
  const base = { connection: { connectionString: connStr, dialect } };
  const uuid = { kind: 'uuid' as const, params: {} };
  switch (fixture) {
    case 'ecommerce':
      return {
        ...base,
        tables: {
          users: {
            count: 10,
            fields: {
              id: uuid, email: { kind: 'email', params: {} },
              referred_by: uuid,
              role: { kind: 'weighted-categorical', params: { enumValues: ['customer', 'admin'] } },
            },
          },
          products: {
            count: 5,
            fields: { id: uuid, name: { kind: 'fullName', params: {} } },
          },
          tags: {
            count: 3,
            fields: { id: uuid, name: { kind: 'slug', params: {} } },
          },
          product_tags: { count: 8, fields: { product_id: uuid, tag_id: uuid } },
          orders: {
            countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
            fields: {
              id: uuid, user_id: uuid,
              total: { fn: () => 100 },
              status: { kind: 'weighted-categorical', params: { enumValues: ['pending', 'shipped', 'delivered', 'cancelled'] } },
            },
          },
          order_items: {
            countPerParent: { orders: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
            fields: {
              id: uuid, order_id: uuid, product_id: uuid,
              quantity: { kind: 'bounded-integer', params: { min: 1, max: 100 } },
              unit_price: { kind: 'log-normal-currency', params: { mean: 3, stdDev: 0.8 } },
            },
          },
          reviews: {
            countPerParent: { products: { kind: 'uniformInt', params: { min: 0, max: 3 } } },
            fields: { id: uuid, product_id: uuid, user_id: uuid },
          },
        },
      };
    case 'blog':
      return {
        ...base,
        tables: {
          authors: {
            count: 5,
            fields: {
              id: uuid,
              name: { kind: 'fullName', params: {} },
              email: { kind: 'email', params: {} },
              bio: { kind: 'longText', params: { method: 'lorem.paragraphs', count: 2 } },
            },
          },
          tags: {
            count: 6,
            fields: { id: uuid, name: { kind: 'slug', params: {} } },
          },
          posts: {
            countPerParent: { authors: { kind: 'uniformInt', params: { min: 1, max: 4 } } },
            fields: {
              id: uuid, author_id: uuid,
              title: { kind: 'faker', params: { method: 'lorem.sentence', args: [{ min: 3, max: 8 }] } },
              slug: { kind: 'slug', params: {} },
              body: { kind: 'longText', params: { method: 'lorem.paragraphs', count: 3 } },
              published_at: { kind: 'recent-timestamp', params: { weighted: 'recent' } },
            },
          },
          post_tags: {
            count: { kind: 'uniformInt', params: { min: 8, max: 16 } },
            fields: { post_id: uuid, tag_id: uuid },
          },
          comments: {
            countPerParent: { posts: { kind: 'uniformInt', params: { min: 0, max: 6 } } },
            fields: {
              id: uuid, post_id: uuid, parent_comment_id: uuid,
              author_name: { kind: 'firstName', params: {} },
              body: { kind: 'longText', params: { method: 'lorem.paragraphs', count: 1 } },
            },
          },
        },
      };
    case 'saas':
      return {
        ...base,
        tables: {
          organizations: {
            count: 3,
            fields: {
              id: uuid,
              name: { kind: 'faker', params: { method: 'company.name' } },
              slug: { kind: 'slug', params: {} },
            },
          },
          users: {
            count: 8,
            fields: {
              id: uuid,
              email: { kind: 'email', params: {} },
              name: { kind: 'fullName', params: {} },
            },
          },
          memberships: {
            countPerParent: { organizations: { kind: 'uniformInt', params: { min: 2, max: 5 } } },
            fields: {
              organization_id: uuid, user_id: uuid,
              role: { kind: 'weighted-categorical', params: { enumValues: ['admin', 'member', 'viewer'] } },
            },
          },
          activity_events: {
            count: 15,
            fields: {
              id: uuid,
              resource_type: { kind: 'weighted-categorical', params: { enumValues: ['organization', 'user', 'membership'] } },
              resource_id: uuid,
              event_type: { kind: 'weighted-categorical', params: { enumValues: ['created', 'updated', 'deleted', 'archived'] } },
              metadata: { fn: () => ({ source: 'integration-test' }) },
            },
          },
        },
      };
    default:
      throw new Error(`Unknown fixture: ${fixture}`);
  }
}

export function getMongoFixtureConfig(fixture: string, connStr: string, database: string): SeedForgeConfig {
  switch (fixture) {
    case 'ecommerce':
      return {
        connection: { dialect: 'mongodb', connectionString: connStr, database },
        tables: {
          users: {
            count: 10,
            fields: {
              _id: { kind: 'uuid', params: {} },
              firstName: { kind: 'firstName', params: {} },
              lastName: { kind: 'lastName', params: {} },
              role: { kind: 'weighted-categorical', params: { values: { customer: 0.8, admin: 0.2 } } },
              isActive: { kind: 'boolean-skewed', params: { skew: 0.8 } },
            },
          },
          products: {
            count: 5,
            fields: {
              _id: { kind: 'uuid', params: {} },
              name: { kind: 'faker', params: { method: 'commerce.productName' } },
              inStock: { kind: 'boolean-skewed', params: { skew: 0.7 } },
            },
          },
          orders: {
            countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
            fields: {
              _id: { kind: 'uuid', params: {} },
              status: { kind: 'weighted-categorical', params: { values: { pending: 0.4, shipped: 0.3, delivered: 0.2, cancelled: 0.1 } } },
            },
          },
        },
      };
    case 'blog':
      return {
        connection: { dialect: 'mongodb', connectionString: connStr, database },
        tables: {
          authors: {
            count: 5,
            fields: {
              _id: { kind: 'uuid', params: {} },
              name: { kind: 'fullName', params: {} },
              email: { kind: 'email', params: {} },
            },
          },
          tags: {
            count: 6,
            fields: { _id: { kind: 'uuid', params: {} }, name: { kind: 'slug', params: {} } },
          },
          posts: {
            countPerParent: { authors: { kind: 'uniformInt', params: { min: 1, max: 4 } } },
            fields: {
              _id: { kind: 'uuid', params: {} },
              slug: { kind: 'slug', params: {} },
              title: { kind: 'faker', params: { method: 'lorem.sentence', args: [{ min: 3, max: 8 }] } },
            },
          },
          post_tags: {
            count: { kind: 'uniformInt', params: { min: 8, max: 16 } },
            fields: { _id: { kind: 'uuid', params: {} } },
          },
          comments: {
            countPerParent: { posts: { kind: 'uniformInt', params: { min: 0, max: 6 } } },
            fields: {
              _id: { kind: 'uuid', params: {} },
              author_name: { kind: 'firstName', params: {} },
            },
          },
        },
      };
    case 'saas':
      return {
        connection: { dialect: 'mongodb', connectionString: connStr, database },
        tables: {
          organizations: {
            count: 3,
            fields: {
              _id: { kind: 'uuid', params: {} },
              name: { kind: 'faker', params: { method: 'company.name' } },
              slug: { kind: 'slug', params: {} },
            },
          },
          users: {
            count: 8,
            fields: {
              _id: { kind: 'uuid', params: {} },
              email: { kind: 'email', params: {} },
              name: { kind: 'fullName', params: {} },
            },
          },
          memberships: {
            countPerParent: { organizations: { kind: 'uniformInt', params: { min: 2, max: 5 } } },
            fields: {
              _id: { kind: 'uuid', params: {} },
              organizationId: { kind: 'uuid', params: {} },
              userId: { kind: 'uuid', params: {} },
              role: { kind: 'weighted-categorical', params: { enumValues: ['admin', 'member', 'viewer'] } },
            },
          },
          activity_events: {
            count: 15,
            fields: {
              _id: { kind: 'uuid', params: {} },
              resource_type: { kind: 'weighted-categorical', params: { enumValues: ['organization', 'user', 'membership'] } },
              event_type: { kind: 'weighted-categorical', params: { enumValues: ['created', 'updated', 'deleted', 'archived'] } },
            },
          },
        },
      };
    default:
      throw new Error(`Unknown fixture: ${fixture}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Collect generated rows                                             */
/* ------------------------------------------------------------------ */

export async function collectBatches(
  graph: RelationshipGraph,
  plan: GenerationPlan,
  schema: DatabaseSchema,
  seed: number,
): Promise<{ batches: GenerationBatch[]; tableData: Record<string, Record<string, unknown>[]> }> {
  const batches: GenerationBatch[] = [];
  const tableData: Record<string, Record<string, unknown>[]> = {};
  for await (const batch of generate(graph, plan, schema, seed)) {
    batches.push(batch);
    if (batch.phase !== 'insert') continue;
    if (!tableData[batch.table]) tableData[batch.table] = [];
    tableData[batch.table].push(...batch.rows);
  }
  return { batches, tableData };
}

/* ------------------------------------------------------------------ */
/*  Write rows (for seed step)                                         */
/* ------------------------------------------------------------------ */

export async function seedPostgres(connStr: string, batches: GenerationBatch[], graph: RelationshipGraph, schema: DatabaseSchema): Promise<Record<string, number>> {
  async function* iter() { yield* batches; }
  const emitter = new WriteProgressEmitter();
  const result = await pgWrite({ connectionString: connStr }, iter(), graph, schema, { mode: 'fresh', progressEmitter: emitter });
  return result.rowsWritten;
}

export async function seedMySQL(connStr: string, batches: GenerationBatch[], graph: RelationshipGraph, schema: DatabaseSchema): Promise<Record<string, number>> {
  async function* iter() { yield* batches; }
  const emitter = new WriteProgressEmitter();
  const result = await mysqlWrite({ connectionString: connStr }, iter(), graph, schema, { mode: 'fresh', progressEmitter: emitter });
  return result.rowsWritten;
}

export async function seedMongo(connStr: string, database: string, batches: GenerationBatch[], graph: RelationshipGraph, schema: DatabaseSchema): Promise<Record<string, number>> {
  async function* iter() { yield* batches; }
  const emitter = new WriteProgressEmitter();
  const result = await mongoWrite({ connectionString: connStr, database }, iter(), graph, schema, { mode: 'fresh', progressEmitter: emitter });
  return result.rowsWritten;
}

/* ------------------------------------------------------------------ */
/*  Row count verification                                             */
/* ------------------------------------------------------------------ */

export async function getRowCountsPG(connStr: string, tables: string[]): Promise<Record<string, number>> {
  const pool = new pg.Pool({ connectionString: connStr });
  try {
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const res = await pool.query(`SELECT COUNT(*) AS cnt FROM "${t}"`);
      counts[t] = parseInt(res.rows[0]?.cnt ?? '0', 10);
    }
    return counts;
  } finally {
    await pool.end();
  }
}

export async function getRowCountsMySQL(connStr: string, tables: string[]): Promise<Record<string, number>> {
  const conn = await mysql.createConnection({ uri: connStr });
  try {
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
      counts[t] = (rows[0] as any)?.cnt ?? 0;
    }
    return counts;
  } finally {
    await conn.end();
  }
}

export async function getRowCountsMongo(connStr: string, dbName: string, tables: string[]): Promise<Record<string, number>> {
  const client = new MongoClient(connStr);
  try {
    await client.connect();
    const db = client.db(dbName);
    const counts: Record<string, number> = {};
    for (const t of tables) {
      counts[t] = await db.collection(t).countDocuments();
    }
    return counts;
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Referential integrity (SQL only)                                   */
/* ------------------------------------------------------------------ */

export async function checkForeignKeyOrphansPG(connStr: string, schema: DatabaseSchema): Promise<number> {
  let totalOrphans = 0;
  const pool = new pg.Pool({ connectionString: connStr });
  try {
    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        const fkCol = fk.columns[0]!;
        const pkCol = fk.referencedColumns[0]!;
        const refTable = fk.referencedTable;
        const res = await pool.query(
          `SELECT COUNT(*) AS orphans FROM "${table.name}" t ` +
          `WHERE t."${fkCol}" IS NOT NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM "${refTable}" p WHERE p."${pkCol}" = t."${fkCol}")`,
        );
        totalOrphans += parseInt(res.rows[0]?.orphans ?? '0', 10);
      }
    }
    return totalOrphans;
  } finally {
    await pool.end();
  }
}

export async function checkForeignKeyOrphansMySQL(connStr: string, schema: DatabaseSchema): Promise<number> {
  let totalOrphans = 0;
  const conn = await mysql.createConnection({ uri: connStr });
  try {
    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        const fkCol = fk.columns[0]!;
        const pkCol = fk.referencedColumns[0]!;
        const refTable = fk.referencedTable;
        const [rows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS orphans FROM \`${table.name}\` t ` +
          `WHERE t.\`${fkCol}\` IS NOT NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM \`${refTable}\` p WHERE p.\`${pkCol}\` = t.\`${fkCol}\`)`,
        );
        totalOrphans += (rows[0] as any)?.orphans ?? 0;
      }
    }
    return totalOrphans;
  } finally {
    await conn.end();
  }
}

/* ------------------------------------------------------------------ */
/*  Export / Import helpers                                            */
/* ------------------------------------------------------------------ */

export async function exportBundleFile(
  config: SeedForgeConfig,
  schema: DatabaseSchema,
  tableData: Record<string, Record<string, unknown>[]>,
  seed: number,
): Promise<string> {
  const outFile = path.join(os.tmpdir(), `sfbundle-${Date.now()}.sfbundle`);
  const configHash = computeConfigHash(config);
  const rowsWritten: Record<string, number> = {};
  for (const [t, rows] of Object.entries(tableData)) {
    rowsWritten[t] = rows.length;
  }
  await exportBundle({
    out: outFile,
    snapshot: true,
    config: { connection: config.connection, tables: config.tables },
    lockfile: {
      schemaHash: schema.schemaHash,
      acknowledgedSchemaHash: null,
      configHash,
      seedValue: seed,
      seedforgeVersion: '0.1.0',
      generatedAt: new Date().toISOString(),
      perTableRowCounts: rowsWritten,
    },
    tableData,
  });
  return outFile;
}

export async function importBundleFile(
  file: string,
  connStr: string,
  dialect: 'postgres' | 'mysql' | 'mongodb',
  mongoDbName?: string,
): Promise<{ rowsImported: Record<string, number>; blocked: boolean }> {
  const result = await importBundle({
    file,
    force: false,
    introspect: async () => {
      if (dialect === 'postgres') {
        const s = await pgIntrospect({ connectionString: connStr });
        return { schemaHash: s.schemaHash, tables: s.tables.map((t: any) => ({ name: t.name, columns: t.columns.map((c: any) => ({ name: c.name })) })) };
      }
      if (dialect === 'mysql') {
        const s = await mysqlIntrospect({ connectionString: connStr });
        return { schemaHash: s.schemaHash, tables: s.tables.map((t: any) => ({ name: t.name, columns: t.columns.map((c: any) => ({ name: c.name })) })) };
      }
      if (dialect === 'mongodb') {
        const s = await mongoIntrospect({ connectionString: connStr, database: mongoDbName! });
        return { schemaHash: s.schemaHash, tables: s.tables.map((t: any) => ({ name: t.name, columns: t.columns.map((c: any) => ({ name: c.name })) })) };
      }
      throw new Error(`Unknown dialect: ${dialect}`);
    },
    writeRows: async (table: string, rows: Record<string, unknown>[]) => {
      if (dialect === 'postgres') return writeRowsPG(connStr, table, rows);
      if (dialect === 'mysql') return writeRowsMySQL(connStr, table, rows);
      if (dialect === 'mongodb') return writeRowsMongo(connStr, mongoDbName!, table, rows);
      throw new Error(`Unknown dialect: ${dialect}`);
    },
  });
  return { rowsImported: result.rowsImported, blocked: result.blocked };
}

async function writeRowsPG(connStr: string, table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = new pg.Pool({ connectionString: connStr });
  try {
    const columns = Object.keys(rows[0]!);
    const values = rows.map(r => columns.map(c => r[c]));
    const placeholders = values.map((_, i) =>
      `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
    ).join(', ');
    const flatValues = values.flat();
    if (flatValues.length === 0) return 0;
    await pool.query(
      `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${placeholders}`,
      flatValues,
    );
    return rows.length;
  } finally {
    await pool.end();
  }
}

async function writeRowsMySQL(connStr: string, table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const conn = await mysql.createConnection({ uri: connStr });
  try {
    const columns = Object.keys(rows[0]!);
    const values = rows.map(r => columns.map(c => r[c]));
    const placeholders = values.map(() =>
      `(${columns.map(() => '?').join(', ')})`
    ).join(', ');
    const flatValues = values.flat().map(v => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        return v.slice(0, 19).replace('T', ' ');
      }
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    if (flatValues.length === 0) return 0;
    await conn.query(
      `INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES ${placeholders}`,
      flatValues,
    );
    return rows.length;
  } finally {
    await conn.end();
  }
}

async function writeRowsMongo(connStr: string, dbName: string, table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = new MongoClient(connStr);
  try {
    await client.connect();
    const result = await client.db(dbName).collection(table).insertMany(rows as any[]);
    return result.insertedCount;
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Pipeline runner — full end-to-end                                   */
/* ------------------------------------------------------------------ */

export interface PipelineResult {
  schema: DatabaseSchema;
  graph: RelationshipGraph;
  plan: GenerationPlan;
  rowsWritten: Record<string, number>;
  tableData: Record<string, Record<string, unknown>[]>;
  bundleFile: string;
}

export async function runPgPipeline(connStr: string, fixture: string, seed = 42): Promise<PipelineResult> {
  await loadFixtureSchemaPG(connStr, fixture);
  const config = getFixtureConfig(fixture, connStr, 'postgres');

  // When SEEDFORGE_CLI_PATH is set, dogfood the CLI instead of calling core lib
  const cliPath = process.env.SEEDFORGE_CLI_PATH;
  if (cliPath) {
    const tmpConfig = path.join(os.tmpdir(), `sf-config-${Date.now()}.json`);
    await fs.writeFile(tmpConfig, JSON.stringify({ ...config, seed }));
    let stdout: string;
    try {
      stdout = execSync(
        `${cliPath} seed --config "${tmpConfig}" --mode fresh --seed ${seed} --json`,
        { env: { ...process.env, SEEDFORGE_CONNECTION_STRING: connStr }, stdio: 'pipe' },
      ).toString();
    } catch (err) {
      await fs.unlink(tmpConfig).catch(() => {});
      const execErr = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      throw new Error(
        `CLI seed failed:\n` +
        `  ${execErr.message ?? 'unknown'}\n` +
        `  STDOUT: ${(execErr.stdout?.toString() ?? '').slice(0, 2000)}\n` +
        `  STDERR: ${(execErr.stderr?.toString() ?? '').slice(0, 2000)}`,
      );
    }
    await fs.unlink(tmpConfig).catch(() => {});
    // Validate CLI JSON output — catch errors the CLI reported but still exited 0
    let cliResult: { rowsWritten?: Record<string, number>; error?: boolean; message?: string };
    try {
      cliResult = JSON.parse(stdout) as typeof cliResult;
    } catch {
      throw new Error(`CLI produced non-JSON output:\n${stdout.slice(0, 2000)}`);
    }
    if (cliResult.error) {
      throw new Error(`CLI reported error: ${cliResult.message}`);
    }
    const schema = await pgIntrospect({ connectionString: connStr });
    const graph = buildGraph(schema);
    const matches = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, matches);
    const allTables = schema.tables.map((t) => t.name);
    const rowsWritten = await getRowCountsPG(connStr, allTables);
    return { schema, graph, plan, rowsWritten, tableData: {}, bundleFile: '' };
  }

  const schema = await pgIntrospect({ connectionString: connStr });
  const matches = analyzeSchema(schema);
  const graph = buildGraph(schema);
  const plan = buildGenerationPlan(schema, config, matches);
  const { batches, tableData } = await collectBatches(graph, plan, schema, seed);
  const rowsWritten = await seedPostgres(connStr, batches, graph, schema);
  const bundleFile = await exportBundleFile(config, schema, tableData, seed);
  return { schema, graph, plan, rowsWritten, tableData, bundleFile };
}

export async function runMysqlPipeline(connStr: string, fixture: string, seed = 42): Promise<PipelineResult> {
  await loadFixtureSchemaMySQL(connStr, fixture);
  const config = getFixtureConfig(fixture, connStr, 'mysql');

  const cliPath = process.env.SEEDFORGE_CLI_PATH;
  if (cliPath) {
    const tmpConfig = path.join(os.tmpdir(), `sf-config-${Date.now()}.json`);
    await fs.writeFile(tmpConfig, JSON.stringify({ ...config, seed }));
    let stdout: string;
    try {
      stdout = execSync(
        `${cliPath} seed --config "${tmpConfig}" --mode fresh --seed ${seed} --json`,
        { env: { ...process.env, SEEDFORGE_CONNECTION_STRING: connStr }, stdio: 'pipe' },
      ).toString();
    } catch (err) {
      await fs.unlink(tmpConfig).catch(() => {});
      const execErr = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      throw new Error(
        `CLI seed failed:\n` +
        `  ${execErr.message ?? 'unknown'}\n` +
        `  STDOUT: ${(execErr.stdout?.toString() ?? '').slice(0, 2000)}\n` +
        `  STDERR: ${(execErr.stderr?.toString() ?? '').slice(0, 2000)}`,
      );
    }
    await fs.unlink(tmpConfig).catch(() => {});
    let cliResult: { rowsWritten?: Record<string, number>; error?: boolean; message?: string };
    try {
      cliResult = JSON.parse(stdout) as typeof cliResult;
    } catch {
      throw new Error(`CLI produced non-JSON output:\n${stdout.slice(0, 2000)}`);
    }
    if (cliResult.error) {
      throw new Error(`CLI reported error: ${cliResult.message}`);
    }
    const schema = await mysqlIntrospect({ connectionString: connStr });
    const graph = buildGraph(schema);
    const matches = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, matches);
    const allTables = schema.tables.map((t) => t.name);
    const rowsWritten = await getRowCountsMySQL(connStr, allTables);
    return { schema, graph, plan, rowsWritten, tableData: {}, bundleFile: '' };
  }

  const schema = await mysqlIntrospect({ connectionString: connStr });
  const matches = analyzeSchema(schema);
  const graph = buildGraph(schema);
  const plan = buildGenerationPlan(schema, config, matches);
  const { batches, tableData } = await collectBatches(graph, plan, schema, seed);
  const rowsWritten = await seedMySQL(connStr, batches, graph, schema);
  const bundleFile = await exportBundleFile(config, schema, tableData, seed);
  return { schema, graph, plan, rowsWritten, tableData, bundleFile };
}

export async function runMongoPipeline(connStr: string, dbName: string, fixture: string, seed = 42): Promise<PipelineResult> {
  await initMongoCollections(connStr, fixture, dbName);
  const config = getMongoFixtureConfig(fixture, connStr, dbName);
  // Create empty collections so the introspector discovers them (MongoDB drops
  // all metadata when collections are empty — without this the schema is empty
  // and the generate engine skips all tables at engine.ts:104).
  const createClient = new MongoClient(connStr);
  try {
    await createClient.connect();
    const db = createClient.db(dbName);
    const tableNames = Object.keys(config.tables);
    const existing = await db.listCollections().toArray();
    const existingNames = new Set(existing.map((c: any) => c.name));
    for (const name of tableNames) {
      if (!existingNames.has(name)) {
        await db.createCollection(name);
      }
    }
  } finally {
    await createClient.close();
  }

  const cliPath = process.env.SEEDFORGE_CLI_PATH;
  if (cliPath) {
    const tmpConfig = path.join(os.tmpdir(), `sf-config-${Date.now()}.json`);
    await fs.writeFile(tmpConfig, JSON.stringify({ ...config, seed }));
    let stdout: string;
    try {
      stdout = execSync(
        `${cliPath} seed --config "${tmpConfig}" --mode fresh --seed ${seed} --json`,
        { stdio: 'pipe' },
      ).toString();
    } catch (err) {
      await fs.unlink(tmpConfig).catch(() => {});
      const execErr = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      throw new Error(
        `CLI seed failed:\n` +
        `  ${execErr.message ?? 'unknown'}\n` +
        `  STDOUT: ${(execErr.stdout?.toString() ?? '').slice(0, 2000)}\n` +
        `  STDERR: ${(execErr.stderr?.toString() ?? '').slice(0, 2000)}`,
      );
    }
    await fs.unlink(tmpConfig).catch(() => {});
    let cliResult: { rowsWritten?: Record<string, number>; error?: boolean; message?: string };
    try {
      cliResult = JSON.parse(stdout) as typeof cliResult;
    } catch {
      throw new Error(`CLI produced non-JSON output:\n${stdout.slice(0, 2000)}`);
    }
    if (cliResult.error) {
      throw new Error(`CLI reported error: ${cliResult.message}`);
    }
    const schema = await mongoIntrospect({ connectionString: connStr, database: dbName });
    const graph = buildGraph(schema);
    const matches = analyzeSchema(schema);
    const plan = buildGenerationPlan(schema, config, matches);
    const allTables = schema.tables.map((t) => t.name);
    const rowsWritten = await getRowCountsMongo(connStr, dbName, allTables);
    return { schema, graph, plan, rowsWritten, tableData: {}, bundleFile: '' };
  }

  const schema = await mongoIntrospect({ connectionString: connStr, database: dbName });
  const matches = analyzeSchema(schema);
  const graph = buildGraph(schema);
  const plan = buildGenerationPlan(schema, config, matches);
  const { batches, tableData } = await collectBatches(graph, plan, schema, seed);
  const rowsWritten = await seedMongo(connStr, dbName, batches, graph, schema);
  const bundleFile = await exportBundleFile(config, schema, tableData, seed);
  return { schema, graph, plan, rowsWritten, tableData, bundleFile };
}
