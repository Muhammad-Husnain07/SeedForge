#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  exportBundle,
  importBundle,
  readBundle,
  readConfigJson,
  readLockfileJson,
  cleanupBundle,
  readLockfile,
  writeLockfile,
  checkDrift,
  SchemaDriftError,
  introspect,
  computeSchemaHash,
  registerIntrospector,
  analyzeSchema,
} from '@seedforge/core';
import type { BundleManifest, SeedForgeLockfile, FieldSemanticMatch } from '@seedforge/core';
import { suggest as runSuggest } from './suggest/index.js';
import { initCommand } from './commands/init.js';
import { introspectCommand } from './commands/introspect.js';
import { validateCommand } from './commands/validate.js';
import { generateCommand } from './commands/generate.js';
import { seedCommand } from './commands/seed.js';
import { resetCommand } from './commands/reset.js';
import { doctorCommand } from './commands/doctor.js';
import { loadConfig, inferConnectConfig } from './utils/config.js';
import { registerAdapters } from './utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, printInfo, printWarning, renderDiffTable } from './utils/format.js';

const program = new Command();

program
  .name('seedforge')
  .description('Deterministic seed data generator for relational databases')
  .version('0.1.0')
  .option('--json', 'machine-readable JSON output (for scripting/CI)');

// ─── init ──────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Scaffold a new seedforge.config.ts via interactive wizard')
  .option('-c, --config <path>', 'config output path', 'seedforge.config.ts')
  .option('--force', 'overwrite existing config without confirmation')
  .action(async (opts) => {
    try {
      await initCommand(opts);
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  });

// ─── introspect ────────────────────────────────────────────────────────

program
  .command('introspect')
  .description('Print or save the full DatabaseSchema from the live database')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('--out <file>', 'write schema JSON to file')
  .action(async (opts: Record<string, unknown>) => {
    await introspectCommand(opts as { config?: string; out?: string });
  });

// ─── validate ──────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Run pre-flight validation checks against the config and database')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .action(async (opts) => {
    await validateCommand(opts);
  });

// ─── suggest ──────────────────────────────────────────────────────────

