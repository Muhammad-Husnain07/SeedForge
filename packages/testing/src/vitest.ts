import { beforeAll, afterAll } from 'vitest';
import type { DatabaseSchema, SeedForgeConfig, RelationshipGraph, GenerationBatch, ConnectConfig, WriteMode } from '@seed-forge/core';
import { analyzeSchema, buildGraph, buildGenerationPlan, generate, hashToSeed } from '@seed-forge/core';
import type { WithSeedAdapter } from './withSeed.js';

export interface SeedForgeVitestOptions {
  adapter: WithSeedAdapter;
  connectConfig: ConnectConfig;
  seedConfig: SeedForgeConfig;
  scope?: 'suite' | 'file';
  seed?: number;
  mode?: 'fresh' | 'truncate' | 'append';
}

async function* emptyAsync(): AsyncGenerator<GenerationBatch> {}

export function seedForgeSetup(opts: SeedForgeVitestOptions): void {
  beforeAll(async () => {
    const schema = await opts.adapter.introspect(opts.connectConfig);
    const matches = analyzeSchema(schema);
    const graph = buildGraph(schema);
    const plan = buildGenerationPlan(schema, opts.seedConfig, matches);
    const seed = opts.seed ?? hashToSeed(schema.schemaHash);
    const mode = opts.mode ?? 'fresh';

    const refDate = 1_720_000_000_000 + seed * 1_000;
    const batches = generate(graph, plan, schema, seed, { refDate });
    await opts.adapter.write(opts.connectConfig, batches, graph, schema, {
      mode,
      batchSize: 1000,
    });
  }, 30_000);

  afterAll(async () => {
    const schema = await opts.adapter.introspect(opts.connectConfig);
    const graph = buildGraph(schema);
    await opts.adapter.write(opts.connectConfig, emptyAsync(), graph, schema, {
      mode: 'truncate' as WriteMode,
    });
  }, 30_000);
}
