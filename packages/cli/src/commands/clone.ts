import { introspect, registerIntrospector } from '@seed-forge/core';
import { printError, printSuccess, printInfo, printWarning } from '../utils/format.js';
import { resolveSampleFunction } from '../utils/adapters.js';
import { clone, formatCloneSummary } from '../clone/clone.js';
import type { CloneOptions } from '../clone/types.js';

export async function cloneCommand(opts: {
  source?: string;
  anonymize?: boolean;
  iUnderstandTheRisk?: boolean;
  out?: string;
  maxRows?: string;
}): Promise<void> {
  const source = opts.source;
  if (!source) {
    printError('--source connection string is required. Usage: seedforge clone --source <connection> [--anonymize]');
    process.exit(1);
  }

  const dialect = detectDialect(source);

  if (!opts.anonymize) {
    if (detectProduction(source)) {
      printError(
        'Refusing to clone from a source that appears to be a production database ' +
        'without --anonymize. If you understand the risk, add --i-understand-the-risk.',
      );
      process.exit(1);
    }
  }

  if (opts.anonymize && detectProduction(source) && !opts.iUnderstandTheRisk) {
    printWarning(
      'The source connection string appears to point to a production database. ' +
      'Use --i-understand-the-risk to acknowledge the risk and proceed.',
    );
  }

  const outputDir = opts.out ?? './anonymized';
  const maxRows = opts.maxRows ? parseInt(opts.maxRows, 10) : undefined;

  const sampleFn = await resolveSampleFunction(dialect).catch(() => {
    printError(`No sampler available for dialect '${dialect}'`);
    process.exit(1);
  }) as any;

  const adapterMod = await importAdapter(dialect);
  if (adapterMod?.introspect) {
    registerIntrospector(dialect, { introspect: adapterMod.introspect });
  }

  const connectConfig: Record<string, unknown> = {
    connectionString: source,
  };
  const schema = await introspect({ dialect, ...connectConfig });

  const cloneOptions: CloneOptions = {
    sourceConnection: source,
    dialect,
    anonymize: !!opts.anonymize,
    iUnderstandTheRisk: !!opts.iUnderstandTheRisk,
    outputDir,
    maxRowsPerTable: maxRows,
  };

  const summary = await clone(cloneOptions, sampleFn, schema);

  console.log(formatCloneSummary(summary));
  printSuccess(`Clone completed. Data written to ${outputDir}`);
  printInfo('Review the anonymized data before using it.');
}

async function importAdapter(dialect: string): Promise<{ introspect?: unknown } | null> {
  try {
    switch (dialect) {
      case 'postgres': return import('@seed-forge/adapter-postgres');
      case 'mysql': return import('@seed-forge/adapter-mysql');
      case 'mongodb': return import('@seed-forge/adapter-mongodb');
      default: return null;
    }
  } catch {
    return null;
  }
}

function detectDialect(connectionString: string): string {
  if (connectionString.startsWith('postgresql://') || connectionString.startsWith('postgres://')) {
    return 'postgres';
  }
  if (connectionString.startsWith('mysql://') || connectionString.startsWith('mysql2://')) {
    return 'mysql';
  }
  if (connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://')) {
    return 'mongodb';
  }
  return 'postgres';
}

function detectProduction(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  const productionPatterns = [
    /production/i,
    /\.prod\./i,
    /prd-/i,
    /-prd\./i,
  ];
  for (const pattern of productionPatterns) {
    if (pattern.test(lower)) return true;
  }
  return false;
}
