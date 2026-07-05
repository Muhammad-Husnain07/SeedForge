export interface BundleManifest {
  seedforgeVersion: string;
  createdAt: string;
  createdBy: string;
  schemaHash: string;
  configHash: string;
  seedValue: number;
  perTableRowCounts: Record<string, number>;
  hasSnapshot: boolean;
  tableFiles: string[];
  totalRows: number;
}

import type { GenerationBatch } from '../generate/types.js';

export interface ExportOptions {
  out: string;
  snapshot?: boolean;
  config: { connection: unknown; tables: unknown };
  lockfile: {
    schemaHash: string;
    acknowledgedSchemaHash: string | null;
    configHash: string;
    seedValue: number;
    seedforgeVersion: string;
    generatedAt: string;
    perTableRowCounts: Record<string, number>;
  };
  /** Rows to snapshot. Accepts async iterables for streaming — one iterable per table. */
  tableData?: Record<string, Record<string, unknown>[]> | AsyncIterable<GenerationBatch>;
}

export interface ImportOptions {
  file: string;
  force?: boolean;
  introspect: () => Promise<{
    schemaHash: string;
    tables: Array<{ name: string; columns: Array<{ name: string }> }>;
  }>;
  writeRows: (table: string, rows: Record<string, unknown>[]) => Promise<number>;
  replayGeneration?: (
    config: Record<string, unknown>,
    seed: number,
    writeBatch: (table: string, rows: Record<string, unknown>[]) => Promise<number>,
  ) => Promise<void>;
}

export interface ImportResult {
  manifest: BundleManifest;
  rowsImported: Record<string, number>;
  elapsedMs: number;
  schemaMatch: boolean;
  schemaWarnings: string[];
  blocked: boolean;
  blockedReason?: string;
}
