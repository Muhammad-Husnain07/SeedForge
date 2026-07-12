import type { UnresolvedColumn } from './types.js';

const GENERATOR_CATALOGUE = `
AVAILABLE GENERATORS — each has a \`kind\` and expected \`params\`:

1. uuid — generates a UUID v4. Params: none.
   Compatible with: uuid, string

2. faker — calls any faker.js method. Params: { method: string, args?: any[] }
   Compatible with: string, float, integer, boolean

3. weighted-categorical — draws from weighted categories. Params:
   { values: Record<string,number> } — keys are categories, values are weights (need not sum to 1)
   For enum columns, you may omit values and use enumValues from the column directly.
   Compatible with: enum, integer, string

4. bounded-integer — uniform integer in range. Params: { min?: number, max?: number }
   Compatible with: integer

5. boolean / boolean-skewed — Bernoulli draw. Params: { probability?: number } (default 0.5)
   Compatible with: boolean

6. recent-timestamp — timestamp biased toward recent dates. Params:
   { withinDays?: number, weighted?: 'recent' | 'uniform' | 'old' }
   Compatible with: timestamp, date

7. dependent-timestamp — timestamp offset from another column. Params:
   { dependsOn: string, maxOffsetMs?: number }
   Compatible with: timestamp, date

8. log-normal-currency — log-normal rounded to 2 decimals. Params:
   { mean?: number, stdDev?: number }
   Compatible with: float, integer

9. uniformInt — uniform integer. Params: { min?: number, max?: number }
   Compatible with: integer

10. uniformReal — uniform float. Params: { min?: number, max?: number }
    Compatible with: float

11. paretoInt — Pareto-distributed integer. Params: { min?: number, max?: number, alpha?: number }
    Compatible with: integer

12. fullName — generates full name via faker.
    Compatible with: string

13. firstName, lastName — first/last name via faker.
    Compatible with: string

14. email — email address via faker.
    Compatible with: string

15. phone — phone number via faker.
    Compatible with: string

16. street, city, state, country, zip — address components via faker.
    Compatible with: string

17. url — URL via faker.
    Compatible with: string

18. ip — IP address via faker.
    Compatible with: string

19. imageUrl — image URL via faker.
    Compatible with: string

20. longText — long-form text via faker.
    Compatible with: string

21. sku — SKU string via faker.
    Compatible with: string

22. slug — URL slug via faker.
    Compatible with: string

23. quantity — small integer quantity via faker.
    Compatible with: integer

24. rating — small integer rating.
    Compatible with: integer

RULES:
- ONLY suggest generator kinds listed above. If none fits, use faker as generic fallback.
- For weighted-categorical on non-enum columns, you MUST provide explicit values weights.
- For boolean columns, use boolean or boolean-skewed.
- For uuid columns, use uuid.
- For string columns without specific semantics, use faker with an appropriate method.
- confidence should reflect how certain you are (0.0 = guessing, 1.0 = certain).
- reasoning must be exactly one sentence explaining the choice.
`;

const SYSTEM_INSTRUCTIONS = `You are a seed-data configuration assistant for SeedForge, a deterministic data-generation framework.

Your job: given a database column's metadata, propose the best generator configuration for that column.

SeedForge's config format:
- Each table gets an entry with \`fields\` mapping column names to generators.
- Each generator has: { kind: string, params: Record<string, unknown> }
- Example: { "kind": "weighted-categorical", "params": { "values": { "active": 0.7, "inactive": 0.3 } } }
- Example: { "kind": "email", "params": {} }

CRITICAL: The LLM is ONLY consulted at suggestion time. SeedForge's generate/seed path NEVER calls an LLM — it uses deterministic PRNGs. Your suggestions are REVIEWED by a human before being merged into the config.

${GENERATOR_CATALOGUE}

RESPONSE FORMAT — You MUST respond with a JSON object matching this schema:
{
  "suggestions": [
    {
      "table": string,
      "column": string,
      "semanticType": string,        // a descriptive label like "product_tier", "user_email", etc.
      "generatorSpec": {             // a valid generator from the catalogue above
        "kind": string,
        "params": object
      },
      "confidence": number,          // 0.0 to 1.0
      "reasoning": string            // exactly one sentence
    }
  ],
  "tableSuggestions": []             // optional business-rule ideas, see below
}

For the optional tableSuggestions array, you may propose whole-table business rules:
{
  "table": string,
  "statusDistributions"?: { "value1": 0.3, "value2": 0.7 },   // plausible status column weights
  "personaSuggestions"?: [                                       // persona ideas
    { "name": string, "selectionWeight": number, "overrides": string[] }
  ],
  "reasoning": string
}

Only include tableSuggestions for tables the human explicitly asked about.
`;

export function buildSystemPrompt(): string {
  return SYSTEM_INSTRUCTIONS;
}

/**
 * Build the per-call user message blocks.
 * Schema-only context is the default. Samples are only included when explicitly opted in.
 */
