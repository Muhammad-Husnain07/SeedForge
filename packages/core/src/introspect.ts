import type { DatabaseSchema } from './types/index.js';
import crypto from 'node:crypto';

export type ConnectConfig =
  | { dialect: 'postgres'; connectionString: string }
  | { dialect: 'mysql'; connectionString: string }
  | { dialect: 'mongodb'; connectionString: string; database: string };

export interface Introspector {
  introspect(
    config: unknown,
  ): Promise<Omit<DatabaseSchema, 'schemaHash'>>;
}

const registry = new Map<string, Introspector>();

export function registerIntrospector(
  dialect: string,
  introspector: Introspector,
): void {
  registry.set(dialect, introspector);
}

function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`,
    );
    return `{${pairs.join(',')}}`;
  }
  return String(obj);
}

export function computeSchemaHash(
  schema: Omit<DatabaseSchema, 'schemaHash'>,
): string {
  const canonical = canonicalStringify(schema);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

export async function introspect(
  config: ConnectConfig,
): Promise<DatabaseSchema> {
  const introspector = registry.get(config.dialect);
  if (!introspector) {
    throw new Error(
      `No introspector registered for dialect: ${config.dialect}. ` +
        `Import and call registerIntrospector() from the appropriate adapter package first.`,
    );
  }
  const raw = await introspector.introspect(config);
  const schema: DatabaseSchema = {
    ...raw,
    schemaHash: computeSchemaHash(raw),
  };
  return schema;
}
