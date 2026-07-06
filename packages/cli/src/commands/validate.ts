import { introspect, buildGraph, buildGenerationPlan, analyzeSchema, validatePreFlight } from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, renderValidationTable, printHeading } from '../utils/format.js';

export async function validateCommand(opts: { config?: string }): Promise<void> {
  try {
    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);
    await registerAdapters(connectConfig.dialect);

    const schema = await introspect(connectConfig);
    const matches = analyzeSchema(schema);
    const graph = buildGraph(schema);
    const plan = buildGenerationPlan(schema, config, matches);

    const result = validatePreFlight(plan, schema, graph);

    if (isJsonMode()) {
      printJson(result);
      return;
    }

    printHeading('Pre-Flight Validation Report');

    if (result.valid) {
      printSuccess('All checks passed');
    } else {
      for (const e of result.entries) {
        if (e.status === 'fail') {
          console.log(`  ✖ ${e.table}${e.column ? '.' + e.column : ''}: ${e.message ?? e.rule}`);
        }
      }
    }

    if (result.entries.length > 0) {
      console.log('');
      console.log(renderValidationTable(result.entries));
    }

    if (!result.valid) {
      process.exit(1);
    }
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }
}