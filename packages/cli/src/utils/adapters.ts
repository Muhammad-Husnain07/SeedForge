import { registerIntrospector } from '@seed-forge/core';
import type {
  RelationshipGraph,
  DatabaseSchema,
  GenerationBatch,
  WriteOptions,
  WriteResult,
} from '@seed-forge/core';
import type { SampleFunction } from '../clone/types.js';

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
    case 'sqlite': {
      const mod = await import('@seed-forge/adapter-sqlite');
      registerIntrospector('sqlite', { introspect: mod.introspect });
      break;
    }
    case 'prisma': {
      const mod = await import('@seed-forge/adapter-prisma');
      registerIntrospector('prisma', { introspect: mod.introspect });
      break;
    }
    case 'drizzle': {
      const mod = await import('@seed-forge/adapter-drizzle');
      registerIntrospector('drizzle', { introspect: mod.introspect });
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
    case 'sqlite': {
      const mod = await import('@seed-forge/adapter-sqlite');
      return mod.write;
    }
    default:
      throw new Error(`Unknown dialect: ${dialect}`);
  }
}

export async function resolveSampleFunction(
  dialect: string,
): Promise<SampleFunction> {
  switch (dialect) {
    case 'postgres': {
      const mod = await import('@seed-forge/adapter-postgres');
      return mod.sample.bind(mod) as SampleFunction;
    }
    case 'mysql': {
      const mod = await import('@seed-forge/adapter-mysql');
      return mod.sample.bind(mod) as SampleFunction;
    }
    case 'mongodb': {
      const mod = await import('@seed-forge/adapter-mongodb');
      return mod.sample.bind(mod) as SampleFunction;
    }
    case 'sqlite': {
      const mod = await import('@seed-forge/adapter-sqlite');
      return mod.sample.bind(mod) as SampleFunction;
    }
    default:
      throw new Error(`No sampler for dialect: ${dialect}`);
  }
}