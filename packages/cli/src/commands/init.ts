import fs from 'node:fs/promises';
import path from 'node:path';
import { introspect, analyzeSchema, registerIntrospector, printCoverageTable } from '@seed-forge/core';
import type { FieldSemanticMatch, SeedForgeConfig } from '@seed-forge/core';
import { input, select, confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import { registerAdapters } from '../utils/adapters.js';

export async function initCommand(opts: { config?: string; force?: boolean }): Promise<void> {
  const configPath = path.resolve(opts.config ?? 'seedforge.config.ts');

  // Check if config already exists
  try {
    await fs.access(configPath);
    if (!opts.force) {
      const overwrite = await confirm({
        message: `${configPath} already exists. Overwrite?`,
        default: false,
      });
      if (!overwrite) {
        console.log('Init cancelled.');
        process.exit(0);
      }
    }
  } catch {
    // Doesn't exist, that's fine
  }

  // Step 1: Check .env
  let envDbUrl: string | undefined;
  try {
    const envContent = await fs.readFile('.env', 'utf-8');
    const match = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (match) envDbUrl = match[1]!.trim();
  } catch {
    // No .env file
  }

  if (envDbUrl) {
    const useEnv = await confirm({
      message: `Found DATABASE_URL in .env. Use it?`,
      default: true,
    });
    if (!useEnv) envDbUrl = undefined;
  }

  // Step 2: Pick dialect
  const dialect = await select<'postgres' | 'mysql' | 'mongodb'>({
    message: 'Select database dialect:',
    choices: [
      { name: 'PostgreSQL', value: 'postgres' },
      { name: 'MySQL', value: 'mysql' },
      { name: 'MongoDB', value: 'mongodb' },
    ],
  });

  // Step 3: Connection string
  let connectionString = envDbUrl ?? '';
  let databaseName = '';

  if (dialect === 'mongodb') {
    connectionString = await input({
      message: 'MongoDB connection string:',
      default: connectionString || 'mongodb://localhost:27017',
      validate: (v: string) => v.length > 0 ? true : 'Connection string is required',
    });
    databaseName = await input({
      message: 'Database name:',
      default: 'seedforge',
      validate: (v: string) => v.length > 0 ? true : 'Database name is required',
    });
  } else {
    const defaultConn = connectionString ||
      (dialect === 'postgres' ? 'postgresql://localhost:5432/seedforge' :
       'mysql://root:password@localhost:3306/seedforge');
    connectionString = await input({
      message: 'Connection string:',
      default: defaultConn,
      validate: (v: string) => v.length > 0 ? true : 'Connection string is required',
    });
  }

  // Step 4: Test connection
  const testConn = await confirm({
    message: 'Test the connection?',
    default: true,
  });

  if (testConn) {
    try {
      const connectConfig = dialect === 'mongodb'
        ? { dialect, connectionString, database: databaseName }
        : { dialect, connectionString };

      if (dialect === 'postgres') {
        const mod = await import('@seed-forge/adapter-postgres');
        registerIntrospector('postgres', { introspect: mod.introspect });
      } else if (dialect === 'mysql') {
        const mod = await import('@seed-forge/adapter-mysql');
        registerIntrospector('mysql', { introspect: mod.introspect });
      } else {
        const mod = await import('@seed-forge/adapter-mongodb');
        registerIntrospector('mongodb', { introspect: mod.introspect });
      }

      const connResult = await introspect(connectConfig);
      console.log(pc.green(`✔ Connection OK — ${connResult.tables.length} tables found`));
    } catch (err) {
      console.error(pc.red(`✖ Connection failed: ${(err as Error).message}`));
      const retry = await confirm({ message: 'Try again with different connection details?', default: true });
      if (retry) return initCommand(opts); // Restart
      console.log(pc.yellow('⚠ Continuing with possibly invalid connection...'));
    }
  }

  // Step 5: Introspect + analyze
  console.log(pc.cyan('\nRunning introspection...'));

  const connectConfig = dialect === 'mongodb'
    ? { dialect, connectionString, database: databaseName }
    : { dialect, connectionString };

  await registerAdapters(dialect);
  const schema = await introspect(connectConfig);

  console.log(pc.green(`✔ Found ${schema.tables.length} tables`));

  const matches = analyzeSchema(schema);

  const resolved = matches.filter((m: FieldSemanticMatch) => m.source === 'rule');
  const unresolved = matches.filter((m: FieldSemanticMatch) => m.source === 'unresolved');

  console.log(pc.green(`✔ Analyzed ${schema.tables.reduce((a: number, t: { columns: unknown[] }) => a + t.columns.length, 0)} columns`));
  console.log(`  ${resolved.length} resolved, ${unresolved.length} unresolved`);

  // Print coverage table
  console.log('\n' + printCoverageTable(schema));

  // Step 6: Prompt for row counts
  const useDefaultCounts = await confirm({
    message: 'Use default row counts (10 per table)?',
    default: true,
  });

  // Step 7: Build config
  const tables: Record<string, Record<string, unknown>> = {};

  for (const table of schema.tables) {
    const tableMatches = matches.filter((m: FieldSemanticMatch) => m.table === table.name);
    const tableResolved = tableMatches.filter((m: FieldSemanticMatch) => m.source === 'rule');
    const tableUnresolved = tableMatches.filter((m: FieldSemanticMatch) => m.source === 'unresolved');

    const fields: Record<string, unknown> = {};

    for (const m of tableResolved) {
      fields[m.column] = {
        kind: m.suggestedGenerator.kind,
        params: m.suggestedGenerator.params,
      };
    }

    for (const m of tableUnresolved) {
      fields[m.column] = `TODO: run 'seedforge suggest' to resolve this column`;
    }

    tables[table.name] = {
      count: useDefaultCounts ? 10 : 10,
      fields,
    };
  }

  // Step 8: Write config file
  const configObj: SeedForgeConfig = {
    connection: {
      dialect,
      connectionString,
      ...(dialect === 'mongodb' ? { database: databaseName } : {}),
    },
    tables,
  };

  const configContent = generateConfigFile(configObj, unresolved);

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, configContent, 'utf-8');

  console.log(pc.green(`\n✔ Config written to ${configPath}`));
  console.log('');

  // Summary
  console.log(`  Tables:     ${schema.tables.length}`);
  console.log(`  Resolved:   ${resolved.length} columns`);
  console.log(`  Unresolved: ${unresolved.length} columns`);

  if (unresolved.length > 0) {
    console.log(pc.yellow(`\n⚠ ${unresolved.length} column(s) need your attention.`));
    console.log(pc.cyan('  Run `seedforge suggest` to let AI propose generator configs for them.'));
  }

  console.log(pc.green('\n✔ Init complete! Run `seedforge seed` to populate your database.'));
}

