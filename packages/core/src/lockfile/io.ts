import fs from 'node:fs/promises';
import path from 'node:path';
import type { SeedForgeLockfile } from './types.js';

const LOCKFILE_NAME = 'seedforge.lock.json';

export function resolveLockfilePath(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.resolve(process.cwd(), LOCKFILE_NAME);
}

export async function readLockfile(
  customPath?: string,
): Promise<SeedForgeLockfile | null> {
  const filePath = resolveLockfilePath(customPath);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as SeedForgeLockfile;
  } catch {
    return null;
  }
}

export async function writeLockfile(
  lockfile: SeedForgeLockfile,
  customPath?: string,
): Promise<void> {
  const filePath = resolveLockfilePath(customPath);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const content = JSON.stringify(lockfile, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
}
