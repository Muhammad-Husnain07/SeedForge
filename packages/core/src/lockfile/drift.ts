import type { DatabaseSchema } from '../types/index.js';
import { computeSchemaHash } from '../introspect.js';
import { computeConfigHash } from './configHash.js';
import { diffSchemas } from './diff.js';
import { readLockfile, writeLockfile } from './io.js';
import type { SeedForgeLockfile, DriftResult } from './types.js';
import type { SeedForgeConfig } from '../config/types.js';

export class SchemaDriftError extends Error {
  public readonly diff: string;
  public readonly result: DriftResult;

  constructor(message: string, diff: string, result: DriftResult) {
    super(message);
    this.name = 'SchemaDriftError';
    this.diff = diff;
    this.result = result;
  }
}

function stripSchemaHash(
  schema: Omit<DatabaseSchema, 'schemaHash'>,
): Omit<DatabaseSchema, 'schemaHash'> {
  if ('schemaHash' in schema) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { schemaHash, ...rest } = schema as DatabaseSchema;
    return rest;
  }
  return schema;
}

function stripRuntimeMeta(
  schema: Omit<DatabaseSchema, 'schemaHash'>,
): Omit<DatabaseSchema, 'schemaHash'> {
  if ('introspectedAt' in schema) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { introspectedAt: _introspectedAt, ...rest } = schema as Omit<DatabaseSchema, 'schemaHash'> & { introspectedAt: string };
    return rest as unknown as Omit<DatabaseSchema, 'schemaHash'>;
  }
  return schema;
}

export async function checkDrift(
  config: SeedForgeConfig,
  schema: Omit<DatabaseSchema, 'schemaHash'>,
  options: {
    lockfilePath?: string;
    force?: boolean;
  } = {},
): Promise<DriftResult> {
  const schemaNoHash = stripRuntimeMeta(stripSchemaHash(schema));
  const liveHash = computeSchemaHash(schemaNoHash);
  const lockfile = await readLockfile(options.lockfilePath);

  if (!lockfile) {
    return {
      canProceed: true,
      diff: null,
      lockfileHash: null,
      liveHash,
      acknowledgedHash: null,
    };
  }

  const lockfileHash = lockfile.schemaHash;
  const acknowledgedHash = lockfile.acknowledgedSchemaHash;

  if (liveHash === lockfileHash) {
    return {
      canProceed: true,
      diff: null,
      lockfileHash,
      liveHash,
      acknowledgedHash,
    };
  }

  if (acknowledgedHash === liveHash) {
    return {
      canProceed: true,
      diff: null,
      lockfileHash,
      liveHash,
      acknowledgedHash,
    };
  }

  const oldSchema = reconstructSchemaFromLockfile(lockfile);
  const newSchema = { ...schemaNoHash, schemaHash: liveHash };
  const diff = diffSchemas(oldSchema, newSchema);

  if (options.force) {
    return {
      canProceed: true,
      diff,
      lockfileHash,
      liveHash,
      acknowledgedHash,
    };
  }

  return {
    canProceed: false,
    diff,
    lockfileHash,
    liveHash,
    acknowledgedHash,
  };
}

export async function createLockfile(
  config: SeedForgeConfig,
  schema: DatabaseSchema,
  seedValue: number,
  seedforgeVersion: string,
  perTableRowCounts: Record<string, number>,
  options: {
    lockfilePath?: string;
  } = {},
): Promise<SeedForgeLockfile> {
  const configHash = computeConfigHash(config);
  const { schemaHash, ...schemaRest } = schema;
  const lockfile: SeedForgeLockfile = {
    schemaHash,
    acknowledgedSchemaHash: null,
    configHash,
    seedValue,
    seedforgeVersion,
    generatedAt: new Date().toISOString(),
    perTableRowCounts,
    schema: schemaRest as unknown as Omit<DatabaseSchema, 'schemaHash'>,
  };

  await writeLockfile(lockfile, options.lockfilePath);
  return lockfile;
}

export async function acknowledgeDrift(
  schema: Omit<DatabaseSchema, 'schemaHash'>,
  options: {
    lockfilePath?: string;
  } = {},
): Promise<SeedForgeLockfile> {
  const schemaNoHash = stripRuntimeMeta(stripSchemaHash(schema));
  const liveHash = computeSchemaHash(schemaNoHash);
  const lockfile = await readLockfile(options.lockfilePath);

  if (!lockfile) {
    throw new SchemaDriftError(
      'No lockfile found. Run a seed generation first.',
      '',
      {
        canProceed: false,
        diff: null,
        lockfileHash: null,
        liveHash,
        acknowledgedHash: null,
      },
    );
  }

  lockfile.acknowledgedSchemaHash = liveHash;
  await writeLockfile(lockfile, options.lockfilePath);
  return lockfile;
}

function reconstructSchemaFromLockfile(
  lockfile: SeedForgeLockfile,
): DatabaseSchema {
  return {
    ...lockfile.schema,
    schemaHash: lockfile.schemaHash,
  };
}
