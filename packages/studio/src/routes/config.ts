import type { FastifyInstance } from 'fastify';
import { getContext, rebuildPlan } from '../context.js';
import { eventBus } from '../events.js';

export function configRoutes(server: FastifyInstance): void {
  server.get('/config', () => {
    const ctx = getContext();
    return ctx.config;
  });

  server.put<{ Body: Record<string, unknown> }>('/config', (req) => {
    const ctx = getContext();
    const patch = req.body as { tables?: Record<string, unknown> };
    ctx.config.tables = { ...ctx.config.tables, ...(patch.tables ?? {}) } as typeof ctx.config.tables;
    rebuildPlan();
    eventBus.emit('config-changed', { tables: ctx.config.tables });
    eventBus.emit('preview', { trigger: 'config-changed', plan: ctx.plan });
    return ctx.config;
  });
}
