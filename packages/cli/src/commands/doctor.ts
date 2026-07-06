import fs from 'node:fs/promises';
import path from 'node:path';
import { readLockfile, resolveLockfilePath, validateConfig } from '@seed-forge/core';
import { loadConfig, inferConnectConfig } from '../utils/config.js';
import { registerAdapters } from '../utils/adapters.js';
import { isJsonMode, printJson, renderDoctorReport, printHeading } from '../utils/format.js';

export async function doctorCommand(opts: { config?: string }): Promise<void> {
  const checks: { name: string; status: 'pass' | 'fail' | 'warn'; message: string }[] = [];
  const configPath = path.resolve(opts.config ?? 'seedforge.config.ts');

  // Check 1: Config file exists
  let configExists = false;
  try {
    await fs.access(configPath);
    configExists = true;
    checks.push({ name: 'Config file', status: 'pass', message: `Found at ${configPath}` });
  } catch {
    checks.push({ name: 'Config file', status: 'fail', message: `Not found at ${configPath}` });
  }

  // Check 2: Config is valid
  if (configExists) {
    try {
      const config = await loadConfig(opts.config);
      const issues = validateConfig(config);
      if (issues.length > 0) {
        checks.push({
          name: 'Config validation',
          status: 'warn',
          message: `${issues.length} issue(s): ${issues.map((i: { message: string }) => i.message).join('; ')}`,
        });
      } else {
        checks.push({ name: 'Config validation', status: 'pass', message: 'Config is valid' });
      }
    } catch (err) {
      checks.push({ name: 'Config validation', status: 'fail', message: `Parse error: ${(err as Error).message}` });
    }
  }

  // Check 3: Database connection
  if (configExists) {
    try {
      const config = await loadConfig(opts.config);
      const connectConfig = inferConnectConfig(config);
      await registerAdapters(connectConfig.dialect);

      const { introspect } = await import('@seed-forge/core');
      const schema = await introspect(connectConfig);
      checks.push({
        name: 'Database connection',
        status: 'pass',
        message: `Connected to ${connectConfig.dialect} (${schema.tables.length} tables)`,
      });
    } catch (err) {
      checks.push({ name: 'Database connection', status: 'fail', message: (err as Error).message });
    }
  }

  // Check 4: Lockfile
  const lockfilePath = resolveLockfilePath();
  try {
    await fs.access(lockfilePath);
    const lockfile = await readLockfile();
    if (lockfile) {
      const lockfileAge = Date.now() - new Date(lockfile.generatedAt).getTime();
      const ageHours = Math.round(lockfileAge / 3600000);
      checks.push({
        name: 'Lockfile',
        status: 'pass',
        message: `Found (seed=${lockfile.seedValue}, ${ageHours}h old, ${Object.keys(lockfile.perTableRowCounts).length} tables)`,
      });
    } else {
      checks.push({ name: 'Lockfile', status: 'warn', message: 'Exists but unparseable' });
    }
  } catch {
    checks.push({ name: 'Lockfile', status: 'warn', message: 'Not found. Run seed to create one.' });
  }

  if (isJsonMode()) {
    printJson({ checks });
    return;
  }

  printHeading('SeedForge Doctor Report');
  console.log('');
  console.log(renderDoctorReport(checks));

  const failures = checks.filter((c) => c.status === 'fail').length;
  if (failures > 0) process.exit(1);
}