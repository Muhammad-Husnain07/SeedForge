import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

let tmpDir: string;
let server: FastifyInstance;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sf-studio-test-'));
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'index.html'), '<html><body>SeedForge Studio</body></html>');
  writeFileSync(join(tmpDir, '..', 'secret.json'), '{"password":"hunter2"}');
  server = await buildServer({ staticRoot: tmpDir });
  await server.ready();
}, 15_000);

afterAll(async () => {
  if (server) await server.close();
  try { unlinkSync(join(tmpDir, 'index.html')); } catch { /* ignore */ }
  try { unlinkSync(join(tmpDir, '..', 'secret.json')); } catch { /* ignore */ }
  try { rmdirSync(tmpDir); } catch { /* ignore */ }
});

describe('@fastify/static path traversal prevention', () => {
  const traversalPayloads = [
    '/../secret.json',
    '/..%2fsecret.json',
    '/%2e%2e%2fsecret.json',
  ];

  for (const payload of traversalPayloads) {
    it(`does not leak secret files via: ${payload}`, async () => {
      const res = await server.inject({ method: 'GET', url: payload });
      expect(res.body).not.toContain('password');
      expect(res.body).not.toContain('hunter2');
      // SPA fallback serves index.html instead of the traversed file
      expect(res.body).toContain('SeedForge Studio');
    });
  }

  it('serves the index.html for root', async () => {
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SeedForge Studio');
  });
});

describe('auth', () => {
  it('returns 401 without a token when auth is enabled', async () => {
    process.env.SEEDFORGE_STUDIO_TOKEN = 'test-token-123';
    const authServer = await buildServer({});
    await authServer.ready();
    const res = await authServer.inject({ method: 'GET', url: '/api/graph' });
    expect(res.statusCode).toBe(401);
    await authServer.close();
  });

  it('returns 200 with a valid Bearer token on health', async () => {
    process.env.SEEDFORGE_STUDIO_TOKEN = 'test-token-123';
    const authServer = await buildServer({});
    await authServer.ready();
    const res = await authServer.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: 'Bearer test-token-123' },
    });
    expect(res.statusCode).toBe(200);
    await authServer.close();
  });

  it('returns 401 with an invalid token on a non-health route', async () => {
    process.env.SEEDFORGE_STUDIO_TOKEN = 'test-token-456';
    const authServer = await buildServer({});
    await authServer.ready();
    const res = await authServer.inject({
      method: 'GET',
      url: '/api/graph',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    await authServer.close();
  });

  it('allows requests without a token when auth is disabled', async () => {
    delete process.env.SEEDFORGE_STUDIO_TOKEN;
    const noAuthServer = await buildServer({});
    await noAuthServer.ready();
    const res = await noAuthServer.inject({ method: 'GET', url: '/api/graph' });
    expect(res.statusCode).toBe(500); // context not initialized — auth didn't block
    await noAuthServer.close();
  });

  it('allows health without auth even when auth is enabled', async () => {
    process.env.SEEDFORGE_STUDIO_TOKEN = 'test-token-123';
    const authServer = await buildServer({});
    await authServer.ready();
    const res = await authServer.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    await authServer.close();
  });

  it('rejects missing Bearer prefix', async () => {
    process.env.SEEDFORGE_STUDIO_TOKEN = 'test-token-123';
    const authServer = await buildServer({});
    await authServer.ready();
    const res = await authServer.inject({
      method: 'GET',
      url: '/api/graph',
      headers: { authorization: 'test-token-123' },
    });
    expect(res.statusCode).toBe(401);
    await authServer.close();
  });
});
