import fs from 'node:fs/promises';
import { introspect } from '@seedforge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { isJsonMode, printJson, printError, printSuccess, renderTable, printHeading } from '../utils/format.js';

export async function introspectCommand(opts: { config?: string; out?: string }): Promise<void> {
  try {
    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);
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

    printHeading(`Database: ${connectConfig.dialect}`);
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
          console.log(`    └─ FK ${fk.column} → ${fk.referencedTable}.${fk.referencedColumn}`);
        }
      }
      console.log('');
    }
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }
}