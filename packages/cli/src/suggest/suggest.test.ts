import { describe, it, expect } from 'vitest';
import { suggest } from './suggest.js';
import { buildSystemPrompt, buildUserMessages } from './prompt.js';
import { createProvider, getResponseSchema } from './provider.js';
import { SuggestError } from './types.js';
import type { UnresolvedColumn } from './index.js';
import type { LLMProvider } from './provider.js';

// ─── Mock provider that returns a canned response ───────────────────

function mockProvider(response: unknown): LLMProvider {
  return {
    complete(
      _systemPrompt: string,
      _userMessages: string[],
      _responseJsonSchema: Record<string, unknown>,
    ): Promise<unknown> {
      return Promise.resolve(response);
    },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────

function makeColumn(overrides: Partial<UnresolvedColumn> = {}): UnresolvedColumn {
  return {
    table: 'products',
    column: 'tier',
    logicalType: 'string',
    nativeType: 'varchar',
    nullable: true,
    isUnique: false,
    isPrimaryKey: false,
    enumValues: undefined,
    maxLength: 20,
    comment: undefined,
    siblingColumns: ['id', 'name', 'price', 'sku', 'description'],
    ...overrides,
  };
}

const validWeightedCategoricalResponse = {
  suggestions: [
    {
      table: 'products',
      column: 'tier',
      semanticType: 'product_tier',
      generatorSpec: {
        kind: 'weighted-categorical',
        params: {
          values: { gold: 0.2, silver: 0.5, bronze: 0.3 },
        },
      },
      confidence: 0.95,
      reasoning: 'The column contains exactly three distinct values matching common product tiers.',
    },
  ],
  tableSuggestions: [],
};

// ─── Tests ────────────────────────────────────────────────────────────

describe('suggest', () => {
  // ─── DoD: ambiguous column → weighted-categorical ───────────────
  it('DoD: proposes weighted-categorical for ambiguous varchar with three distinct values', async () => {
    const result = await suggest(
      {
        unresolved: [
          makeColumn({
            table: 'products',
            column: 'tier',
            logicalType: 'string',
            nativeType: 'varchar',
            enumValues: undefined,
            comment: undefined,
            siblingColumns: ['id', 'name', 'price', 'sku', 'description'],
          }),
        ],
        includeSamples: true,
        samples: {
          'products.tier': ['gold', 'silver', 'bronze'],
        },
      },
      mockProvider(validWeightedCategoricalResponse),
    );

    expect(result.suggestions).toHaveLength(1);
    const s = result.suggestions[0]!;
    expect(s.table).toBe('products');
    expect(s.column).toBe('tier');
    expect(s.generatorSpec.kind).toBe('weighted-categorical');
    expect(s.generatorSpec.params).toHaveProperty('values');
    const values = s.generatorSpec.params.values as Record<string, number>;
    expect(Object.keys(values)).toEqual(['gold', 'silver', 'bronze']);
    expect(values.gold).toBeGreaterThan(0);
    expect(values.silver).toBeGreaterThan(0);
    expect(values.bronze).toBeGreaterThan(0);
    expect(s.confidence).toBeGreaterThan(0);
    expect(typeof s.reasoning).toBe('string');
    expect(s.reasoning.length).toBeGreaterThan(0);
  });

  // ─── Empty unresolved ───────────────────────────────────────────
  it('returns empty suggestions when no unresolved columns', async () => {
    const result = await suggest(
      { unresolved: [] },
      mockProvider({ suggestions: [] }),
    );
    expect(result.suggestions).toEqual([]);
  });

  // ─── Table filtering ────────────────────────────────────────────
  it('filters by opted-in tables', async () => {
    const result = await suggest(
      {
        unresolved: [
          makeColumn({ table: 'products', column: 'tier' }),
          makeColumn({ table: 'reviews', column: 'rating' }),
        ],
        tablesOptedIn: ['reviews'],
      },
      mockProvider({ suggestions: [] }),
    );
    expect(result.suggestions).toEqual([]);
  });

  it('returns empty if no unresolved match opted-in tables', async () => {
    const result = await suggest(
      {
        unresolved: [
          makeColumn({ table: 'products', column: 'tier' }),
        ],
        tablesOptedIn: ['orders'],
      },
      mockProvider({ suggestions: [] }),
    );
    expect(result.suggestions).toEqual([]);
  });

  // ─── Malformed response (not JSON) ──────────────────────────────
  it('catches and reports non-JSON LLM output', async () => {
    const provider: LLMProvider = {
      complete(): Promise<unknown> {
        return Promise.reject(new Error('Connection refused'));
      },
    };
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        provider,
      ),
    ).rejects.toThrow(SuggestError);
  });

  // ─── Malformed response (wrong shape) ───────────────────────────
  it('catches and reports malformed JSON that does not match schema', async () => {
    const badResponse = {
      suggestions: [
        {
          table: 'products',
          // missing column, generatorSpec, confidence, reasoning
        },
      ],
    };
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        mockProvider(badResponse),
      ),
    ).rejects.toThrow(SuggestError);
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        mockProvider(badResponse),
      ),
    ).rejects.toThrow(/malformed/i);
  });

  // ─── Unknown generator kind ─────────────────────────────────────
  it('rejects unknown generator kinds', async () => {
    const badKind = {
      suggestions: [
        {
          table: 'products',
          column: 'tier',
          semanticType: 'magic',
          generatorSpec: { kind: 'magic-unknown', params: {} },
          confidence: 0.9,
          reasoning: 'Magic generator for magic column.',
        },
      ],
      tableSuggestions: [],
    };
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        mockProvider(badKind),
      ),
    ).rejects.toThrow(SuggestError);
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        mockProvider(badKind),
      ),
    ).rejects.toThrow(/unknown generator/i);
  });

  // ─── Confidence out of range ────────────────────────────────────
  it('rejects confidence outside 0-1 range', async () => {
    const badConfidence = {
      suggestions: [
        {
          table: 'products',
          column: 'tier',
          semanticType: 'product_tier',
          generatorSpec: { kind: 'weighted-categorical', params: { values: { a: 1 } } },
          confidence: 42,
          reasoning: 'Bad confidence.',
        },
      ],
      tableSuggestions: [],
    };
    await expect(
      suggest(
        { unresolved: [makeColumn()] },
        mockProvider(badConfidence),
      ),
    ).rejects.toThrow(SuggestError);
  });

  // ─── Samples included in prompt context ─────────────────────────
  it('includes samples in user messages when opted in', () => {
    const msgs = buildUserMessages(
      [makeColumn()],
      true,
      { 'products.tier': ['gold', 'silver', 'bronze'] },
    );
    const fullText = msgs.join(' ');
    expect(fullText).toContain('gold');
    expect(fullText).toContain('silver');
    expect(fullText).toContain('bronze');
    expect(fullText).toContain('observed distinct values');
  });

  // ─── Schema-only by default (no samples) ────────────────────────
  it('does NOT include samples when not opted in', async () => {
    const captured: string[] = [];
    const capturingProvider: LLMProvider = {
      complete(
        _sysPrompt: string,
        userMessages: string[],
        _schema: Record<string, unknown>,
      ): Promise<unknown> {
        captured.push(...userMessages);
        return Promise.resolve({ suggestions: [] });
      },
    };
    await suggest(
      {
        unresolved: [makeColumn()],
        includeSamples: false,
      },
      capturingProvider,
    );
    const fullText = captured.join(' ');
    expect(fullText).toContain('products');
    expect(fullText).toContain('tier');
    expect(fullText).toContain('logicalType');
    expect(fullText).not.toContain('observed distinct values');
  });
});

