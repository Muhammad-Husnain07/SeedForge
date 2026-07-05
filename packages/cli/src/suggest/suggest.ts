import { z } from 'zod';
import type { UnresolvedColumn, SuggestOptions, SuggestResponse, ProviderConfig } from './types.js';
import { SuggestError } from './types.js';
import { buildSystemPrompt, buildUserMessages } from './prompt.js';
import { createProvider, getResponseSchema } from './provider.js';
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
