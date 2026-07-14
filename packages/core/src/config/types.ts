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

export type GrowthModel =
  | { type: 'compound'; monthlyRate: number }
  | { type: 'linear'; totalGrowth: number }
  | { type: 'scurve'; inflectionPoint?: number; steepness?: number };

export type SeasonalityConfig =
  | { type: 'preset'; name: 'ecommerce-holiday' }
  | { type: 'custom'; fn?: (date: Date) => number };

export interface TimelineConfig {
  start: string;
  end?: string;
  growth: GrowthModel;
  seasonality?: SeasonalityConfig;
}

export interface ChurnConfig {
  monthlyRate: number;
}

export interface TableConfig {
  count?: number | DistributionSpec;
  timeline?: TimelineConfig;
  churn?: ChurnConfig;
  fields?: Record<string, FieldConfig>;
  countPerParent?: Record<string, number | DistributionSpec>;
  personas?: Persona[];
  overrides?: Record<string, unknown>[];
}

export interface ConnectionConfig {
  dialect: 'postgres' | 'mysql' | 'mongodb' | 'sqlite';
  source?: 'database' | 'prisma' | 'drizzle';
  schemaPath?: string;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;
  environment?: 'development' | 'staging' | 'production';
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

export interface ParentTimelineCtx {
  acquiredAt: number;
  churnedAt?: number;
}

export interface GenerationPlan {
  tables: Record<string, {
    count: number | DistributionSpec;
    timeline?: TimelineConfig;
    churn?: ChurnConfig;
    fields: ResolvedField[];
    countPerParent: Record<string, number | DistributionSpec>;
    personas: Persona[];
    overrides: Record<string, unknown>[];
  }>;
}
