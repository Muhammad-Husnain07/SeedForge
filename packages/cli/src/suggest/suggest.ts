import { z } from 'zod';
import type { SuggestOptions, SuggestResponse, ProviderConfig, SuggestDescribeOptions, ConfigDraft } from './types.js';
import { SuggestError } from './types.js';
import { buildSystemPrompt, buildUserMessages, buildDescribeSystemPrompt, buildDescribeUserMessages } from './prompt.js';
import { createProvider, getResponseSchema, getDescribeResponseSchema } from './provider.js';
import type { LLMProvider } from './provider.js';

// ─── Zod schema for validating LLM response ───────────────────────────

const GeneratorSpecSchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.unknown()),
});

const ColumnSuggestionSchema = z.object({
  table: z.string().min(1),
  column: z.string().min(1),
  semanticType: z.string().min(1),
  generatorSpec: GeneratorSpecSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

const PersonaSuggestionSchema = z.object({
  name: z.string().min(1),
  selectionWeight: z.number().min(0).max(1),
  overrides: z.array(z.string()),
  cascades: z.record(z.number()).optional(),
});

const TableSuggestionSchema = z.object({
  table: z.string().min(1),
  statusDistributions: z.record(z.number()).optional(),
  personaSuggestions: z.array(PersonaSuggestionSchema).optional(),
  reasoning: z.string().min(1),
});

const SuggestResponseSchema = z.object({
  suggestions: z.array(ColumnSuggestionSchema).min(0),
  tableSuggestions: z.array(TableSuggestionSchema).optional(),
});

// ─── Supported generator kinds ────────────────────────────────────────

const KNOWN_KINDS = new Set([
  'uuid', 'faker', 'weighted-categorical', 'bounded-integer',
  'boolean', 'boolean-skewed', 'recent-timestamp', 'dependent-timestamp',
  'log-normal-currency', 'lat-lng-pair', 'derived-slug',
  'paretoInt', 'uniformInt', 'uniformReal',
  'fullName', 'firstName', 'lastName', 'email', 'phone',
  'street', 'city', 'state', 'country', 'zip',
  'url', 'ip', 'imageUrl', 'longText', 'sku', 'slug', 'quantity', 'rating',
]);

// ─── Main suggest function ────────────────────────────────────────────

export async function suggest(
  options: SuggestOptions,
  /** For testing — inject a pre-configured provider */
  testProvider?: LLMProvider,
): Promise<SuggestResponse> {
  const { unresolved, includeSamples, samples, tablesOptedIn } = options;

  if (unresolved.length === 0) {
    return { suggestions: [], tableSuggestions: [] };
  }

  // Filter by opted-in tables if specified
  let columnsToSuggest = unresolved;
  if (tablesOptedIn && tablesOptedIn.length > 0) {
    columnsToSuggest = unresolved.filter((c) => tablesOptedIn.includes(c.table));
    if (columnsToSuggest.length === 0) {
      return { suggestions: [], tableSuggestions: [] };
    }
  }

  // Build the prompt context
  const systemPrompt = buildSystemPrompt();
  const userBlocks = buildUserMessages(columnsToSuggest, includeSamples, samples);

  // Use the provider (or inject for testing)
  const provider: LLMProvider = testProvider ?? (() => {
    const providerConfig: ProviderConfig = options.provider ?? {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
    };
    if (!providerConfig.apiKey) {
      providerConfig.apiKey = resolveApiKey(providerConfig.provider);
    }
    return createProvider(providerConfig);
  })();
  const responseSchema = getResponseSchema();

  let raw: unknown;
  try {
    raw = await provider.complete(systemPrompt, userBlocks, responseSchema);
  } catch (err) {
    throw new SuggestError(
      'llm_error',
      `LLM call failed: ${(err as Error).message}`,
    );
  }

  // Validate response shape with Zod
  let parsed: SuggestResponse;
  try {
    parsed = SuggestResponseSchema.parse(raw);
  } catch (err) {
    const zodErr = err as z.ZodError;
    const issues = zodErr.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new SuggestError(
      'parse_error',
      `LLM returned malformed response: ${issues}`,
      JSON.stringify(raw, null, 2),
    );
  }

  // Validate each suggestion's generator kind is known
  for (const s of parsed.suggestions) {
    if (!KNOWN_KINDS.has(s.generatorSpec.kind)) {
      throw new SuggestError(
        'unknown_generator',
        `LLM proposed unknown generator kind '${s.generatorSpec.kind}' for ${s.table}.${s.column}. ` +
          `Known kinds: ${[...KNOWN_KINDS].join(', ')}`,
        JSON.stringify(raw, null, 2),
      );
    }
  }

  return parsed;
}

function resolveApiKey(provider: string): string {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY ?? '';
    case 'openai':
    case 'deepseek':
    case 'xai':
    case 'openrouter':
    case 'ollama':
      return process.env.OPENAI_API_KEY ?? '';
    case 'google': return process.env.GEMINI_API_KEY ?? '';
    default: return '';
  }
}

// ─── Describe config draft ────────────────────────────────────────────

export interface DescribeContext {
  schemaDescription: string;
  resolvedColumns: string;
  graphEdges: string;
}

export function buildDescribeContext(
  options: SuggestDescribeOptions,
): DescribeContext {
  const { schema, resolved, graph } = options;

  // Schema text
  let schemaDescription = '';
  for (const table of schema.tables) {
    schemaDescription += `Table: ${table.name}\n`;
    schemaDescription += `  PK: ${table.primaryKey.join(', ') || 'none'}\n`;
    for (const col of table.columns) {
      schemaDescription += `  - ${col.name}: ${col.logicalType} (${col.nativeType})${col.nullable ? '' : ' NOT NULL'}${col.isPrimaryKey ? ' PK' : ''}${col.isUnique ? ' UQ' : ''}`;
      if (col.enumValues?.length) {
        schemaDescription += ` enum[${col.enumValues.join(', ')}]`;
      }
      schemaDescription += '\n';
    }
    for (const fk of table.foreignKeys) {
      schemaDescription += `  FK: ${fk.columns.join(', ')} → ${fk.referencedTable}(${fk.referencedColumns.join(', ')})\n`;
    }
    schemaDescription += '\n';
  }

  // Resolved columns text
  let resolvedColumns = '';
  for (const r of resolved) {
    resolvedColumns += `  ${r.table}.${r.column}: ${r.generator.kind}(${JSON.stringify(r.generator.params)}) [confidence: ${r.confidence}]\n`;
  }

  // Graph edges text
  let graphEdges = '';
  graphEdges += `Insertion order: ${graph.insertionOrder.join(' → ')}\n`;
  for (const edge of graph.edges) {
    graphEdges += `  ${edge.from} --[${edge.type}]--> ${edge.to}`;
    if (edge.viaJunctionTable) graphEdges += ` (via ${edge.viaJunctionTable})`;
    graphEdges += '\n';
  }

  return { schemaDescription, resolvedColumns, graphEdges };
}

// ─── Zod schemas for describe response ────────────────────────────────

const ConfigDraftGrowthSchema = z.object({
  type: z.enum(['compound', 'linear', 'scurve']),
  monthlyRate: z.number().min(0).optional(),
  totalGrowth: z.number().min(0).optional(),
  inflectionPoint: z.number().optional(),
  steepness: z.number().min(0).optional(),
});

const ConfigDraftTimelineSchema = z.object({
  start: z.string().min(1),
  end: z.string().optional(),
  growth: ConfigDraftGrowthSchema,
  seasonality: z.object({
    type: z.literal('preset'),
    name: z.literal('ecommerce-holiday'),
  }).optional(),
});

const ConfigDraftChurnSchema = z.object({
  monthlyRate: z.number().min(0).max(1),
});

const ConfigDraftTableSchema = z.object({
  count: z.number().int().min(0).optional(),
  countPerParent: z.record(z.number().int().min(0)).optional(),
  timeline: ConfigDraftTimelineSchema.optional(),
  churn: ConfigDraftChurnSchema.optional(),
  personas: z.array(PersonaSuggestionSchema).optional(),
});

const ConfigDraftSchema = z.object({
  tables: z.record(ConfigDraftTableSchema),
  reasoning: z.string().min(1),
});

/**
 * Produce a full config draft from a free-text description.
 */
export async function suggestDescribe(
  options: SuggestDescribeOptions,
  testProvider?: LLMProvider,
): Promise<ConfigDraft> {
  const ctx = buildDescribeContext(options);

  const systemPrompt = buildDescribeSystemPrompt();
  const userBlocks = buildDescribeUserMessages(
    ctx.schemaDescription,
    ctx.resolvedColumns,
    ctx.graphEdges,
    options.description,
  );

  const provider: LLMProvider = testProvider ?? (() => {
    const providerConfig: ProviderConfig = options.provider ?? {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
    };
    if (!providerConfig.apiKey) {
      providerConfig.apiKey = resolveApiKey(providerConfig.provider);
    }
    return createProvider(providerConfig);
  })();
  const responseSchema = getDescribeResponseSchema();

  let raw: unknown;
  try {
    raw = await provider.complete(systemPrompt, userBlocks, responseSchema);
  } catch (err) {
    throw new SuggestError(
      'llm_error',
      `LLM call failed: ${(err as Error).message}`,
    );
  }

  let parsed: ConfigDraft;
  try {
    parsed = ConfigDraftSchema.parse(raw);
  } catch (err) {
    const zodErr = err as z.ZodError;
    const issues = zodErr.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new SuggestError(
      'parse_error',
      `LLM returned malformed config draft: ${issues}`,
      JSON.stringify(raw, null, 2),
    );
  }

  // Validate table references in personas/cascades
  const tableNames = new Set<string>();
  for (const tableName of Object.keys(parsed.tables)) {
    tableNames.add(tableName);
  }

  for (const [tableName, tableDraft] of Object.entries(parsed.tables)) {
    if (tableDraft.countPerParent) {
      for (const parentTable of Object.keys(tableDraft.countPerParent)) {
        // Allow referencing tables not in the draft — they might use defaults
        // Just ensure it's not an empty string
        if (!parentTable) {
          throw new SuggestError(
            'invalid_reference',
            `Config draft references empty parent table name in '${tableName}.countPerParent'`,
            JSON.stringify(raw, null, 2),
          );
        }
      }
    }
    if (tableDraft.personas) {
      for (const persona of tableDraft.personas) {
        if (persona.cascades) {
          for (const childTable of Object.keys(persona.cascades)) {
            if (!childTable) {
              throw new SuggestError(
                'invalid_reference',
                `Config draft references empty child table name in persona '${persona.name}' cascade`,
                JSON.stringify(raw, null, 2),
              );
            }
          }
        }
      }
    }
  }

  return parsed;
}

/**
 * Render a ConfigDraft + original schema + connection info into a formatted config file.
 */
export function renderConfigDraft(
  draft: ConfigDraft,
  dialect: string,
  connectionString?: string,
  database?: string,
  source?: string,
  schemaPath?: string,
): string {
  const lines: string[] = [];

  lines.push('// seedforge.config.suggested.ts');
  lines.push('// AI-generated config draft — review and test before using.');
  lines.push('// Generated by `seedforge suggest --describe`');
  lines.push('// The LLM is ONLY consulted at suggest-time. Generate/seed NEVER calls the LLM.');
  lines.push('// ⚠  Do NOT import this file directly. Copy relevant parts into your config,');
  lines.push('//    or rename it and run `seedforge validate` to check it.');
  lines.push('');
  lines.push("import { defineConfig } from '@seed-forge/core';");
  lines.push('');

  if (draft.reasoning) {
    lines.push('/*');
    lines.push(' * Design decisions:');
    lines.push(` * ${draft.reasoning}`);
    lines.push(' */');
    lines.push('');
  }

  lines.push('export default defineConfig({');
  lines.push('  connection: {');
  lines.push(`    dialect: '${dialect}',`);
  if (source) {
    lines.push(`    source: '${source}',`);
  }
  if (schemaPath) {
    lines.push(`    schemaPath: '${schemaPath}',`);
  }
  lines.push(`    connectionString: '${connectionString ?? ''}',`);
  if (database) {
    lines.push(`    database: '${database}',`);
  }
  lines.push('  },');

  const tableNames = Object.keys(draft.tables);
  if (tableNames.length > 0) {
    lines.push('  tables: {');
    for (const tableName of tableNames) {
      const t = draft.tables[tableName]!;
      lines.push(`    ${tableName}: {`);

      if (t.count !== undefined) {
        lines.push(`      count: ${t.count},`);
      }

      if (t.countPerParent && Object.keys(t.countPerParent).length > 0) {
        lines.push('      countPerParent: {');
        for (const [parent, count] of Object.entries(t.countPerParent)) {
          lines.push(`        ${parent}: ${count},`);
        }
        lines.push('      },');
      }

      if (t.timeline) {
        lines.push('      timeline: {');
        lines.push(`        start: '${t.timeline.start}',`);
        if (t.timeline.end) {
          lines.push(`        end: '${t.timeline.end}',`);
        }
        lines.push('        growth: {');
        lines.push(`          type: '${t.timeline.growth.type}',`);
        if (t.timeline.growth.monthlyRate !== undefined) {
          lines.push(`          monthlyRate: ${t.timeline.growth.monthlyRate},`);
        }
        if (t.timeline.growth.totalGrowth !== undefined) {
          lines.push(`          totalGrowth: ${t.timeline.growth.totalGrowth},`);
        }
        if (t.timeline.growth.inflectionPoint !== undefined) {
          lines.push(`          inflectionPoint: ${t.timeline.growth.inflectionPoint},`);
        }
        if (t.timeline.growth.steepness !== undefined) {
          lines.push(`          steepness: ${t.timeline.growth.steepness},`);
        }
        lines.push('        },');
        if (t.timeline.seasonality) {
          lines.push('        seasonality: {');
          lines.push(`          type: '${t.timeline.seasonality.type}',`);
          lines.push(`          name: '${t.timeline.seasonality.name}',`);
          lines.push('        },');
        }
        lines.push('      },');
      }

      if (t.churn) {
        lines.push('      churn: {');
        lines.push(`        monthlyRate: ${t.churn.monthlyRate},`);
        lines.push('      },');
      }

      if (t.personas && t.personas.length > 0) {
        lines.push('      personas: [');
        for (const p of t.personas) {
          lines.push('        {');
          lines.push(`          name: '${p.name}',`);
          lines.push(`          selectionWeight: ${p.selectionWeight},`);
          lines.push('          overrides: [');
          for (const o of p.overrides) {
            lines.push(`            '${o}',`);
          }
          lines.push('          ],');
          if (p.cascades && Object.keys(p.cascades).length > 0) {
            lines.push('          cascades: {');
            for (const [childTable, multiplier] of Object.entries(p.cascades)) {
              lines.push(`            ${childTable}: ${multiplier},`);
            }
            lines.push('          },');
          }
          lines.push('        },');
        }
        lines.push('      ],');
      }

      lines.push('    },');
    }
    lines.push('  },');
  }

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}
