import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function queryTokenByHash(
  pool: pg.Pool,
  tokenHash: string,
): Promise<{ id: string; org: string } | null> {
  const result = await pool.query(
    'SELECT id, org FROM api_tokens WHERE token_hash = $1',
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function insertProfile(
  pool: pg.Pool,
  params: {
    org: string;
    project: string;
    name: string;
    version: string;
    manifest: unknown;
    config: unknown;
    lockfile: unknown;
  },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO profiles (org, project, name, version, manifest, config, lockfile)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
     ON CONFLICT (org, project, name, version)
     DO UPDATE SET manifest = $5::jsonb, config = $6::jsonb, lockfile = $7::jsonb, updated_at = now()
     RETURNING id`,
    [params.org, params.project, params.name, params.version,
     JSON.stringify(params.manifest), JSON.stringify(params.config), JSON.stringify(params.lockfile)],
  );
  return result.rows[0]!.id;
}

export async function fetchProfile(
  pool: pg.Pool,
  org: string,
  project: string,
  name: string,
  version?: string,
): Promise<{
  id: string;
  manifest: unknown;
  config: unknown;
  lockfile: unknown;
  created_at: string;
} | null> {
  const v = version ?? 'latest';
  const result = await pool.query(
    `SELECT id, manifest, config, lockfile, created_at
     FROM profiles
     WHERE org = $1 AND project = $2 AND name = $3 AND version = $4`,
    [org, project, name, v],
  );
  return result.rows[0] ?? null;
}

export async function listProfiles(
  pool: pg.Pool,
  org: string,
  project: string,
): Promise<Array<{ name: string; version: string; created_at: string }>> {
  const result = await pool.query(
    `SELECT name, version, created_at
     FROM profiles
     WHERE org = $1 AND project = $2
     ORDER BY name, version DESC`,
    [org, project],
  );
  return result.rows;
}
