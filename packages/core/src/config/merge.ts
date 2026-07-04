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

function toGeneratorSpec(fieldConfig: unknown): { kind: string; params: Record<string, unknown> } {
  if (isDerived(fieldConfig)) {
    return { kind: 'derived', params: { fn: fieldConfig.fn } };
  }
  if (isDistributionSpec(fieldConfig)) {
    return { kind: fieldConfig.kind, params: fieldConfig.params };
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

    for (const column of tableSchema.columns) {
      const configField = tableConfig.fields?.[column.name];
      const inferredMatch = inferredMap.get(`${tableName}.${column.name}`);

      if (configField !== undefined) {
        fields.push({
          table: tableName,
          column: column.name,
          source: 'config',
          generator: toGeneratorSpec(configField),
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
      } else {
        issues.push(
          `Column '${tableName}.${column.name}' is unresolved and has no config override. ` +
          `SeedForge refuses to generate low-quality data. Add an explicit field config or ` +
          `use the AI-assist command (Prompt 12) to resolve this column.`,
        );
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
      count: count as number | DistributionSpec,
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
