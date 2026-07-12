export const name = '@seed-forge/core';

export type {
  LogicalType,
  ColumnSchema,
  ForeignKey,
  TableSchema,
  DatabaseSchema,
} from './types/index.js';

export {
  introspect,
  computeSchemaHash,
  registerIntrospector,
} from './introspect.js';
export type { ConnectConfig, Introspector } from './introspect.js';

export { buildGraph } from './graph/index.js';
export type { BuildGraphOptions } from './graph/index.js';
export type { RelationshipEdge, RelationshipGraph, MongoInferredRelationship } from './graph/index.js';

export { analyzeSchema, printCoverageTable } from './semantic/index.js';
export type { FieldSemanticMatch, GeneratorSpec, AnalyzeSchemaOptions } from './semantic/index.js';

export {
  mulberry32,
  hashToSeed,
  deriveStream,
  uniformInt,
  uniformReal,
  weightedCategorical,
  paretoInt,
  normal,
  exponential,
  zipf,
  recencyWeighted,
  assignPersona,
} from './distributions/index.js';
export type { PRNG } from './distributions/index.js';
export type { Persona, PersonaSet, PersonaOverride } from './distributions/index.js';

export { defineConfig, buildGenerationPlan, validateConfig } from './config/index.js';
export type { SeedForgeConfig, ConnectionConfig, TableConfig, FieldConfig, GenerationPlan, ResolvedField, ValidationIssue, TimelineConfig, GrowthModel, SeasonalityConfig, ChurnConfig, ParentTimelineCtx } from './config/index.js';

export { validatePreFlight, verifyPostWrite } from './validate/index.js';
export type { PreFlightResult, PostWriteResult, ValidationEntry, PreFlightOptions, VerifyOptions } from './validate/index.js';

export { generate, generateParallel, generateFieldValue } from './generate/index.js';
export type { GenerateOptions, GenerationBatch } from './generate/index.js';
export { GenerationError } from './generate/index.js';

export type { WriteMode, WriteProgressEvent, WriteOptions, WriteResult, BatchWriter } from './writer/index.js';
export { WriteProgressEmitter } from './writer/index.js';

export {
  computeConfigHash,
  diffSchemas,
  checkDrift,
  createLockfile,
  acknowledgeDrift,
  SchemaDriftError,
  readLockfile,
  writeLockfile,
  resolveLockfilePath,
} from './lockfile/index.js';
export type {
  SeedForgeLockfile,
  SchemaDiff,
  SchemaDiffEntry,
  SchemaDiffEntryType,
  DriftResult,
} from './lockfile/index.js';

export {
  exportBundle,
  readBundle,
  readConfigJson,
  readLockfileJson,
  readSnapshotData,
  cleanupBundle,
  checkImportCompatibility,
  importBundle,
} from './bundle/index.js';
export type {
  BundleManifest,
  ExportOptions,
  ImportOptions,
  ImportResult,
} from './bundle/index.js';

export {
  registerGenerator,
  getGenerator,
  generatorRegistry,
  loadPlugins,
  scanAvailablePlugins,
  callPluginHook,
} from './plugin/index.js';
export type {
  SeedForgePlugin,
  GeneratorRegistry,
  FieldGenerator,
  FieldContext,
  LoadedPlugin,
  PluginLoaderResult,
} from './plugin/index.js';
