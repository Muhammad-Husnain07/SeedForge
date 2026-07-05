import type { GeneratorSpec } from '../semantic/types.js';
import type { Persona } from '../distributions/persona.js';

export interface DistributionSpec {
  kind: string;
  params: Record<string, unknown>;
}

export interface SeedContext {
  rootSeed: number;
  table: string;
  column: string;
  rowIndex: number;
  relatedRows?: Record<string, Record<string, unknown>[]>;
  [key: string]: unknown;
}

export interface DerivedField {
  fn: (row: Record<string, unknown>, ctx: SeedContext) => unknown;
}

export type FieldConfig = GeneratorSpec | DistributionSpec | DerivedField;

export interface TableConfig {
  count?: number | DistributionSpec;
  fields?: Record<string, FieldConfig>;
  countPerParent?: Record<string, number | DistributionSpec>;
  personas?: Persona[];
  overrides?: Record<string, unknown>[];
}

export interface ConnectionConfig {
  dialect: 'postgres' | 'mysql' | 'mongodb';
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;
}

export interface SeedForgeConfig {
  connection: ConnectionConfig;
  tables: Record<string, TableConfig>;
  plugins?: (string | { name: string; options?: Record<string, unknown> })[];
}

export interface ResolvedField {
  table: string;
  column: string;
  source: 'config' | 'inferred';
  generator: GeneratorSpec;
  confidence: number;
}

export interface GenerationPlan {
  tables: Record<string, {
    count: number | DistributionSpec;
    fields: ResolvedField[];
    countPerParent: Record<string, number | DistributionSpec>;
    personas: Persona[];
    overrides: Record<string, unknown>[];
  }>;
}
