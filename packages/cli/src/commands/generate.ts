import {
  introspect,
  buildGraph,
  buildGenerationPlan,
  analyzeSchema,
  generate,
  hashToSeed,
  loadPlugins,
} from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, renderRowPreview, printHeading, printInfo } from '../utils/format.js';

export async function generateCommand(opts: { config?: string; seed?: string; preview?: string }): Promise<void> {
  try {
    const previewCount = opts.preview ? parseInt(opts.preview, 10) : 0;
    if (previewCount <= 0) {
      printError('Use --preview <n> to specify how many sample rows to generate.');
      process.exit(1);
    }

    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);
    await registerAdapters(connectConfig.dialect);

    // Load plugins
    const pluginResult = await loadPlugins(config.plugins);
    if (pluginResult.plugins.length > 0 && !isJsonMode()) {
      printInfo(`Loaded ${pluginResult.plugins.length} plugin(s): ${pluginResult.plugins.map((p) => p.plugin.name).join(', ')}`);
    }

    const schema = await introspect(connectConfig);
    const matches = analyzeSchema(schema);
    const graph = buildGraph(schema);
    const plan = buildGenerationPlan(schema, config, matches);

    const seed = opts.seed ? parseInt(opts.seed, 10) : hashToSeed(schema.schemaHash);

    const genOptions = { plugins: pluginResult.plugins };

    if (isJsonMode()) {
      const allRows: Record<string, Record<string, unknown>[]> = {};
      for await (const batch of generate(graph, plan, schema, seed, genOptions)) {
        if (!allRows[batch.table]) allRows[batch.table] = [];
        const remaining = previewCount - allRows[batch.table].length;
        if (remaining > 0) {
          allRows[batch.table].push(...batch.rows.slice(0, remaining));
        }
      }
      printJson({ seed, preview: true, sampleRows: allRows });
      return;
    }

    printHeading(`Generation Preview (${previewCount} rows per table, seed=${seed})`);
    console.log('');

    const perTablePreview: Record<string, Record<string, unknown>[]> = {};
    for await (const batch of generate(graph, plan, schema, seed, genOptions)) {
      if (!perTablePreview[batch.table]) perTablePreview[batch.table] = [];
      const remaining = previewCount - perTablePreview[batch.table].length;
      if (remaining > 0) {
        perTablePreview[batch.table].push(...batch.rows.slice(0, remaining));
      }
    }

    for (const [table, rows] of Object.entries(perTablePreview)) {
      console.log(renderRowPreview(table, rows));
      console.log('');
    }

    printSuccess(`Preview complete — ${Object.keys(perTablePreview).length} tables, ${previewCount} sample rows each. No data written.`);
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }
}