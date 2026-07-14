import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isAuthEnabled(): boolean {
  return !!process.env.SEEDFORGE_STUDIO_TOKEN;
}

export function getExpectedHash(): string | null {
  const token = process.env.SEEDFORGE_STUDIO_TOKEN;
  return token ? hashToken(token) : null;
}

class AuthError extends Error {
  statusCode = 401;
}

export function registerAuthHook(server: FastifyInstance): void {
  const expectedHash = getExpectedHash();
  if (!expectedHash) return;

  // eslint-disable-next-line @typescript-eslint/require-await
  server.addHook('onRequest', async (request: FastifyRequest) => {
    if (request.url === '/api/health') return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('Missing or invalid Authorization header');
    }
    const provided = authHeader.slice(7);
    const providedHash = hashToken(provided);
    if (providedHash !== expectedHash) {
      throw new AuthError('Invalid authentication token');
    }
  });
}
