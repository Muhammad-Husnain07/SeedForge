import fs from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeSchema,
  generateFieldValue,
  deriveStream,
  hashToSeed,
} from '@seed-forge/core';
import type { DatabaseSchema } from '@seed-forge/core';
import { classifyColumns, anonymizeRow } from './anonymizer.js';
import type { CloneOptions, CloneSummary, CloneTableSummary, AnonymizedRow, SampleFunction } from './types.js';

export async function clone(
  options: CloneOptions,
  sampleFn: SampleFunction,
  schema: DatabaseSchema,
): Promise<CloneSummary> {
  const seed = hashToSeed(`clone-${options.sourceConnection}-${Date.now()}`);
  const connectConfig: Record<string, unknown> = {
    connectionString: options.sourceConnection,
    database: options.database,
  };
  const matches = analyzeSchema(schema);
  const classification = classifyColumns(schema, matches);

  const summaryTables: CloneTableSummary[] = [];
  let totalRows = 0;

  for (const tableSchema of schema.tables) {
    const tableName = tableSchema.name;
    const rows = await sampleFn(connectConfig, tableName, options.maxRowsPerTable);
    if (rows.length === 0) continue;

    const tableColumns = classification.columns.filter((c) => c.table === tableName);

    const anonymizedRows: AnonymizedRow[] = rows.map((row, idx) => {
      const rowPrng = deriveStream(seed, 'clone', tableName, String(idx));
      const anonymized = anonymizeRow(row, tableName, tableColumns, (generator) => {
        const fieldPrng = deriveStream(rowPrng, generator.kind);
        return generateFieldValue(
          generator,
          row,
          fieldPrng,
          new Map(),
          tableSchema,
          {} as any,
          { table: tableName, rowIndex: idx },
        );
      });
      return { table: tableName, original: row, anonymized };
    });

    const outDir = options.outputDir;
    await fs.mkdir(outDir, { recursive: true });
    const ndjson = anonymizedRows.map((r) => JSON.stringify(r.anonymized)).join('\n');
    await fs.writeFile(path.join(outDir, `${tableName}.ndjson`), ndjson, 'utf-8');

    const replacedCount = tableColumns.filter((c) => c.strategy === 'replace').length;
    const keptCount = tableColumns.filter((c) => c.strategy === 'keep').length;

    summaryTables.push({
      table: tableName,
      totalRows: anonymizedRows.length,
      replacedColumns: replacedCount,
      keptColumns: keptCount,
      columns: tableColumns,
    });
    totalRows += anonymizedRows.length;
  }

  return {
    tables: summaryTables,
    totalRows,
    outputDir: options.outputDir,
  };
}

export function formatCloneSummary(summary: CloneSummary): string {
  let output = '';
  output += '\n── Clone Summary ──\n\n';
  output += `Output directory: ${summary.outputDir}\n`;
  output += `Total rows written: ${summary.totalRows}\n\n`;

  for (const t of summary.tables) {
    output += `  ${t.table}: ${t.totalRows} rows, `;
    output += `${t.replacedColumns} replaced, ${t.keptColumns} kept\n`;
    for (const c of t.columns) {
      const icon = c.strategy === 'replace' ? '✎' : '·';
      output += `    ${icon} ${c.column}: ${c.strategy} (${c.semanticType})\n`;
    }
    output += '\n';
  }

  return output;
}
