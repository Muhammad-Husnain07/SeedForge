import { registerIntrospector } from '@seed-forge/core';
import type {
  RelationshipGraph,
  DatabaseSchema,
  GenerationBatch,
  WriteOptions,
  WriteResult,
} from '@seed-forge/core';

export async function registerAdapters(dialect: string): Promise<void> {
  switch (dialect) {
    case 'postgres': {
      const mod = await import('@seed-forge/adapter-postgres');
      registerIntrospector('postgres', { introspect: mod.introspect });
      break;
    }
    case 'mysql': {
      const mod = await import('@seed-forge/adapter-mysql');
      registerIntrospector('mysql', { introspect: mod.introspect });
      break;
    }
    case 'mongodb': {
      const mod = await import('@seed-forge/adapter-mongodb');
      registerIntrospector('mongodb', { introspect: mod.introspect });
      break;
    }
  }
}

export async function getWriteFunction(dialect: string): Promise<
  (
    config: Record<string, unknown>,
    batches: AsyncIterable<GenerationBatch>,
    graph: RelationshipGraph,
    schema: DatabaseSchema,
    options?: WriteOptions,
  ) => Promise<WriteResult>
> {
  switch (dialect) {
    case 'postgres': {
      const mod = await import('@seed-forge/adapter-postgres');
      return mod.write;
    }
    case 'mysql': {
      const mod = await import('@seed-forge/adapter-mysql');
      return mod.write;
    }
    case 'mongodb': {
      const mod = await import('@seed-forge/adapter-mongodb');
      return mod.write;
    }
    default:
      throw new Error(`Unknown dialect: ${dialect}`);
  }
}