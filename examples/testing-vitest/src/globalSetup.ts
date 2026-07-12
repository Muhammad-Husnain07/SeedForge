import { GenericContainer } from 'testcontainers';
import pg from 'pg';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../..', 'fixtures', 'ecommerce');
const SCHEMA_SQL = path.join(FIXTURES_DIR, 'schema.sql');

async function waitForPostgres(connStr: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const client = new pg.Client({ connectionString: connStr });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Postgres did not become ready in time');
}

async function loadSchema(connStr: string): Promise<void> {
  const sql = await fs.readFile(SCHEMA_SQL, 'utf-8');
  const client = new pg.Client({ connectionString: connStr });
  await client.connect();
  await client.query(sql);
  await client.end();
}

export async function setup(): Promise<() => Promise<void>> {
  const container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'seedforge',
      POSTGRES_PASSWORD: 'seedforge',
      POSTGRES_DB: 'seedforge',
    })
    .withExposedPorts(5432)
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const connStr = `postgres://seedforge:seedforge@${host}:${port}/seedforge`;

  process.env.DATABASE_URL = connStr;

  await waitForPostgres(connStr);
  await loadSchema(connStr);

  return async () => {
    await container.stop();
  };
}
