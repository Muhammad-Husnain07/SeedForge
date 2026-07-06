import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaRoutes } from './routes/schema.js';
import { graphRoutes } from './routes/graph.js';
import { configRoutes } from './routes/config.js';
import { planRoutes } from './routes/plan.js';
import { eventsRoutes } from './routes/events.js';
import { seedRoutes } from './routes/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  configPath?: string;
}

export async function buildServer(_opts: ServerOptions = {}): ReturnType<typeof Fastify> {
  const server = Fastify({ logger: false });

  await server.register(cors, { origin: true });

  // Serve built frontend if it exists (production), or proxy to Vite dev server (dev)
  const clientDist = path.resolve(__dirname, '../client/dist');
  const clientIndex = path.resolve(clientDist, 'index.html');
  try {
    await import('fs/promises').then((fs) => fs.access(clientIndex));
    await server.register(staticFiles, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback
    server.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  } catch {
    // In dev, Vite handles frontend; API-only mode with CORS
    console.error('[studio] Frontend not built — serving API only on /api/*');
    console.error('[studio] Run `cd client && npx vite` for the frontend dev server');
  }

  // API routes
  await server.register(schemaRoutes, { prefix: '/api' });
  await server.register(graphRoutes, { prefix: '/api' });
  await server.register(configRoutes, { prefix: '/api' });
  await server.register(planRoutes, { prefix: '/api' });
  await server.register(eventsRoutes, { prefix: '/api' });
  await server.register(seedRoutes, { prefix: '/api' });

  // Health check
  server.get('/api/health', () => ({ status: 'ok' }));

  return server;
}
