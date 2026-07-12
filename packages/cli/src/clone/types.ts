import type { GeneratorSpec } from '@seed-forge/core';

export type AnonymizeStrategy = 'keep' | 'replace';

export interface AnonymizedColumn {
  table: string;
  column: string;
  strategy: AnonymizeStrategy;
  semanticType: string;
  generator?: GeneratorSpec;
}

export interface AnonymizedRow {
  table: string;
  original: Record<string, unknown>;
  anonymized: Record<string, unknown>;
}

export interface CloneTableSummary {
  table: string;
  totalRows: number;
  replacedColumns: number;
  keptColumns: number;
  columns: AnonymizedColumn[];
}

export interface CloneSummary {
  tables: CloneTableSummary[];
  totalRows: number;
  outputDir: string;
}

export interface CloneOptions {
  sourceConnection: string;
  dialect: string;
  database?: string;
  anonymize: boolean;
  iUnderstandTheRisk?: boolean;
  outputDir: string;
  maxRowsPerTable?: number;
}

export type SampleFunction = (
  config: Record<string, unknown>,
  tableName: string,
  maxRows?: number,
) => Promise<Record<string, unknown>[]>;
