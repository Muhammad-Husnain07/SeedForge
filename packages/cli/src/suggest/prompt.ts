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
