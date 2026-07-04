import type { DatabaseSchema } from '../types/index.js';
import type { FieldSemanticMatch, AnalyzeSchemaOptions } from './types.js';
import { PRIORITIZED_RULES } from './registry.js';

export function analyzeSchema(
  schema: DatabaseSchema,
  options: AnalyzeSchemaOptions = {},
): FieldSemanticMatch[] {
  const threshold = options.confidenceThreshold ?? 0.6;
  const allTables = schema.tables;
  const matches: FieldSemanticMatch[] = [];

  for (const table of allTables) {
    for (const col of table.columns) {
      let best: FieldSemanticMatch | null = null;

      for (const rule of PRIORITIZED_RULES) {
        const result = rule.match(col, table, schema, allTables);
        if (result !== null) {
          if (result.confidence >= threshold) {
            best = {
              table: table.name,
              column: col.name,
              semanticType: result.semanticType,
              confidence: result.confidence,
              suggestedGenerator: result.generator,
              source: 'rule',
            };
          }
          break;
        }
      }

      if (best) {
        matches.push(best);
      } else {
        matches.push({
          table: table.name,
          column: col.name,
          semanticType: 'unresolved',
          confidence: 0,
          suggestedGenerator: { kind: 'unknown', params: {} },
          source: 'unresolved',
        });
      }
    }
  }

  return matches;
}
