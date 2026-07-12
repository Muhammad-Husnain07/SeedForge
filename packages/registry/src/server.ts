import Fastify from 'fastify';
import cors from '@fastify/cors';
import pg from 'pg';
import { createPool } from './db.js';
import { runMigrations, seedDemoToken } from './migrate.js';
import { authMiddleware } from './routes/auth.js';
import { profileRoutes } from './routes/profiles.js';

export interface RegistryOptions {
  port?: number;
  host?: string;
  databaseUrl?: string;
}

export async function createRegistry(opts: RegistryOptions = {}) {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL!;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool: pg.Pool = createPool(databaseUrl);
  await runMigrations(pool);
  await seedDemoToken(pool);

  const server = Fastify({ logger: true });
  server.decorate('pgPool', pool);

  await server.register(cors);

  // Public routes
  server.get('/health', () => ({ status: 'ok' }));

  // Auth-protected routes
  await server.register(authMiddleware);
  await server.register(profileRoutes, { prefix: '/api/v1/profiles' });

  return { server, pool };
}

export async function startRegistry(opts: RegistryOptions = {}) {
  const { server } = await createRegistry(opts);
  const port = opts.port ?? 3457;
  const host = opts.host ?? '0.0.0.0';
  await server.listen({ port, host });
  return server;
}
