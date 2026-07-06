import {
  introspect,
  buildGraph,
  buildGenerationPlan,
  analyzeSchema,
  generate,
  createLockfile,
  validatePreFlight,
  verifyPostWrite,
  hashToSeed,
  WriteProgressEmitter,
  loadPlugins,
} from '@seedforge/core';
import type { WriteMode } from '@seedforge/core';
import ora from 'ora';
import { performance } from 'node:perf_hooks';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters, getWriteFunction } from '../utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, printInfo, printHeading, renderValidationTable } from '../utils/format.js';

export async function seedCommand(opts: {
  config?: string;
  seed?: string;
  mode?: string;
  tables?: string;
  batchSize?: number;
  parallel?: boolean;
  count?: number;
  verify?: boolean;
  benchmark?: boolean;
}): Promise<void> {
  try {
    const mode = (opts.mode ?? 'fresh') as WriteMode;
    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);
    await registerAdapters(connectConfig.dialect);

    // Load plugins
    const pluginResult = await loadPlugins(config.plugins);
    if (pluginResult.plugins.length > 0 && !isJsonMode()) {
      printInfo(`Loaded ${pluginResult.plugins.length} plugin(s): ${pluginResult.plugins.map((p) => p.plugin.name).join(', ')}`);
    }

    const schema = await introspect(connectConfig);

    // Call onSchemaIntrospected hooks
    for (const { plugin } of pluginResult.plugins) {
      if (plugin.onSchemaIntrospected) await plugin.onSchemaIntrospected(schema);
    }

    const matches = analyzeSchema(schema);
    const graph = buildGraph(schema);
    const plan = buildGenerationPlan(schema, config, matches);

    // Pre-flight validation
    const preFlight = validatePreFlight(plan, schema, graph);
    if (!preFlight.valid) {
      if (isJsonMode()) {
        printJson({ error: true, message: 'Pre-flight validation failed', entries: preFlight.entries });
      } else {
        printError('Pre-flight validation failed:');
        console.log(renderValidationTable(preFlight.entries));
      }
      process.exit(1);
    }

    const seed = opts.seed ? parseInt(opts.seed, 10) : hashToSeed(schema.schemaHash);
    const tablesFilter = opts.tables ? opts.tables.split(',').map((t: string) => t.trim()) : null;

    // Scale plan to --count if provided
    if (opts.count) {
      let currentTotal = 0;
      for (const t of Object.values(plan.tables)) {
        if (typeof t.count === 'number') currentTotal += t.count;
      }
      const multiplier = currentTotal > 0 ? opts.count / currentTotal : 1;
      for (const table of Object.values(plan.tables)) {
        if (typeof table.count === 'number') {
          table.count = Math.max(1, Math.round(table.count * multiplier));
        }
      }
    }

    // Build write config
    const writeConfig: Record<string, unknown> = {
      connectionString: connectConfig.connectionString,
    };
    if (connectConfig.database) {
      writeConfig.database = connectConfig.database;
    }

    const writeFn = await getWriteFunction(connectConfig.dialect);

    if (isJsonMode()) {
      // JSON mode — no spinner, just data
      const progressEmitter = new WriteProgressEmitter();
      const events: unknown[] = [];
      progressEmitter.on('progress', (e: unknown) => events.push(e));

      const genOpts: import('@seedforge/core').GenerateOptions = { plugins: pluginResult.plugins };
      if (opts.batchSize) genOpts.batchSize = opts.batchSize;
      const batches = opts.parallel
        ? generateFilteredParallel(graph, plan, schema, seed, tablesFilter, genOpts)
        : generateFiltered(graph, plan, schema, seed, tablesFilter, genOpts);
      const result = await writeFn(writeConfig, batches, graph, schema, {
        mode,
        batchSize: opts.batchSize,
        progressEmitter,
      });

      let verifyResult = null;
      if (opts.verify) {
        // Collect all rows for verification
        const rowsByTable: Record<string, Record<string, unknown>[]> = {};
        for await (const batch of generateFiltered(graph, plan, schema, seed, tablesFilter, genOpts)) {
          if (!rowsByTable[batch.table]) rowsByTable[batch.table] = [];
          rowsByTable[batch.table].push(...batch.rows);
        }
        verifyResult = verifyPostWrite(plan, schema, rowsByTable);
      }

      printJson({
        seed,
        mode,
        rowsWritten: result.rowsWritten,
        elapsedMs: result.elapsedMs,
        progressEvents: events,
        verify: verifyResult,
      });
    } else {
      // Interactive mode — spinner per table
      const progressEmitter = new WriteProgressEmitter();
      const spinners: Record<string, ora.Ora> = {};

      progressEmitter.on('progress', (e: { table: string; phase: string; rowsWritten: number; rowsTotal: number }) => {
        if (!spinners[e.table]) {
          spinners[e.table] = ora({ text: `${e.table}: waiting...`, color: 'cyan' }).start();
        }
        if (e.phase === 'truncate') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          spinners[e.table]!.text = `${e.table}: truncating...`;
        } else if (e.phase === 'verify') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          spinners[e.table]!.text = `${e.table}: verifying...`;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          spinners[e.table]!.text = `${e.table}: ${e.rowsWritten}/${e.rowsTotal} rows`;
        }
        if (e.rowsWritten >= e.rowsTotal && e.rowsTotal > 0) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          spinners[e.table]!.succeed(`${e.table}: ${e.rowsWritten} rows written`);
        }
      });

      printInfo(`Seeding database (mode=${mode}, seed=${seed})`);

      // Benchmark tracking
      const startRss = process.memoryUsage().rss;
      const benchmarkData: {
        tableTimes: Record<string, { start: number; firstBatchEnd: number; lastBatchEnd: number; rows: number }>;
        startTime: number;
      } = {
        tableTimes: {},
        startTime: performance.now(),
      };

      async function* withBenchmarkTracking(
        batches: AsyncIterable<import('@seedforge/core').GenerationBatch>,
      ): AsyncGenerator<import('@seedforge/core').GenerationBatch> {
        for await (const batch of batches) {
          const now = performance.now();
          if (!benchmarkData.tableTimes[batch.table]) {
            benchmarkData.tableTimes[batch.table] = {
              start: now,
              firstBatchEnd: now,
              lastBatchEnd: now,
              rows: 0,
            };
          }
          const tt = benchmarkData.tableTimes[batch.table]!;
          tt.lastBatchEnd = now;
          if (!tt.firstBatchEnd) tt.firstBatchEnd = now;
          tt.rows += batch.rows.length;
          yield batch;
        }
      }

      const genOpts: import('@seedforge/core').GenerateOptions = { plugins: pluginResult.plugins };
      if (opts.batchSize) genOpts.batchSize = opts.batchSize;
      const batches = opts.parallel
        ? generateFilteredParallel(graph, plan, schema, seed, tablesFilter, genOpts)
        : generateFiltered(graph, plan, schema, seed, tablesFilter, genOpts);
      const trackedBatches = opts.benchmark ? withBenchmarkTracking(batches) : batches;
      const result = await writeFn(writeConfig, trackedBatches, graph, schema, {
        mode,
        batchSize: opts.batchSize,
        progressEmitter,
      });

      const elapsedMs = performance.now() - benchmarkData.startTime;

      // Stop any remaining spinners
      for (const [table, spinner] of Object.entries(spinners)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (spinner.isSpinning) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          spinner.succeed(`${table}: ${result.rowsWritten[table] ?? 0} rows`);
        }
      }

      console.log('');

      // Write lockfile
      await createLockfile(config, schema, seed, '0.1.0', result.rowsWritten);

      // Benchmark report
      if (opts.benchmark) {
        const endRss = process.memoryUsage().rss;
        const peakRss = Math.max(startRss, endRss);
        const rssMb = ((peakRss - startRss) / 1024 / 1024).toFixed(1);
        printHeading('Benchmark Results');
        const totalRows = Object.values(result.rowsWritten).reduce((a: number, b: number) => a + b, 0);
        const totalMs = result.elapsedMs || Math.ceil(elapsedMs);
        console.log('');
        console.log(`  Mode: ${opts.parallel ? 'parallel (worker_threads)' : 'sequential'}  |  Batch size: ${opts.batchSize ?? 'default'}  |  Peak RSS delta: ${rssMb} MB`);
        console.log('');
        // Table header
        console.log('  Table'.padEnd(24) + 'Rows'.padStart(10) + 'Time (ms)'.padStart(12) + 'Rows/s'.padStart(14));
        console.log('  ' + '─'.repeat(58));
        for (const [table, count] of Object.entries(result.rowsWritten).sort()) {
          const tt = benchmarkData.tableTimes[table];
          const tableMs = tt ? Math.ceil(tt.lastBatchEnd - tt.start) : 0;
          const rowsPerSec = tableMs > 0 ? Math.round((count / tableMs) * 1000).toLocaleString() : 'N/A';
          console.log(
            `  ${table.padEnd(22)} ` +
            `${String(count).padStart(8)} ` +
            `${String(tableMs).padStart(8)} ` +
            `${String(rowsPerSec).padStart(12)}`,
          );
        }
        console.log('  ' + '─'.repeat(58));
        const totalRowsPerSec = totalMs > 0 ? Math.round((totalRows / totalMs) * 1000).toLocaleString() : 'N/A';
        console.log(
          `  ${'Total'.padEnd(22)} ` +
          `${String(totalRows).padStart(8)} ` +
          `${String(totalMs).padStart(8)} ` +
          `${String(totalRowsPerSec).padStart(12)}`,
        );
        console.log('');
      } else {
        printSuccess(`Seed complete — ${Object.keys(result.rowsWritten).length} tables, ${Object.values(result.rowsWritten).reduce((a: number, b: number) => a + b, 0)} total rows (${result.elapsedMs}ms)`);
      }

      // Optional verification
      if (opts.verify) {
        printInfo('Running post-write verification...');
        const rowsByTable: Record<string, Record<string, unknown>[]> = {};
        const vGenOpts: import('@seedforge/core').GenerateOptions = {};
        if (opts.batchSize) vGenOpts.batchSize = opts.batchSize;
        for await (const batch of generateFiltered(graph, plan, schema, seed, tablesFilter, vGenOpts)) {
          if (!rowsByTable[batch.table]) rowsByTable[batch.table] = [];
          rowsByTable[batch.table].push(...batch.rows);
        }
        const verifyResult = verifyPostWrite(plan, schema, rowsByTable);
        if (verifyResult.valid) {
          printSuccess('Verification passed');
        } else {
          printError(`Verification failed — ${verifyResult.entries.filter((e: { status: string }) => e.status === 'fail').length} issues`);
          console.log(renderValidationTable(verifyResult.entries));
        }
      }
    }
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }
}

async function* generateFiltered(
  graph: import('@seedforge/core').RelationshipGraph,
  plan: import('@seedforge/core').GenerationPlan,
  schema: import('@seedforge/core').DatabaseSchema,
  seed: number,
  tablesFilter: string[] | null,
  genOpts?: import('@seedforge/core').GenerateOptions,
): AsyncIterable<import('@seedforge/core').GenerationBatch> {
  for await (const batch of generate(graph, plan, schema, seed, genOpts)) {
    if (tablesFilter && !tablesFilter.includes(batch.table)) continue;
    yield batch;
  }
}

async function* generateFilteredParallel(
  graph: import('@seedforge/core').RelationshipGraph,
  plan: import('@seedforge/core').GenerationPlan,
  schema: import('@seedforge/core').DatabaseSchema,
  seed: number,
  tablesFilter: string[] | null,
  genOpts?: import('@seedforge/core').GenerateOptions,
): AsyncIterable<import('@seedforge/core').GenerationBatch> {
  const { generateParallel } = await import('@seedforge/core');
  for await (const batch of generateParallel(graph, plan, schema, seed, genOpts)) {
    if (tablesFilter && !tablesFilter.includes(batch.table)) continue;
    yield batch;
  }
}