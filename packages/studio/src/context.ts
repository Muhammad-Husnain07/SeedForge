import { createJiti } from 'jiti';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  SeedForgeConfig,
  DatabaseSchema,
  RelationshipGraph,
  GenerationPlan,
  FieldSemanticMatch,
  ConnectConfig,
} from '@seed-forge/core';
import {
  introspect,
  buildGraph,
  buildGenerationPlan,
  analyzeSchema,
  hashToSeed,
  registerIntrospector,
} from '@seed-forge/core';

export interface StudioContext {
  config: SeedForgeConfig;
  connectConfig: ConnectConfig;
  schema: DatabaseSchema;
  graph: RelationshipGraph;
  plan: GenerationPlan;
  matches: FieldSemanticMatch[];
  seed: number;
  plugins: unknown[];
}

let ctx: StudioContext | null = null;

export function getContext(): StudioContext {
  if (!ctx) throw new Error('Studio context not initialized. Call loadContext() first.');
  return ctx;
}

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
  const jiti = createJiti(process.cwd(), { interopDefault: true, moduleCache: false });
  const mod = await jiti.import(resolved);
  return (mod.default ?? mod) as SeedForgeConfig;
}

function inferConnectConfig(config: SeedForgeConfig): ConnectConfig {
  const conn = config.connection;
  if (conn?.dialect) {
    return {
      dialect: conn.dialect,
      connectionString: conn.connectionString,
      ...(conn.database ? { database: conn.database } : {}),
    } as ConnectConfig;
  }
  return { dialect: 'postgres' } as ConnectConfig;
}

async function registerAdapters(dialect: string): Promise<void> {
  switch (dialect) {
    case 'postgres': {
      const mod = await import('@seed-forge/adapter-postgres');
      registerIntrospector('postgres', { introspect: mod.introspect });
      break;
    }
    case 'mysql': {
      const mod = await import('@seed-forge/adapter-mysql');
      registerIntrospector('mysql', { introspect: mod.introspect });
      break;
    }
    case 'mongodb': {
      const mod = await import('@seed-forge/adapter-mongodb');
      registerIntrospector('mongodb', { introspect: mod.introspect });
      break;
    }
  }
}

export async function initializeContext(configPath?: string): Promise<StudioContext> {
  const config = await loadConfig(configPath);
  const connectConfig = inferConnectConfig(config);
  await registerAdapters(connectConfig.dialect);
  const schema = await introspect(connectConfig);
  const matches = analyzeSchema(schema);
  const graph = buildGraph(schema);
  const plan = buildGenerationPlan(schema, config, matches);
  const seed = hashToSeed(schema.schemaHash);

  ctx = { config, connectConfig, schema, graph, plan, matches, seed, plugins: [] };
  return ctx;
}

export function rebuildPlan(
  configOverride?: Partial<SeedForgeConfig>,
): StudioContext {
  if (!ctx) throw new Error('Context not initialized');
  if (configOverride) {
    if (configOverride.tables) {
      ctx.config.tables = { ...ctx.config.tables, ...configOverride.tables as Record<string, unknown> };
    }
  }
  ctx.matches = analyzeSchema(ctx.schema);
  ctx.graph = buildGraph(ctx.schema);
  ctx.plan = buildGenerationPlan(ctx.schema, ctx.config, ctx.matches);
  return ctx;
}
