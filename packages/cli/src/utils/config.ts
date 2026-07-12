import { createJiti } from 'jiti';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ConnectConfig, SeedForgeConfig } from '@seed-forge/core';

export async function loadConfig(configPath?: string): Promise<SeedForgeConfig> {
  const resolved = path.resolve(configPath ?? 'seedforge.config.ts');

  try {
    await fs.access(resolved);
  } catch {
    return { connection: {} as SeedForgeConfig['connection'], tables: {} };
  }

  if (resolved.endsWith('.json')) {
    const content = await fs.readFile(resolved, 'utf-8');
    return JSON.parse(content) as SeedForgeConfig;
  }

  // Use jiti to load TypeScript config at runtime
  const jiti = createJiti(process.cwd(), {
    interopDefault: true,
    moduleCache: false,
  });

  const mod: unknown = await jiti.import(resolved);
  const config = (mod as Record<string, unknown>).default ?? mod;
  return config as SeedForgeConfig;
}

export function inferConnectConfig(config: SeedForgeConfig): ConnectConfig {
  // Env var overrides for CI/action usage, following existing dotenv convention
  const envConnStr = process.env.SEEDFORGE_CONNECTION_STRING;
  const envDialect = process.env.SEEDFORGE_DIALECT;

  const conn = config.connection;
  if (conn?.source === 'prisma' || conn?.source === 'drizzle') {
    return {
      dialect: envDialect ?? conn.source,
      schemaPath: conn.schemaPath ?? 'schema.prisma',
    };
  }
  if (conn?.dialect || envDialect || envConnStr) {
    return {
      dialect: envDialect ?? conn?.dialect ?? 'postgres',
      connectionString: envConnStr ?? conn?.connectionString,
      ...(conn?.database ? { database: conn.database } : {}),
    };
  }
  return { dialect: 'postgres' };
}