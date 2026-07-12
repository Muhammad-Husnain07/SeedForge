import { describe, it, expect } from 'vitest';
import { suggest, suggestDescribe, renderConfigDraft, buildDescribeContext } from './suggest.js';
import { buildSystemPrompt, buildUserMessages, buildDescribeSystemPrompt, buildDescribeUserMessages } from './prompt.js';
import { createProvider, getResponseSchema, getDescribeResponseSchema } from './provider.js';
import { SuggestError } from './types.js';
import type { UnresolvedColumn, ConfigDraft } from './index.js';
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

// ─── Describe flow ───────────────────────────────────────────────────

describe('getDescribeResponseSchema', () => {
  it('returns a valid JSON Schema with tables and reasoning', () => {
    const schema = getDescribeResponseSchema();
    expect(schema).toHaveProperty('type', 'object');
    const props = (schema).properties as Record<string, unknown>;
    expect(props).toHaveProperty('tables');
    expect(props).toHaveProperty('reasoning');
    const required = (schema).required as string[];
    expect(required).toContain('tables');
    expect(required).toContain('reasoning');
  });
});

describe('buildDescribeSystemPrompt', () => {
  it('contains timeline and churn config references', () => {
    const prompt = buildDescribeSystemPrompt();
    expect(prompt).toContain('timeline');
    expect(prompt).toContain('churn');
    expect(prompt).toContain('compound');
    expect(prompt).toContain('persona');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('NEVER calls an LLM');
  });
});

describe('buildDescribeUserMessages', () => {
  it('includes schema description and user description', () => {
    const msgs = buildDescribeUserMessages(
      'Table: users\n  - id: uuid PK',
      'users.email: faker()',
      'users -> orders',
      'a B2B SaaS with churn',
    );
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    const full = msgs.join(' ');
    expect(full).toContain('users');
    expect(full).toContain('B2B SaaS');
    expect(full).toContain('Already-Resolved');
    expect(full).toContain('Relationship Graph');
  });
});

describe('buildDescribeContext', () => {
  const mockSchema = {
    dialect: 'postgres' as const,
    introspectedAt: new Date().toISOString(),
    schemaHash: 'abc123',
    tables: [
      {
        name: 'users',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid' as const, nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string' as const, nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'tier', logicalType: 'string' as const, nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false, enumValues: ['free', 'pro', 'enterprise'] },
          { name: 'created_at', logicalType: 'timestamp' as const, nativeType: 'timestamptz', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [],
        uniqueConstraints: [['email']],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer' as const, nativeType: 'int', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid' as const, nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
          { name: 'amount', logicalType: 'float' as const, nativeType: 'decimal', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
        uniqueConstraints: [],
      },
    ],
  };

  const mockResolved = [
    { table: 'users', column: 'email', source: 'inferred' as const, generator: { kind: 'email' as const, params: {} }, confidence: 0.95 },
    { table: 'orders', column: 'amount', source: 'inferred' as const, generator: { kind: 'log-normal-currency' as const, params: { mean: 50 } }, confidence: 0.9 },
  ];

  const mockGraph = {
    nodes: ['users', 'orders'],
    edges: [{ from: 'orders', to: 'users', type: 'one-to-many' as const, foreignKey: { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] } }],
    insertionOrder: ['users', 'orders'],
    cycles: [],
    levels: [['users'], ['orders']],
  };

  it('produces schema description text', () => {
    const ctx = buildDescribeContext({
      schema: mockSchema,
      resolved: mockResolved,
      graph: mockGraph,
      description: 'test',
    });
    expect(ctx.schemaDescription).toContain('users');
    expect(ctx.schemaDescription).toContain('email');
    expect(ctx.schemaDescription).toContain('FK');
  });

  it('includes resolved column generators', () => {
    const ctx = buildDescribeContext({
      schema: mockSchema,
      resolved: mockResolved,
      graph: mockGraph,
      description: 'test',
    });
    expect(ctx.resolvedColumns).toContain('email');
    expect(ctx.resolvedColumns).toContain('log-normal-currency');
  });

  it('includes graph edges', () => {
    const ctx = buildDescribeContext({
      schema: mockSchema,
      resolved: mockResolved,
      graph: mockGraph,
      description: 'test',
    });
    expect(ctx.graphEdges).toContain('orders');
    expect(ctx.graphEdges).toContain('users');
    expect(ctx.graphEdges).toContain('one-to-many');
  });
});