export function buildUserMessages(
  unresolved: UnresolvedColumn[],
  includeSamples?: boolean,
  samples?: Record<string, string[]>,
): string[] {
  const blocks: string[] = [];
  const byTable = groupByTable(unresolved);

  for (const [tableName, columns] of Object.entries(byTable)) {
    let block = `## Table: ${tableName}\n\nColumns:\n`;

    for (const col of columns) {
      block += `- ${col.column}\n`;
      block += `  - logicalType: ${col.logicalType}\n`;
      block += `  - nativeType: ${col.nativeType}\n`;
      block += `  - nullable: ${col.nullable}\n`;
      if (col.isUnique) block += '  - UNIQUE\n';
      if (col.isPrimaryKey) block += '  - PRIMARY KEY\n';
      if (col.enumValues && col.enumValues.length > 0) {
        block += `  - enumValues: [${col.enumValues.join(', ')}]\n`;
      }
      if (col.maxLength) block += `  - maxLength: ${col.maxLength}\n`;
      if (col.comment) block += `  - comment: ${col.comment}\n`;
      block += `  - siblingColumns: [${col.siblingColumns.join(', ')}]\n`;

      if (includeSamples && samples) {
        const key = `${tableName}.${col.column}`;
        const vals = samples[key];
        if (vals && vals.length > 0) {
          block += `  - observed distinct values: [${vals.map((v) => JSON.stringify(v)).join(', ')}]\n`;
        }
      }
    }

    blocks.push(block);
  }

  return blocks;
}

function groupByTable(columns: UnresolvedColumn[]): Record<string, UnresolvedColumn[]> {
  const map: Record<string, UnresolvedColumn[]> = {};
  for (const col of columns) {
    if (!map[col.table]) map[col.table] = [];
    map[col.table].push(col);
  }
  return map;
}

// ─── Describe prompts ─────────────────────────────────────────────────

const DESCRIBE_SYSTEM_INSTRUCTIONS = `You are a seed-data configuration assistant for SeedForge, a deterministic data-generation framework.

Your job: given a database schema, the user's plain-English description of the dataset they want, and the already-resolved column generators (for context — don't re-derive them), produce a complete config draft.

SeedForge config format:
- Each table gets an entry with optional count, countPerParent, timeline, churn, and personas.
- count: number of rows for a root table.
- countPerParent: for child tables, how many child rows per parent row (e.g. {"users": 5} means 5 rows per user).
- timeline: time horizon for data. { start: "2024-01-01", end?: "2025-12-31", growth: {...}, seasonality?: {...} }
  Growth models:
  - compound: { type: "compound", monthlyRate: 0.15 } — exponential growth (15% more each month)
  - linear: { type: "linear", totalGrowth: 4.0 } — linear growth reaching 4x by the end
  - scurve: { type: "scurve", inflectionPoint?: 0.5, steepness?: 5 } — S-curve (slow-fast-slow)
  Seasonality preset: { type: "preset", name: "ecommerce-holiday" } — boosts Nov/Dec order volume.
- churn: { monthlyRate: 0.05 } — 5% of users per month go inactive.
- Personas: groups with selectionWeight and field overrides.
  Example: { name: "enterprise", selectionWeight: 0.2, overrides: ["tier: enterprise"], cascades: { "orders": 0.3 } }
  cascades reduce child row count for this persona (e.g. enterprise users place fewer orders).

CRITICAL: The LLM is ONLY consulted at suggestion time. SeedForge's generate/seed path NEVER calls an LLM — it uses deterministic PRNGs. Your suggestions are REVIEWED by a human before being merged into the config.

Do NOT re-suggest column-level generators for columns that already have resolved generators in the context below. Only propose whole-table config (count, timeline, personas, churn).

RESPONSE FORMAT — You MUST respond with a JSON object matching this schema:
{
  "tables": {
    "[table_name]": {
      "count": number,
      "countPerParent": { "[parent_table]": number },
      "timeline": {
        "start": "2024-01-01",
        "end": "2025-12-31",
        "growth": { "type": "compound", "monthlyRate": 0.15 },
        "seasonality": { "type": "preset", "name": "ecommerce-holiday" }
      },
      "churn": { "monthlyRate": 0.05 },
      "personas": [
        { "name": "enterprise", "selectionWeight": 0.2, "overrides": ["col: value"], "cascades": { "orders": 0.3 } }
      ]
    }
  },
  "reasoning": "Explain the key decisions made."
}

RULES:
- Only include tables where you have a suggestion. Omit tables that should use defaults.
- timeline should be set on root/entity tables (users, organizations) when the description implies a time horizon.
- churn should be set when the description mentions churn, retention, or inactivity.
- Persona overrides reference column:value pairs like "tier: enterprise" or "plan: free".
- Persona cascades reference child table names. The value (0.0-1.0) is a multiplier on child row count.
- countPerParent values should reference actual FK parent tables from the schema.
- Be specific with numbers but they don't need to be exact — directionally plausible is fine.
- The reasoning field must explain the key design decisions in 2-3 sentences.
`;

export function buildDescribeSystemPrompt(): string {
  return DESCRIBE_SYSTEM_INSTRUCTIONS;
}

export function buildDescribeUserMessages(
  schemaDescription: string,
  resolvedColumns: string,
  graphEdges: string,
  description: string,
): string[] {
  const blocks: string[] = [];

  let schemaBlock = '## Database Schema\n\n';
  schemaBlock += schemaDescription;
  schemaBlock += '\n\n## Already-Resolved Columns (do NOT re-derive)\n\n';
  schemaBlock += resolvedColumns || '(none — all columns still need suggestions)';
  schemaBlock += '\n\n## Relationship Graph\n\n';
  schemaBlock += graphEdges || '(empty — no FK relationships detected)';
  blocks.push(schemaBlock);

  blocks.push(`## User Description\n\n${description}`);

  return blocks;
}
