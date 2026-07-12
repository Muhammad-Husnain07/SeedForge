import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { insertProfile, fetchProfile, listProfiles } from '../db.js';

interface PublishBody {
  name: string;
  version?: string;
  manifest: unknown;
  config: unknown;
  lockfile: unknown;
}

export function profileRoutes(
  server: FastifyInstance,
  _opts: unknown,
): void {
  server.post<{ Body: PublishBody; Params: { project: string } }>(
    '/org/:project',
    async (request: FastifyRequest<{ Body: PublishBody; Params: { project: string } }>, reply: FastifyReply) => {
      const org = request.authOrg!;
      const { project } = request.params;
      const { name, version, manifest, config, lockfile } = request.body;
      if (!name || !manifest || !config || !lockfile) {
        return reply.status(400).send({ error: 'name, manifest, config, and lockfile are required' });
      }
      const id = await insertProfile(server.pgPool, {
        org,
        project,
        name,
        version: version ?? 'latest',
        manifest,
        config,
        lockfile,
      });
      return reply.status(201).send({ id, org, project, name, version: version ?? 'latest' });
    },
  );

  server.get<{ Params: { org: string; project: string; name: string }; Querystring: { version?: string } }>(
    '/org/:org/:project/:name',
    async (request: FastifyRequest<{ Params: { org: string; project: string; name: string }; Querystring: { version?: string } }>, reply: FastifyReply) => {
      const { org, project, name } = request.params;
      const version = request.query.version;
      const row = await fetchProfile(server.pgPool, org, project, name, version);
      if (!row) {
        return reply.status(404).send({ error: 'Profile not found' });
      }
      return reply.send(row);
    },
  );

  server.get<{ Params: { org: string; project: string } }>(
    '/org/:org/:project',
    async (request: FastifyRequest<{ Params: { org: string; project: string } }>, reply: FastifyReply) => {
      const { org, project } = request.params;
      const rows = await listProfiles(server.pgPool, org, project);
      return reply.send(rows);
    },
  );
}
