import crypto from 'node:crypto';
import type { SeedForgeConfig } from '../config/types.js';

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

function stripFunctions(obj: unknown): unknown {
  if (typeof obj === 'function') return { __striped_fn__: true };
  if (Array.isArray(obj)) return obj.map(stripFunctions);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const stripped = stripFunctions(v);
      if (stripped !== undefined) result[k] = stripped;
    }
    return result;
  }
  return obj;
}

export function computeConfigHash(config: SeedForgeConfig): string {
  const tablesOnly = { tables: config.tables };
  const clean = stripFunctions(tablesOnly);
  const canonical = canonicalStringify(clean);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
