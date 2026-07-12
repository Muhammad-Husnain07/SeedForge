import { readLockfile, checkDrift, introspect, diffSchemas } from '@seed-forge/core';
import type { SchemaDiffEntry } from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { readRegistryConfig, registryFetch } from '../utils/registry.js';
import { isJsonMode, printJson, printError, printSuccess, printInfo, renderDiffTable } from '../utils/format.js';

export interface DiffOptions {
  config?: string;
  lockfile?: string;
  ci?: boolean;
  profile?: string; // org/project/name[:version]
  force?: boolean;
}

function parseProfileRef(ref: string): { org: string; project: string; name: string; version?: string } {
  const parts = ref.split('/');
  if (parts.length < 3) {
    throw new Error('Invalid profile format. Expected: <org>/<project>/<profile-name>[:version]');
  }
  const namePart = parts[parts.length - 1]!;
  const nameParts = namePart.split(':');
  const name = nameParts[0]!;
  const version = nameParts[1];
  const org = parts[0]!;
  const project = parts.slice(1, parts.length - 1).join('/');
  return { org, project, name, version };
}

function formatAnnotation(entry: SchemaDiffEntry, file = 'seedforge.config.ts'): string {
  const { type, table, column, detail } = entry;
  const col = column ?? '';
  const title = `Schema Drift: ${type}`;
  const msg = `${type}: table=${table}${col ? `, column=${col}` : ''} — ${detail}`;
  return `::error file=${file},line=1,title=${title}::${msg}`;
}

export async function diffCommand(opts: DiffOptions): Promise<void> {
  try {
    const config = await loadConfig(opts.config);
    const connectConfig = inferConnectConfig(config);

    // Fall back to lockfile schema dialect if config has no connection
    if (!connectConfig.dialect && !opts.profile) {
      const lfLockfile = await readLockfile(opts.lockfile);
      if (lfLockfile) {
        const lf = lfLockfile as unknown as Record<string, unknown>;
        if (lf.schema) {
          (connectConfig as Record<string, string | undefined>).dialect = (lf.schema as Record<string, string | undefined>).dialect;
        }
      }
    }

    await registerAdapters(connectConfig.dialect);
    const liveSchema = await introspect(connectConfig);

    if (opts.profile) {
      // Compare against a registry profile
      const registry = await readRegistryConfig();
      if (!registry) {
        throw new Error('Not logged in. Run `seedforge login` first, or set SEEDFORGE_REGISTRY_URL and SEEDFORGE_REGISTRY_TOKEN env vars.');
      }

      const { org, project, name, version } = parseProfileRef(opts.profile);
      let apiPath = `/api/v1/profiles/org/${encodeURIComponent(org)}/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
      if (version) {
        apiPath += `?version=${encodeURIComponent(version)}`;
      }

      const res = await registryFetch(registry.registryUrl, registry.apiToken, apiPath);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`Profile "${opts.profile}" not found in registry`);
        }
        throw new Error(`Profile fetch failed (HTTP ${res.status})`);
      }

      const profile = await res.json() as { manifest: { schemaHash: string }; lockfile: { schema: unknown } };
      const profileHash = profile.manifest.schemaHash;
      const liveHash = liveSchema.schemaHash;

      const driftDetected = liveHash !== profileHash;

      if (opts.ci) {
        // GitHub Actions annotation format
        if (driftDetected) {
          const entries: SchemaDiffEntry[] = [{
            type: 'column-type-changed',
            table: '(schema)',
            column: 'schemaHash',
            detail: `Live schema hash (${liveHash.slice(0, 16)}…) does not match profile hash (${profileHash.slice(0, 16)}…)`,
          }];
          for (const entry of entries) {
            console.log(formatAnnotation(entry));
          }
          process.exit(1);
        } else {
          process.exit(0);
        }
      } else {
        if (driftDetected) {
          printError(`Schema drift detected against profile "${opts.profile}"`);
          printInfo(`  Profile hash: ${profileHash.slice(0, 16)}…`);
          printInfo(`  Live hash:    ${liveHash.slice(0, 16)}…`);

          // Attempt detailed diff if lockfile has schema snapshot
          if (profile.lockfile?.schema) {
            const oldSchema = profile.lockfile.schema as Parameters<typeof diffSchemas>[0];
            const diff = diffSchemas(oldSchema, liveSchema);
            if (diff.hasDrift) {
              console.log(renderDiffTable(diff.entries));
            }
          }

          if (!opts.force) {
            process.exit(1);
          }
          printInfo('Proceeding with --force.');
        } else {
          printSuccess('No schema drift detected against profile.');
        }
      }
    } else {
      // Compare against local lockfile (existing behavior)
      const lockfilePath = opts.lockfile;
      const lockfile = await readLockfile(lockfilePath);

      if (!lockfile) {
        if (isJsonMode()) {
          printJson({ error: true, message: 'No lockfile found. Run seed generation first.' });
        } else {
          printError('No lockfile found. Run seed generation first.');
        }
        process.exit(1);
      }

      const result = await checkDrift(config, liveSchema, { lockfilePath, force: !!opts.force });

      if (opts.ci) {
        if (!result.canProceed && result.diff) {
          for (const entry of result.diff.entries) {
            console.log(formatAnnotation(entry));
          }
          process.exit(1);
        }
        process.exit(0);
      }

      if (isJsonMode()) {
        printJson(result);
        return;
      }

      if (result.canProceed && !result.diff) {
        printSuccess('No schema drift detected.');
        process.exit(0);
      } else if (result.canProceed && result.diff) {
        console.log(renderDiffTable(result.diff.entries));
        console.log('');
        printInfo('Schema drift acknowledged — proceeding with --force.');
        process.exit(0);
      } else {
        console.log(renderDiffTable(result.diff!.entries));
        console.log('');
        printError('Schema drift detected. Use --force to proceed, or acknowledge the drift.');
        process.exit(1);
      }
    }
  } catch (err) {
    printError(`Diff check failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
