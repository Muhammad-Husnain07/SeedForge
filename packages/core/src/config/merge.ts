import type { DatabaseSchema } from '../types/index.js';
import type { FieldSemanticMatch } from '../semantic/types.js';
import type { Persona } from '../distributions/persona.js';
import type {
  SeedForgeConfig,
  GenerationPlan,
  DistributionSpec,
  ResolvedField,
  DerivedField,
} from './types.js';

function isDerived(v: unknown): v is DerivedField {
  return typeof v === 'object' && v !== null && 'fn' in v;
}

function isDistributionSpec(v: unknown): v is DistributionSpec {
  return typeof v === 'object' && v !== null && 'kind' in v && 'params' in v && !('fn' in v);
}

function toGeneratorSpec(fieldConfig: unknown): { kind: string; params: Record<string, unknown> } | null {
  if (fieldConfig === null || typeof fieldConfig !== 'object') return null;
  if (isDerived(fieldConfig)) {
    return { kind: 'derived', params: { fn: fieldConfig.fn } };
  }
  if (isDistributionSpec(fieldConfig)) {
    return { kind: fieldConfig.kind, params: fieldConfig.params };
  }
  if (!('kind' in (fieldConfig as Record<string, unknown>))) {
    return null;
  }
  const g = fieldConfig as { kind: string; params: Record<string, unknown> };
  return { kind: g.kind, params: g.params };
}

export class SeedForgeConfigError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.name = 'SeedForgeConfigError';
    this.issues = issues;
  }
}

export function buildGenerationPlan(
  schema: DatabaseSchema,
  config: SeedForgeConfig,
  inferred: FieldSemanticMatch[],
): GenerationPlan {
  const issues: string[] = [];
  const plan: GenerationPlan = { tables: {} };

  const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

  const inferredMap = new Map<string, FieldSemanticMatch>();
  for (const m of inferred) {
    inferredMap.set(`${m.table}.${m.column}`, m);
  }

  for (const [tableName, tableSchema] of tableMap) {
    const tableConfig = config.tables[tableName] ?? {};
    const fields: ResolvedField[] = [];

    // When schema columns are empty (e.g. MongoDB with no sampled documents),
    // fall back to config fields directly so generated rows carry the expected data.
    if (tableSchema.columns.length === 0 && tableConfig.fields) {
      for (const [colName, fieldConfig] of Object.entries(tableConfig.fields)) {
        const spec = toGeneratorSpec(fieldConfig);
        if (!spec) continue;
        fields.push({
          table: tableName,
          column: colName,
          source: 'config',
          generator: spec,
          confidence: 1,
        });
      }
    } else {
      for (const column of tableSchema.columns) {
        const configField = tableConfig.fields?.[column.name];
        const inferredMatch = inferredMap.get(`${tableName}.${column.name}`);

        let spec: { kind: string; params: Record<string, unknown> } | null = null;
        if (configField !== undefined) {
          spec = toGeneratorSpec(configField);
        }

        if (spec) {
          fields.push({
            table: tableName,
            column: column.name,
            source: 'config',
            generator: spec,
            confidence: 1,
          });
        } else if (inferredMatch && inferredMatch.source === 'rule') {
          fields.push({
            table: tableName,
            column: column.name,
            source: 'inferred',
            generator: inferredMatch.suggestedGenerator,
            confidence: inferredMatch.confidence,
          });
        } else if (column.nullable) {
          continue;
        } else {
          const hint = configField !== undefined
            ? 'config is empty (likely a function lost during serialization)'
            : 'is unresolved and has no config override';
          issues.push(
            `Column '${tableName}.${column.name}' ${hint}. ` +
            `Add an explicit field config or use the AI-assist command (Prompt 12) to resolve this column.`,
          );
        }
      }
    }

    const count = tableConfig.count ?? 10;
    const countPerParent: Record<string, number | DistributionSpec> = {};
    if (tableConfig.countPerParent) {
      for (const [parent, val] of Object.entries(tableConfig.countPerParent)) {
        countPerParent[parent] = val;
      }
    }

    const personas: Persona[] = tableConfig.personas ?? [];
    const overrides: Record<string, unknown>[] = tableConfig.overrides ?? [];

    plan.tables[tableName] = {
      count,
      timeline: tableConfig.timeline,
      churn: tableConfig.churn,
      fields,
      countPerParent,
      personas,
      overrides,
    };
  }

  if (issues.length > 0) {
    throw new SeedForgeConfigError(issues);
  }

  return plan;
}
