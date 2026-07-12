import os from 'node:os';
import path from 'node:path';
import { readLockfile, computeConfigHash } from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { readRegistryConfig, registryFetch } from '../utils/registry.js';
import { isJsonMode, printJson, printSuccess, printError } from '../utils/format.js';

export interface PushOptions {
  profileName: string;
  version?: string;
  project?: string;
  config?: string;
  lockfile?: string;
}

export async function pushCommand(opts: PushOptions): Promise<void> {
  try {
    const registry = await readRegistryConfig();
    if (!registry) {
      throw new Error(
        'Not logged in. Run `seedforge login` first, or set SEEDFORGE_REGISTRY_URL and SEEDFORGE_REGISTRY_TOKEN env vars.',
      );
    }

    const lockfilePath = opts.lockfile;
    const lockfile = await readLockfile(lockfilePath);
    if (!lockfile) {
      throw new Error('No lockfile found. Run seed generation first.');
    }

    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);

    const configHash = computeConfigHash(config);

    // Resolve project: --project flag, or directory name of CWD
    const project = opts.project ?? path.basename(process.cwd());
    const version = opts.version ?? 'latest';

    // Build manifest (mirrors exportBundle logic)
    const totalRows = Object.values(lockfile.perTableRowCounts).reduce((a, b) => a + b, 0);
    function getUsername(): string {
      try {
        return os.userInfo().username;
      } catch {
        return process.env.USER ?? process.env.USERNAME ?? 'unknown';
      }
    }
    const manifest = {
      seedforgeVersion: lockfile.seedforgeVersion,
      createdAt: new Date().toISOString(),
      createdBy: getUsername(),
      schemaHash: lockfile.schemaHash,
      configHash,
      seedValue: lockfile.seedValue,
      perTableRowCounts: lockfile.perTableRowCounts,
      hasSnapshot: false,
      tableFiles: [] as string[],
      totalRows,
    };

    const body = {
      name: opts.profileName,
      version,
      manifest,
      config: { connection: connectConfig, tables: config.tables ?? {} },
      lockfile,
    };

    const res = await registryFetch(
      registry.registryUrl,
      registry.apiToken,
      `/api/v1/profiles/org/${encodeURIComponent(project)}`,
      { method: 'POST', body },
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText })) as Record<string, unknown>;
      throw new Error(`Push failed (HTTP ${res.status}): ${(errBody as { error?: string }).error ?? res.statusText}`);
    }

    const result = await res.json() as { id: string; name: string; version: string };

    if (isJsonMode()) {
      printJson(result);
    } else {
      printSuccess(`Pushed ${opts.profileName}@${version} (${result.id})`);
    }
  } catch (err) {
    printError(`Push failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
