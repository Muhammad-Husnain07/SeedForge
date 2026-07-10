import fs from 'node:fs/promises';
import { introspect } from '@seed-forge/core';
import type { ConnectConfig } from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, printHeading } from '../utils/format.js';

export async function introspectCommand(opts: { config?: string; out?: string; source?: string; schema?: string }): Promise<void> {
  try {
    let connectConfig: ConnectConfig;
    if (opts.source === 'prisma' || opts.source === 'drizzle') {
      connectConfig = { dialect: opts.source, schemaPath: opts.schema ?? 'schema.prisma' };
    } else if (opts.source) {
      const config = await loadConfig(opts.config);
      connectConfig = { ...inferConnectConfig(config), dialect: opts.source } as ConnectConfig;
    } else {
      const config = await loadConfig(opts.config);
      connectConfig = inferConnectConfig(config);
    }
    await registerAdapters(connectConfig.dialect);
    const schema = await introspect(connectConfig);

    if (opts.out) {
      await fs.writeFile(opts.out, JSON.stringify(schema, null, 2), 'utf-8');
      printSuccess(`Schema written to ${opts.out}`);
      return;
    }

    if (isJsonMode()) {
      printJson(schema);
      return;
    }

    const sourceLabel = connectConfig.dialect === 'prisma' || connectConfig.dialect === 'drizzle'
      ? `${connectConfig.dialect} (${(connectConfig as { schemaPath?: string }).schemaPath ?? 'schema'})`
      : connectConfig.dialect;
    printHeading(`Source: ${sourceLabel}`);
    printHeading(`Schema Hash: ${schema.schemaHash}`);
    console.log('');

    for (const table of schema.tables) {
      console.log(`  ${table.name} (${table.columns.length} columns)`);
      for (const col of table.columns) {
        const extras = [
          col.isPrimaryKey ? 'PK' : '',
          col.isUnique ? 'UQ' : '',
          col.nullable ? '' : 'NN',
          col.enumValues ? `enum[${col.enumValues.length}]` : '',
        ].filter(Boolean).join(' ');
        console.log(`    ${col.name}: ${col.logicalType} (${col.nativeType})${extras ? ' ' + extras : ''}`);
      }
      if (table.foreignKeys?.length) {
        for (const fk of table.foreignKeys) {
          const fromCols = fk.columns.join(', ');
          const toCols = fk.referencedColumns.join(', ');
          console.log(`    └─ FK ${fromCols} → ${fk.referencedTable}(${toCols})`);
        }
      }
      console.log('');
    }
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }
}