program
  .command('suggest')
  .description(
    'Use AI to propose config for unresolved columns. ' +
    'By default only schema metadata is sent (safe). ' +
    'Use --include-samples to include sample values (may include PII).',
  )
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('-o, --output <path>', 'write suggestions to a .suggested.ts file instead of printing')
  .option(
    '--include-samples',
    'WARNING: include sample distinct values from the database. ' +
    'This may include real user PII. Only use on databases you own.',
  )
  .option('--provider <name>', 'LLM provider: anthropic, openai, google, deepseek, xai, openrouter, ollama')
  .option('--model <name>', 'model name override (defaults to provider-appropriate model)')
  .option('--tables <names...>', 'only suggest for these tables')
  .option('--dry-run', 'print what would be sent to the LLM without calling it')
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);

      await registerAdapters(connectConfig.dialect);
      const schema = await introspect(connectConfig as Parameters<typeof introspect>[0]);

      const matches = analyzeSchema(schema);

      const unresolved = matches.filter(
        (m: FieldSemanticMatch) => m.source === 'unresolved',
      );

      if (unresolved.length === 0) {
        if (isJsonMode()) {
          printJson({ suggestions: [], message: 'All columns resolved' });
        } else {
          printSuccess('All columns have resolved generators. Nothing to suggest.');
        }
        process.exit(0);
      }

      if (!isJsonMode()) {
        printInfo(`Found ${unresolved.length} unresolved column(s).`);
      }

      const tableMap = new Map<string, typeof schema.tables[0]>(
        schema.tables.map((t) => [t.name, t]),
      );

      const unresolvedCols = unresolved.map((m: FieldSemanticMatch) => {
        const table = tableMap.get(m.table);
        const colDef = table?.columns.find((c) => c.name === m.column);
        const siblings = table?.columns
          .filter((c) => c.name !== m.column)
          .map((c) => c.name) ?? [];

        return {
          table: m.table,
          column: m.column,
          logicalType: colDef?.logicalType ?? 'string',
          nativeType: colDef?.nativeType ?? 'varchar',
          nullable: colDef?.nullable ?? true,
          isUnique: colDef?.isUnique ?? false,
          isPrimaryKey: colDef?.isPrimaryKey ?? false,
          enumValues: colDef?.enumValues,
          maxLength: colDef?.maxLength,
          comment: colDef?.comment,
          siblingColumns: siblings,
        };
      });

      if (opts.dryRun) {
        if (isJsonMode()) {
          printJson({
            dryRun: true,
            unresolved: unresolvedCols,
            provider: opts.provider ?? 'anthropic (default)',
            model: opts.model ?? '(provider default)',
            includeSamples: !!opts.includeSamples,
          });
        } else {
          console.log('\n── DRY RUN — Would send to LLM ──\n');
          for (const col of unresolvedCols) {
            console.log(`  ${col.table}.${col.column}:`);
            console.log(`    type: ${col.logicalType} (${col.nativeType})`);
            console.log(`    nullable: ${col.nullable}, unique: ${col.isUnique}`);
            if (col.enumValues?.length) console.log(`    enum: [${col.enumValues.join(', ')}]`);
            if (col.maxLength) console.log(`    maxLength: ${col.maxLength}`);
            console.log(`    siblings: [${col.siblingColumns.join(', ')}]`);
            console.log('');
          }
          console.log('Provider:', opts.provider ?? 'anthropic (default)');
          console.log('Model:', opts.model ?? '(provider default)');
          console.log('Include samples:', !!opts.includeSamples);
        }
        process.exit(0);
      }

      let samples: Record<string, string[]> | undefined;
      if (opts.includeSamples) {
        if (!isJsonMode()) {
          printWarning(
            '--include-samples may include real user PII from the database. ' +
            'Only use on databases you own or have explicit permission to query.',
          );
        }
        // Sample collection requires adapter query support — stub for now
        printWarning('Sample collection requires database adapter support. Returning schema-only context.');
      }

      const providerName = opts.provider ?? process.env.SEEDFORGE_LLM_PROVIDER ?? 'anthropic';
      const modelName = opts.model ?? process.env.SEEDFORGE_LLM_MODEL;

      const providerConfig: { provider: string; model?: string } = { provider: providerName };
      if (modelName) providerConfig.model = modelName;

      const result = await runSuggest({
        unresolved: unresolvedCols,
        includeSamples: !!opts.includeSamples,
        samples,
        provider: providerConfig as Parameters<typeof runSuggest>[0]['provider'],
        tablesOptedIn: opts.tables,
      });

      if (result.suggestions.length === 0) {
        if (isJsonMode()) {
          printJson({ suggestions: [] });
        } else {
          printInfo('No suggestions were generated.');
        }
        process.exit(0);
      }

      if (isJsonMode()) {
        printJson(result);
        process.exit(0);
      }

      // Build suggested config text
      const suggestedLines: string[] = [
        '// seedforge.config.suggested.ts',
        '// Generated by `seedforge suggest` — review and merge manually.',
        '// The LLM is ONLY consulted at suggest-time. Generate/seed NEVER calls the LLM.',
        '// ⚠  Do NOT import this file directly. Copy relevant parts into your config.',
        '',
        "import { defineConfig } from '@seedforge/core';",
        '',
        'export default defineConfig({',
        '  // ... your existing config ...',
        '  tables: {',
      ];

      const byTable: Record<string, typeof result.suggestions> = {};
      for (const s of result.suggestions) {
        if (!byTable[s.table]) byTable[s.table] = [];
        byTable[s.table]!.push(s);
      }

      for (const [tableName, cols] of Object.entries(byTable)) {
        suggestedLines.push(`    ${tableName}: {`);
        suggestedLines.push(`      fields: {`);
        for (const s of cols) {
          const paramsStr = JSON.stringify(s.generatorSpec.params, null, 6)
            .replace(/\n/g, '\n        ');
          suggestedLines.push(`        ${s.column}: {`);
          suggestedLines.push(`          kind: '${s.generatorSpec.kind}',`);
          suggestedLines.push(`          params: ${paramsStr},`);
          suggestedLines.push('        },');
        }
        suggestedLines.push('      },');
        suggestedLines.push('    },');
      }

      suggestedLines.push('  },');
      suggestedLines.push('});');
      suggestedLines.push('');

      if (opts.output) {
        await fs.writeFile(opts.output, suggestedLines.join('\n'), 'utf-8');
        printSuccess(`Suggestions written to ${opts.output}`);
        printInfo('Review the file and merge relevant parts into your config manually.');
      } else {
        console.log('\n── Suggested Config Additions ──\n');
        console.log(suggestedLines.join('\n'));
        console.log('\n── End of Suggestions ──\n');

        for (const s of result.suggestions) {
          const confidencePct = Math.round(s.confidence * 100);
          console.log(`  ${s.table}.${s.column}: ${s.semanticType} (${confidencePct}% confidence)`);
          console.log(`    → ${s.reasoning}`);
          console.log('');
        }
      }
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  });

// ─── generate --preview ──────────────────────────────────────────────

