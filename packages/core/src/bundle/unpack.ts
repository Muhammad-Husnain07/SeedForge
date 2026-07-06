import { extract as tarExtract } from 'tar';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import type { BundleManifest } from './types.js';

export async function readBundle(
  bundlePath: string,
): Promise<{ tmpDir: string; manifest: BundleManifest }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfbundle-import-'));
  const resolvedPath = path.resolve(bundlePath);

  await tarExtract({
    file: resolvedPath,
    cwd: tmpDir,
    portable: true,
  });

  const manifestRaw = await fs.readFile(
    path.join(tmpDir, 'manifest.json'),
    'utf-8',
  );
  const manifest = JSON.parse(manifestRaw) as BundleManifest;

  return { tmpDir, manifest };
}

export async function readConfigJson(
  tmpDir: string,
): Promise<unknown> {
  const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

export async function readLockfileJson(
  tmpDir: string,
): Promise<unknown> {
  const raw = await fs.readFile(path.join(tmpDir, 'lockfile.json'), 'utf-8');
  return JSON.parse(raw);
}

export async function readSnapshotData(
  tmpDir: string,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  // Fallback: read all rows into memory (used by current importBundle)
  const rows: Record<string, unknown>[] = [];
  for await (const row of readSnapshotDataStream(tmpDir, tableName)) {
    rows.push(row);
  }
  return rows;
}

export async function* readSnapshotDataStream(
  tmpDir: string,
  tableName: string,
): AsyncGenerator<Record<string, unknown>> {
  const filePath = path.join(tmpDir, 'data', `${tableName}.ndjson.gz`);
  const gunzip = zlib.createGunzip();
  const sourceStream = fsSync.createReadStream(filePath).pipe(gunzip);
  const rl = readline.createInterface({ input: sourceStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      yield JSON.parse(trimmed);
    }
  }
}

export async function cleanupBundle(tmpDir: string): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
