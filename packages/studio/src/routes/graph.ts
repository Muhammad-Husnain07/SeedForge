import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';

export function graphRoutes(server: FastifyInstance): void {
  server.get('/graph', () => {
    const ctx = getContext();
    return {
      nodes: ctx.graph.nodes,
      edges: ctx.graph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        type: e.type,
        foreignKey: {
          columns: e.foreignKey.columns,
          referencedTable: e.foreignKey.referencedTable,
          referencedColumns: e.foreignKey.referencedColumns,
        },
        viaJunctionTable: e.viaJunctionTable,
      })),
      levels: ctx.graph.levels,
      insertionOrder: ctx.graph.insertionOrder,
      cycles: ctx.graph.cycles,
    };
  });
}