program
  .command('generate')
  .description('Generate seed data. Use --preview <n> for a dry run without writing to the database.')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('--seed <value>', 'seed value for deterministic generation')
  .option('--preview <n>', 'print n sample rows per table without writing to database')
  .action(async (opts) => {
    if (opts.preview) {
      await generateCommand(opts);
    } else {
      if (isJsonMode()) {
        printJson({ error: true, message: 'Use --preview <n> for dry-run, or `seedforge seed` for actual writing.' });
      } else {
        printError('Use `seedforge generate --preview <n>` for a dry run, or `seedforge seed` to write to the database.');
      }
      process.exit(1);
    }
  });

// ─── seed ──────────────────────────────────────────────────────────────

program
  .command('seed')
  .description('Generate and write seed data to the database')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('--seed <value>', 'seed value override (default: derived from schema hash)')
  .option('--mode <mode>', 'write mode: fresh | truncate | append', 'fresh')
  .option('--tables <tables>', 'comma-separated list of tables to seed')
  .option('--batch-size <n>', 'rows per batch (default: 5000 postgres/mongo, 1000 mysql)', parseInt)
  .option('--parallel', 'use worker_threads for parallel per-level generation')
  .option('--count <n>', 'target total rows (scales config proportionally)', parseInt)
  .option('--verify', 'run post-write verification checks')
  .option('--benchmark', 'print per-table timing and throughput report')
  .action(async (opts) => {
    await seedCommand(opts);
  });

// ─── reset ─────────────────────────────────────────────────────────────

program
  .command('reset')
  .description('Truncate all tables and reseed using the last-used config and seed from the lockfile')
  .action(async () => {
    await resetCommand({});
  });

// ─── diff ─────────────────────────────────────────────────────────────

