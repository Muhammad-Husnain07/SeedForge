import {
  analyzeSchema,
  buildGraph,
  buildGenerationPlan,
  generate,
  hashToSeed,
  WriteProgressEmitter,
} from '@seed-forge/core';
import type {
  DatabaseSchema,
  SeedForgeConfig,
  RelationshipGraph,
  GenerationPlan,
  GenerationBatch,
  ConnectConfig,
  WriteMode,
  WriteResult,
} from '@seed-forge/core';

export interface WithSeedAdapter {
  introspect(config: ConnectConfig): Promise<DatabaseSchema>;
  write(
    config: ConnectConfig,
    batches: AsyncIterable<GenerationBatch>,
    graph: RelationshipGraph,
    schema: DatabaseSchema,
    options: { mode: WriteMode; batchSize?: number },
  ): Promise<WriteResult>;
}

export interface WithSeedOptions {
  mode?: 'fresh' | 'truncate' | 'append';
  seed?: number;
}

async function* emptyAsync(): AsyncGenerator<GenerationBatch> {}

export async function withSeed<T>(
  adapter: WithSeedAdapter,
  connectConfig: ConnectConfig,
  seedConfig: SeedForgeConfig,
  options: WithSeedOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const schema = await adapter.introspect(connectConfig);
  const matches = analyzeSchema(schema);
  const graph = buildGraph(schema);
  const plan = buildGenerationPlan(schema, seedConfig, matches);

  const seed = options.seed ?? hashToSeed(schema.schemaHash);
  const mode = options.mode ?? 'fresh';

  // Derive deterministic refDate from seed so timestamps are reproducible
  const refDate = 1_720_000_000_000 + seed * 1_000;
  const batches = generate(graph, plan, schema, seed, { refDate });
  const emitter = new WriteProgressEmitter();

  await adapter.write(connectConfig, batches, graph, schema, {
    mode,
    batchSize: 1000,
  });

  try {
    return await fn();
  } finally {
    await adapter.write(connectConfig, emptyAsync(), graph, schema, {
      mode: 'truncate',
    });
  }
}