describe('suggestDescribe', () => {
  const validDraft: ConfigDraft = {
    tables: {
      users: {
        count: 1000,
        timeline: {
          start: '2024-01-01',
          end: '2025-12-31',
          growth: { type: 'compound', monthlyRate: 0.15 },
        },
        churn: { monthlyRate: 0.05 },
        personas: [
          { name: 'small_business', selectionWeight: 0.8, overrides: ['tier: free'], cascades: { orders: 0.5 } },
          { name: 'enterprise', selectionWeight: 0.2, overrides: ['tier: enterprise'], cascades: { orders: 0.3 } },
        ],
      },
      orders: {
        countPerParent: { users: 10 },
      },
    },
    reasoning: 'B2B SaaS with slow compound growth over 2 years.',
  };

  const mockSchema = {
    dialect: 'postgres' as const,
    introspectedAt: new Date().toISOString(),
    schemaHash: 'abc',
    tables: [
      {
        name: 'users',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid' as const, nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'email', logicalType: 'string' as const, nativeType: 'varchar', nullable: false, isPrimaryKey: false, isUnique: true },
          { name: 'tier', logicalType: 'string' as const, nativeType: 'varchar', nullable: true, isPrimaryKey: false, isUnique: false, enumValues: ['free', 'pro', 'enterprise'] },
        ],
        foreignKeys: [],
        uniqueConstraints: [],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer' as const, nativeType: 'int', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'user_id', logicalType: 'uuid' as const, nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
        ],
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] }],
        uniqueConstraints: [],
      },
    ],
  };

  const mockResolved = [
    { table: 'users', column: 'email', source: 'inferred' as const, generator: { kind: 'email', params: {} }, confidence: 0.95 },
  ];

  const mockGraph = {
    nodes: ['users', 'orders'],
    edges: [{ from: 'orders', to: 'users', type: 'one-to-many' as const, foreignKey: { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] } }],
    insertionOrder: ['users', 'orders'],
    cycles: [],
    levels: [['users'], ['orders']],
  };

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

  it('returns a valid ConfigDraft for a B2B SaaS description', async () => {
    const result = await suggestDescribe(
      {
        schema: mockSchema,
        resolved: mockResolved,
        graph: mockGraph,
        description: 'a B2B SaaS that has been growing steadily for 2 years, mostly small businesses, 10% annual churn, a few large enterprise accounts',
      },
      mockProvider(validDraft),
    );

    expect(result.tables).toHaveProperty('users');
    expect(result.tables).toHaveProperty('orders');
    expect(result.tables.users?.count).toBe(1000);
    expect(result.tables.users?.timeline?.growth.type).toBe('compound');
    expect(result.tables.users?.timeline?.growth.monthlyRate).toBe(0.15);
    expect(result.tables.users?.churn?.monthlyRate).toBe(0.05);
    expect(result.tables.users?.personas).toHaveLength(2);
    expect(result.tables.users?.personas?.[0]?.cascades).toHaveProperty('orders');
    expect(result.tables.orders?.countPerParent).toHaveProperty('users');
    expect(result.reasoning).toBeTruthy();
  });

  it('catches malformed JSON that does not match ConfigDraft schema', async () => {
    const bad = { tables: { users: { count: -1 } } }; // missing reasoning, negative count
    await expect(
      suggestDescribe(
        {
          schema: mockSchema,
          resolved: mockResolved,
          graph: mockGraph,
          description: 'test',
        },
        mockProvider(bad),
      ),
    ).rejects.toThrow(SuggestError);
    await expect(
      suggestDescribe(
        {
          schema: mockSchema,
          resolved: mockResolved,
          graph: mockGraph,
          description: 'test',
        },
        mockProvider(bad),
      ),
    ).rejects.toThrow(/malformed/i);
  });

  it('catches LLM connection errors', async () => {
    const errorProvider: LLMProvider = {
      complete(): Promise<unknown> {
        return Promise.reject(new Error('Connection refused'));
      },
    };
    await expect(
      suggestDescribe(
        {
          schema: mockSchema,
          resolved: mockResolved,
          graph: mockGraph,
          description: 'test',
        },
        errorProvider,
      ),
    ).rejects.toThrow(SuggestError);
  });
});

describe('renderConfigDraft', () => {
  it('produces a valid seedforge config file', () => {
    const draft: ConfigDraft = {
      tables: {
        users: {
          count: 500,
          timeline: {
            start: '2024-01-01',
            end: '2025-12-31',
            growth: { type: 'compound', monthlyRate: 0.15 },
          },
          churn: { monthlyRate: 0.05 },
          personas: [
            { name: 'free', selectionWeight: 0.7, overrides: ['tier: free'] },
            { name: 'pro', selectionWeight: 0.3, overrides: ['tier: pro'], cascades: { orders: 1.2 } },
          ],
        },
        orders: {
          countPerParent: { users: 8 },
        },
      },
      reasoning: 'A B2B SaaS growing at 15% monthly with 5% churn.',
    };

    const rendered = renderConfigDraft(draft, 'postgres', 'postgresql://localhost:5432/test', undefined, undefined, undefined);

    expect(rendered).toContain("defineConfig");
    expect(rendered).toContain("dialect: 'postgres'");
    expect(rendered).toContain("connectionString: 'postgresql://localhost:5432/test'");
    expect(rendered).toContain('count: 500');
    expect(rendered).toContain('compound');
    expect(rendered).toContain('monthlyRate: 0.15');
    expect(rendered).toContain('monthlyRate: 0.05');
    expect(rendered).toContain('selectionWeight: 0.7');
    expect(rendered).toContain('cascades');
    expect(rendered).toContain('countPerParent');
    expect(rendered).toContain('users: 8');
    expect(rendered).toContain('AI-generated');
    expect(rendered).toContain('NEVER calls the LLM');
  });

  it('omits optional blocks when not provided', () => {
    const draft: ConfigDraft = {
      tables: {
        users: { count: 100 },
      },
      reasoning: 'Simple test.',
    };

    const rendered = renderConfigDraft(draft, 'postgres', '', undefined, undefined, undefined);
    expect(rendered).toContain('count: 100');
    expect(rendered).not.toContain('timeline');
    expect(rendered).not.toContain('churn');
    expect(rendered).not.toContain('personas');
    expect(rendered).not.toContain('countPerParent');
  });

  it('includes source and schemaPath when provided', () => {
    const draft: ConfigDraft = {
      tables: {},
      reasoning: 'Schema-file based config.',
    };

    const rendered = renderConfigDraft(draft, 'postgres', '', undefined, 'prisma', './schema.prisma');
    expect(rendered).toContain("source: 'prisma'");
    expect(rendered).toContain("schemaPath: './schema.prisma'");
  });
});
