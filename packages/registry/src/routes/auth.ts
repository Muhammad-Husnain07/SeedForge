import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type pg from 'pg';
import { queryTokenByHash } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    pgPool: pg.Pool;
  }
  interface FastifyRequest {
    authOrg?: string;
  }
}

export async function authMiddleware(
  server: FastifyInstance,
  _opts: unknown,
): Promise<void> {
  server.decorateRequest('authOrg', undefined);

  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    const token = authHeader.slice(7);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await queryTokenByHash(server.pgPool, hash);
    if (!row) {
      reply.status(401).send({ error: 'Invalid API token' });
      return;
    }
    request.authOrg = row.org;
  });
}
