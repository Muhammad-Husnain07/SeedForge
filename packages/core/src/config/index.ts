export { defineConfig } from './defineConfig.js';
export { buildGenerationPlan, SeedForgeConfigError } from './merge.js';
export { validateConfig } from './validate.js';
export type { ValidationIssue } from './validate.js';
export type {
  SeedForgeConfig,
  ConnectionConfig,
  TableConfig,
  FieldConfig,
  DistributionSpec,
  DerivedField,
  SeedContext,
  GenerationPlan,
  ResolvedField,
  TimelineConfig,
  GrowthModel,
  SeasonalityConfig,
  ChurnConfig,
  ParentTimelineCtx,
} from './types.js';
