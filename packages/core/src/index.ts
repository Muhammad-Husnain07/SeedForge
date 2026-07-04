export const name = '@seedforge/core';

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
