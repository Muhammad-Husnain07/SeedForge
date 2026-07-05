export { computeConfigHash } from './configHash.js';
export { diffSchemas } from './diff.js';
export { checkDrift, createLockfile, acknowledgeDrift, SchemaDriftError } from './drift.js';
export { readLockfile, writeLockfile, resolveLockfilePath } from './io.js';
export type {
  SeedForgeLockfile,
  SchemaDiff,
  SchemaDiffEntry,
  SchemaDiffEntryType,
  DriftResult,
} from './types.js';
