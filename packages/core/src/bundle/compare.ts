import type { BundleManifest } from './types.js';

export interface LiveSchemaTable {
  name: string;
  columns: Array<{ name: string }>;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  blocks: string[];
  schemaMatch: boolean;
}

export function checkImportCompatibility(
  manifest: BundleManifest,
  liveSchemaHash: string,
  liveTables: LiveSchemaTable[],
): CompatibilityResult {
  const warnings: string[] = [];
  const blocks: string[] = [];

  const schemaMatch = manifest.schemaHash === liveSchemaHash;

  if (!schemaMatch) {
    warnings.push(
      `Schema hash mismatch: bundle recorded ${manifest.schemaHash.slice(0, 12)}…, ` +
        `live database is ${liveSchemaHash.slice(0, 12)}…`,
    );
  }

  const liveTableNames = new Set(liveTables.map((t) => t.name));

  for (const tableName of Object.keys(manifest.perTableRowCounts)) {
    if (!liveTableNames.has(tableName)) {
      blocks.push(
        `Table '${tableName}' is required by the bundle but does not exist in the target database.`,
      );
    }
  }

  if (!schemaMatch && blocks.length === 0) {
    warnings.push(
      'Schema hash differs but all required tables exist. Use --force to import anyway.',
    );
  }

  const compatible = blocks.length === 0;

  return { compatible, warnings, blocks, schemaMatch };
}
