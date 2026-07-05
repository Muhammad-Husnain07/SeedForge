import type { FastifyInstance } from 'fastify';
import { generate } from '@seedforge/core';
import { getContext, rebuildPlan } from '../context.js';
import { startSeedRun, generatePreview } from '../seed-runner.js';
import { eventBus } from '../events.js';
import { randomUUID } from 'node:crypto';

export async function seedRoutes(server: FastifyInstance): Promise<void> {
  // Trigger preview regeneration
  server.post('/preview', async (req) => {
    const ctx = getContext();
    const body = req.body as { rowsPerTable?: number } | undefined;
    const rowsPerTable = Math.min(body?.rowsPerTable ?? 10, 100);
    const plan = ctx.plan;

    const results = await generatePreview(plan, ctx.schema, ctx.graph, ctx.seed, rowsPerTable);
    eventBus.emit('preview', { rowsPerTable, tables: results });
    return { rowsPerTable, tables: results.map((r) => ({ table: r.table, rows: r.rows.length })) };
  });

  // Start a seed run
  server.post('/seed', async (req) => {
    const ctx = getContext();
    const body = req.body as { mode?: string; batchSize?: number } | undefined;
    const mode = body?.mode ?? 'fresh';
    const batchSize = body?.batchSize;

    const runId = randomUUID().slice(0, 8);
    const writeConfig: Record<string, unknown> = {
      connectionString: (ctx.connectConfig as Record<string, unknown>).connectionString,
    };
    if ((ctx.connectConfig as Record<string, unknown>).database) {
      writeConfig.database = (ctx.connectConfig as Record<string, unknown>).database;
    }

    const batches = generate(ctx.graph, ctx.plan, ctx.schema, ctx.seed, { batchSize });

    // Fire and forget (progress goes via SSE)
    startSeedRun(
      runId,
      ctx.connectConfig.dialect,
      writeConfig,
      batches,
      ctx.graph,
      ctx.schema,
      mode,
      batchSize,
    );

    return { runId, status: 'started' };
  });

  // Poll seed result
  server.get<{ Params: { id: string } }>('/seed/:id', async (req) => {
    const { getSeedRun } = await import('../seed-runner.js');
    const run = getSeedRun(req.params.id);
    if (!run) return { error: 'Run not found' };
    return run;
  });
}
