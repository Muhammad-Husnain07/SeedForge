import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';

export function planRoutes(server: FastifyInstance): void {
  server.get('/plan', () => {
    const ctx = getContext();
    const plan = ctx.plan;
    return {
      previewRowCount: 10,
      tables: Object.fromEntries(
        Object.entries(plan.tables).map(([name, t]) => [
          name,
          {
            count: t.count,
            countPerParent: t.countPerParent,
            personaCount: t.personas.length,
            fieldCount: t.fields.length,
            fields: t.fields.map((f) => ({
              column: f.column,
              source: f.source,
              confidence: f.confidence,
              semanticType: f.semanticType as string | undefined,
              generator: f.generator,
            })),
            personas: t.personas.map((p) => ({
              name: p.name,
              selectionWeight: p.selectionWeight,
              overrideFieldCount: p.overrides.length,
              cascades: p.cascades,
            })),
          },
        ]),
      ),
    };
  });
}
