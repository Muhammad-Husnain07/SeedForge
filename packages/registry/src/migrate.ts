import pg from 'pg';
import crypto from 'node:crypto';

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org         TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      label       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org         TEXT NOT NULL,
      project     TEXT NOT NULL,
      name        TEXT NOT NULL,
      version     TEXT NOT NULL DEFAULT 'latest',
      manifest    JSONB NOT NULL,
      config      JSONB NOT NULL,
      lockfile    JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(org, project, name, version)
    )
  `);
}

export async function seedDemoToken(pool: pg.Pool): Promise<void> {
  const rawToken = process.env.SEEDFORGE_REGISTRY_TOKEN_SEED;
  if (!rawToken) return;
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await pool.query(
    `INSERT INTO api_tokens (org, token_hash, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO NOTHING`,
    ['acme', hash, 'demo token from env'],
  );
}