// ─── prompt tests ─────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('contains the generator catalogue', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('weighted-categorical');
    expect(prompt).toContain('uuid');
    expect(prompt).toContain('bounded-integer');
    expect(prompt).toContain('NEVER calls an LLM');
    expect(prompt).toContain('RESPONSE FORMAT');
  });

  it('contains the critical reproducibility warning', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('deterministic');
    expect(prompt).toContain('REVIEWED by a human');
  });
});

// ─── provider tests ───────────────────────────────────────────────────

describe('createProvider', () => {
  it('returns an LLMProvider for anthropic', () => {
    const p = createProvider({ provider: 'anthropic' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for openai', () => {
    const p = createProvider({ provider: 'openai' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for google', () => {
    const p = createProvider({ provider: 'google' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for deepseek', () => {
    const p = createProvider({ provider: 'deepseek' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for xai', () => {
    const p = createProvider({ provider: 'xai' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for openrouter', () => {
    const p = createProvider({ provider: 'openrouter' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('returns an LLMProvider for ollama', () => {
    const p = createProvider({ provider: 'ollama' });
    expect(p).toBeDefined();
    expect(typeof p.complete).toBe('function');
  });

  it('throws for unknown provider', () => {
    expect(() =>
      createProvider({ provider: 'unknown' as never }),
    ).toThrow('Unknown provider');
  });
});

describe('getResponseSchema', () => {
  it('returns a valid JSON Schema object', () => {
    const schema = getResponseSchema();
    expect(schema).toHaveProperty('type', 'object');
    expect(schema).toHaveProperty('properties');
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty('suggestions');
    expect(props).toHaveProperty('tableSuggestions');
    expect(schema).toHaveProperty('required');
  });
});
