import { readLockfile } from '@seed-forge/core';
import { seedCommand } from './seed.js';

export async function resetCommand(_opts: Record<string, unknown>): Promise<void> {
  const lockfile = await readLockfile();
  if (!lockfile) {
    console.error('No lockfile found. Run `seedforge seed` first.');
    process.exit(1);
  }

  // Re-run seed with mode=truncate and the lockfile seed
  await seedCommand({
    mode: 'truncate',
    seed: String(lockfile.seedValue),
  });
}