function generateConfigFile(config: SeedForgeConfig, _unresolved: FieldSemanticMatch[]): string {
  const lines: string[] = [];

  lines.push('// Auto-generated by `seedforge init`');
  lines.push('// Review and customize before running `seedforge seed`');
  lines.push('');
  lines.push("import { defineConfig } from '@seed-forge/core';");
  lines.push('');
  lines.push('export default defineConfig({');
  lines.push('  connection: {');
  lines.push(`    dialect: '${config.connection.dialect}',`);
  lines.push(`    connectionString: '${config.connection.connectionString}',`);
  if (config.connection.database) {
    lines.push(`    database: '${config.connection.database}',`);
  }
  lines.push('  },');
  lines.push('  tables: {');

  for (const [tableName, tableCfg] of Object.entries(config.tables)) {
    lines.push(`    ${tableName}: {`);
    lines.push(`      count: ${(tableCfg as { count: number }).count},`);
    lines.push('      fields: {');

    const fields = (tableCfg as { fields: Record<string, unknown> }).fields ?? {};
    for (const [colName, fieldCfg] of Object.entries(fields)) {
      if (typeof fieldCfg === 'string') {
        lines.push(`        ${colName}: ${fieldCfg},`);
      } else {
        const gen = fieldCfg as { kind: string; params: Record<string, unknown> };
        const paramsStr = JSON.stringify(gen.params, null, 6)
          .replace(/\n/g, '\n          ');
        lines.push(`        ${colName}: {`);
        lines.push(`          kind: '${gen.kind}',`);
        lines.push(`          params: ${paramsStr},`);
        lines.push('        },');
      }
    }

    lines.push('      },');
    lines.push('    },');
  }

  lines.push('  },');
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

export { generateConfigFile };