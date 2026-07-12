export interface GeneratorSpec {
  kind: string;
  params: Record<string, unknown>;
}

export interface ColumnSuggestion {
  table: string;
  column: string;
  semanticType: string;
  generatorSpec: GeneratorSpec;
  confidence: number;
  reasoning: string;
}

export interface PersonaSuggestion {
  name: string;
  selectionWeight: number;
  overrides: string[];
  cascades?: Record<string, number>;
}

export interface TableSuggestion {
  table: string;
  statusDistributions?: Record<string, number>;
  personaSuggestions?: PersonaSuggestion[];
  reasoning: string;
}

export interface SuggestResponse {
  suggestions: ColumnSuggestion[];
  tableSuggestions?: TableSuggestion[];
}

export interface UnresolvedColumn {
  table: string;
  column: string;
  logicalType: string;
  nativeType: string;
  nullable: boolean;
  isUnique: boolean;
  isPrimaryKey: boolean;
  enumValues?: string[];
  maxLength?: number;
  comment?: string;
  siblingColumns: string[];
}

export interface SuggestOptions {
  unresolved: UnresolvedColumn[];
  tablesOptedIn?: string[];
  includeSamples?: boolean;
  samples?: Record<string, string[]>;
  provider?: ProviderConfig;
}

export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'openrouter'
  | 'ollama';

export interface ProviderConfig {
  provider: ProviderName;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
}

export interface ConfigDraftGrowth {
  type: 'compound' | 'linear' | 'scurve';
  monthlyRate?: number;
  totalGrowth?: number;
  inflectionPoint?: number;
  steepness?: number;
}

export interface ConfigDraftTimeline {
  start: string;
  end?: string;
  growth: ConfigDraftGrowth;
  seasonality?: { type: 'preset'; name: 'ecommerce-holiday' };
}

export interface ConfigDraftChurn {
  monthlyRate: number;
}

export interface ConfigDraftTable {
  count?: number;
  countPerParent?: Record<string, number>;
  timeline?: ConfigDraftTimeline;
  churn?: ConfigDraftChurn;
  personas?: PersonaSuggestion[];
}

export interface ConfigDraft {
  tables: Record<string, ConfigDraftTable>;
  reasoning: string;
}

import type { DatabaseSchema, ResolvedField, RelationshipGraph } from '@seed-forge/core';

export interface SuggestDescribeOptions {
  schema: DatabaseSchema;
  resolved: ResolvedField[];
  graph: RelationshipGraph;
  description: string;
  provider?: ProviderConfig;
}

export class SuggestError extends Error {
  public readonly code: string;
  public readonly raw?: string;

  constructor(code: string, message: string, raw?: string) {
    super(message);
    this.name = 'SuggestError';
    this.code = code;
    this.raw = raw;
  }
}
