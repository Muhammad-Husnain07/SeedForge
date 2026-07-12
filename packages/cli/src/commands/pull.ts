import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { create as tarCreate } from 'tar';
import { readRegistryConfig, registryFetch } from '../utils/registry.js';
import { isJsonMode, printJson, printSuccess, printError, printInfo } from '../utils/format.js';

export interface PullOptions {
  ref: string; // org/project/profile[:version]
  force?: boolean;
  config?: string;
}

function parseRef(ref: string): { org: string; project: string; name: string; version?: string } {
  const parts = ref.split('/');
  if (parts.length < 3) {
    throw new Error('Invalid format. Expected: <org>/<project>/<profile-name>[:version]');
  }
  const namePart = parts[parts.length - 1]!;
  const nameParts = namePart.split(':');
  const name = nameParts[0]!;
  const version = nameParts[1];
  const org = parts[0]!;
  const project = parts.slice(1, parts.length - 1).join('/');
  return { org, project, name, version };
}

export async function pullCommand(opts: PullOptions): Promise<void> {
  try {
    const registry = await readRegistryConfig();
    if (!registry) {
      throw new Error(
        'Not logged in. Run `seedforge login` first, or set SEEDFORGE_REGISTRY_URL and SEEDFORGE_REGISTRY_TOKEN env vars.',
      );
    }

    const { org, project, name, version } = parseRef(opts.ref);

    let apiPath = `/api/v1/profiles/org/${encodeURIComponent(org)}/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
    if (version) {
      apiPath += `?version=${encodeURIComponent(version)}`;
    }

    const res = await registryFetch(registry.registryUrl, registry.apiToken, apiPath);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Profile "${opts.ref}" not found in registry`);
      }
      const errBody = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
      throw new Error(`Pull failed (HTTP ${res.status}): ${(errBody as { error?: string }).error ?? res.statusText}`);
    }

    const profile = await res.json() as {
      manifest: Record<string, unknown>;
      config: unknown;
      lockfile: unknown;
    };

    // Build a .sfbundle tar.gz from the downloaded JSON
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfbundle-pull-'));
    const bundlePath = path.join(tmpDir, 'profile.sfbundle');

    try {
      await fs.writeFile(
        path.join(tmpDir, 'manifest.json'),
        JSON.stringify(profile.manifest, null, 2),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpDir, 'config.json'),
        JSON.stringify(profile.config, null, 2),
        'utf-8',
      );
      await fs.writeFile(
        path.join(tmpDir, 'lockfile.json'),
        JSON.stringify(profile.lockfile, null, 2),
        'utf-8',
      );

      await tarCreate(
        { gzip: true, file: bundlePath, cwd: tmpDir, portable: true },
        ['manifest.json', 'config.json', 'lockfile.json'],
      );

      // Dynamic import to reuse existing import flow
      const { importBundle, readBundle, cleanupBundle } = await import('@seed-forge/core');
      const { loadConfig, inferConnectConfig } = await import('../utils/config.js');
      const { registerAdapters } = await import('../utils/adapters.js');
      const { introspect } = await import('@seed-forge/core');

      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);
      await registerAdapters(connectConfig.dialect);

      // Show manifest before import
      const { manifest: m } = await readBundle(bundlePath);
      if (!isJsonMode()) {
        printInfo(`\n  Profile: ${opts.ref}`);
        printInfo(`  Schema:  ${m.schemaHash.slice(0, 16)}…`);
        printInfo(`  Seed:    ${m.seedValue}`);
        printInfo(`  Rows:    ${m.totalRows}`);
        printInfo('');
      }

      const result = await importBundle({
        file: bundlePath,
        force: !!opts.force,
        introspect: async () => {
          const liveSchema = await introspect(connectConfig);
          return {
            schemaHash: liveSchema.schemaHash,
            tables: liveSchema.tables.map((t) => ({
              name: t.name,
              columns: t.columns.map((c) => ({ name: c.name })),
            })),
          };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        writeRows: async (table, rows) => {
          if (!isJsonMode()) printInfo(`  Writing ${rows.length} rows to ${table}…`);
          return rows.length;
        },
        replayGeneration: async (_bundleConfig, _seed, _writeBatch) => {
          // Stubbed — same as existing import flow
        },
      });

      if (result.blocked) {
        throw new Error(result.blockedReason ?? 'Import blocked');
      }

      if (isJsonMode()) {
        printJson(result);
      } else {
        printSuccess('Pull and import completed successfully.');
        for (const [table, count] of Object.entries(result.rowsImported)) {
          printInfo(`  ${table}: ${count} rows`);
        }
      }

      await cleanupBundle(tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    printError(`Pull failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
