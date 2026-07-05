import type { DatabaseSchema } from '../types/index.js';

export interface SeedForgeLockfile {
  schemaHash: string;
  acknowledgedSchemaHash: string | null;
  configHash: string;
  seedValue: number;
  seedforgeVersion: string;
  generatedAt: string;
  perTableRowCounts: Record<string, number>;
  schema: Omit<DatabaseSchema, 'schemaHash'>;
}

export type SchemaDiffEntryType =
  | 'table-added'
  | 'table-removed'
  | 'column-added'
  | 'column-removed'
  | 'column-type-changed'
  | 'column-nullability-changed'
  | 'constraint-added'
  | 'constraint-removed'
  | 'constraint-changed';

export interface SchemaDiffEntry {
  type: SchemaDiffEntryType;
  table: string;
  column?: string;
  detail: string;
}

export interface SchemaDiff {
  hasDrift: boolean;
  entries: SchemaDiffEntry[];
  formatted: string;
}

export interface DriftResult {
  canProceed: boolean;
  diff: SchemaDiff | null;
  lockfileHash: string | null;
  liveHash: string;
  acknowledgedHash: string | null;
}