program
  .command('diff')
  .description('Check for schema drift between lockfile and live database (CI gate)')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('-l, --lockfile <path>', 'path to lockfile')
  .action(async (opts) => {
    try {
      const lockfilePath = opts.lockfile;
      const lockfile = await readLockfile(lockfilePath);

      if (!lockfile) {
        if (isJsonMode()) {
          printJson({ error: true, message: 'No lockfile found. Run seed generation first.' });
        } else {
          printError('No lockfile found. Run seed generation first.');
        }
        process.exit(1);
      }

      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);

      // Fall back to lockfile schema dialect if config has no connection
      const lf = lockfile as unknown as Record<string, unknown>;
      if (!connectConfig.dialect && lf.schema) {
        (connectConfig as Record<string, string | undefined>).dialect = (lf.schema as Record<string, string | undefined>).dialect;
      }

      await registerAdapters(connectConfig.dialect);
      const schema = await introspect(connectConfig as Parameters<typeof introspect>[0]);

      const result = await checkDrift(config, schema, { lockfilePath, force: false });

      if (isJsonMode()) {
        printJson(result);
        return;
      }

      if (result.canProceed && !result.diff) {
        printSuccess('No schema drift detected.');
        process.exit(0);
      } else if (result.canProceed && result.diff) {
        console.log(renderDiffTable(result.diff.entries));
        console.log('');
        printInfo('Proceeding with --force (acknowledged or forced).');
        process.exit(0);
      } else {
        console.log(renderDiffTable(result.diff!.entries));
        console.log('');
        printError('Schema drift detected. Use --force to proceed, or acknowledge the drift.');
        process.exit(1);
      }
    } catch (err) {
      printError(`Diff check failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── export ───────────────────────────────────────────────────────────

program
  .command('export')
  .description('Package config, lockfile, and optional data snapshot into a .sfbundle archive')
  .requiredOption('-o, --out <file>', 'output .sfbundle file')
  .option('--snapshot', 'include compressed data snapshot for byte-identical restore')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('-l, --lockfile <path>', 'path to lockfile')
  .action(async (opts) => {
    try {
      const lockfilePath = opts.lockfile;
      const lockfile = await readLockfile(lockfilePath);

      if (!lockfile) {
        if (isJsonMode()) {
          printJson({ error: true, message: 'No lockfile found. Run seed generation first.' });
        } else {
          printError('No lockfile found. Run seed generation first to create a lockfile.');
        }
        process.exit(1);
      }

      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);

      let tableData: Record<string, Record<string, unknown>[]> | undefined;
      let perTableRowCounts = lockfile.perTableRowCounts;

      if (opts.snapshot) {
        await registerAdapters(connectConfig.dialect);
        // Snapshot requires adapter-level read support — throw for now
        throw new Error('Snapshot export requires database read support. Use export without --snapshot for a replay-only bundle.');
      }

      const bundlePath = await exportBundle({
        out: opts.out,
        snapshot: !!opts.snapshot,
        config: { connection: connectConfig, tables: config.tables ?? {} },
        lockfile: {
          schemaHash: lockfile.schemaHash,
          acknowledgedSchemaHash: lockfile.acknowledgedSchemaHash,
          configHash: lockfile.configHash,
          seedValue: lockfile.seedValue,
          seedforgeVersion: lockfile.seedforgeVersion,
          generatedAt: lockfile.generatedAt,
          perTableRowCounts,
        },
        tableData,
      });

      if (isJsonMode()) {
        printJson({ bundlePath, snapshot: !!opts.snapshot, perTableRowCounts });
      } else {
        printSuccess(`Exported to ${bundlePath}`);
        if (opts.snapshot) {
          printInfo(`Snapshot includes data for ${Object.keys(perTableRowCounts).length} tables`);
        } else {
          printInfo('No snapshot — import will replay generation from seed');
        }
      }
    } catch (err) {
      printError(`Export failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── import ───────────────────────────────────────────────────────────

program
  .command('import')
  .description('Import a .sfbundle archive into the target database')
  .argument('<file>', '.sfbundle file to import')
  .option('--force', 'skip schema mismatch warning')
  .option('-c, --config <path>', 'path to config file (for replay generation)', 'seedforge.config.ts')
  .action(async (file, opts) => {
    let manifest: BundleManifest | null = null;

    try {
      const { tmpDir, manifest: m } = await readBundle(file);
      manifest = m;

      if (!isJsonMode()) {
        console.log('\n── Bundle Manifest ──');
        console.log(`  Version:      ${manifest.seedforgeVersion}`);
        console.log(`  Created:      ${manifest.createdAt}`);
        console.log(`  Created by:   ${manifest.createdBy}`);
        console.log(`  Schema hash:  ${manifest.schemaHash.slice(0, 16)}…`);
        console.log(`  Seed value:   ${manifest.seedValue}`);
        console.log(`  Has snapshot: ${manifest.hasSnapshot}`);
        console.log(`  Total rows:   ${manifest.totalRows}`);
        for (const [table, count] of Object.entries(manifest.perTableRowCounts)) {
          console.log(`    ${table}: ${count} rows`);
        }
        console.log('');
      }

      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);

      await registerAdapters(connectConfig.dialect);

      const result = await importBundle({
        file,
        force: !!opts.force,
        introspect: async () => {
          const liveSchema = await introspect(connectConfig as Parameters<typeof introspect>[0]);
          return {
            schemaHash: liveSchema.schemaHash,
            tables: liveSchema.tables.map((t) => ({
              name: t.name,
              columns: t.columns.map((c) => ({ name: c.name })),
            })),
          };
        },
        writeRows: async (table, rows) => {
          if (!isJsonMode()) console.log(`  Writing ${rows.length} rows to ${table}…`);
          return rows.length;
        },
        replayGeneration: async (_bundleConfig, _seed, _writeBatch) => {
          // In production, this would use generate() + adapter write
          // Stubbed for now
        },
      });

      if (result.blocked) {
        printError(`Import blocked: ${result.blockedReason}`);
        process.exit(1);
      }

      if (isJsonMode()) {
        printJson(result);
      } else {
        printSuccess('Import completed successfully.');
        for (const [table, count] of Object.entries(result.rowsImported)) {
          console.log(`  ${table}: ${count} rows`);
        }
      }

      await cleanupBundle(tmpDir);
    } catch (err) {
      printError(`Import failed: ${(err as Error).message}`);
      if (manifest) {
        // Try to clean up temp dir
      }
      process.exit(1);
    }
  });

// ─── studio ──────────────────────────────────────────────────────────

program
  .command('studio')
  .description('Launch the local web studio dashboard (Fastify + React)')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .option('-p, --port <n>', 'port to bind', parseInt, 3456)
  .action(async (opts) => {
    try {
      // Dynamic import avoids node_modules dependency at CLI install time
      const startStudio: (opts: { configPath?: string; port?: number }) => Promise<void> =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (await import('@seedforge/studio')).startStudio;
      await startStudio({ configPath: opts.config, port: opts.port });
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  });

// ─── doctor ──────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Sanity-check the environment: config, database connection, and lockfile')
  .option('-c, --config <path>', 'path to config file', 'seedforge.config.ts')
  .action(async (opts) => {
    await doctorCommand(opts);
  });

// ─── Main ─────────────────────────────────────────────────────────────

if (!process.env.VITEST) {
  program.parse(process.argv);
}

export { program };