import { create as tarCreate } from 'tar';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import type { BundleManifest, ExportOptions } from './types.js';
import type { GenerationBatch } from '../generate/types.js';

function getUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? 'unknown';
  }
}

async function writeGzipNdjsonStream(
  rows: Record<string, unknown>[] | AsyncIterable<GenerationBatch>,
  filePath: string,
  tableName: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const gzip = zlib.createGzip();
    const outStream = fsSync.createWriteStream(filePath);
    gzip.pipe(outStream);

    let count = 0;

    const writeRow = (row: Record<string, unknown>) => {
      const ok = gzip.write(JSON.stringify(row) + '\n');
      if (ok) {
        count++;
        return true;
      }
      return false;
    };

    void (async () => {
      try {
        if (Array.isArray(rows)) {
          for (const row of rows) {
            writeRow(row);
          }
        } else {
          for await (const batch of rows) {
            if (batch.table === tableName && batch.phase === 'insert') {
              for (const row of batch.rows) {
                writeRow(row);
              }
            }
          }
        }
        gzip.end();
      } catch (err) {
        gzip.destroy(err as Error);
      }
    })();



    outStream.on('finish', () => resolve(count));
    outStream.on('error', reject);
    gzip.on('error', reject);
  });
}

export async function exportBundle(options: ExportOptions): Promise<string> {
  const { out, snapshot, config, lockfile, tableData } = options;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfbundle-'));
  const dataDir = path.join(tmpDir, 'data');

  try {
    // Write config
    await fs.writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );

    // Write lockfile
    await fs.writeFile(
      path.join(tmpDir, 'lockfile.json'),
      JSON.stringify(lockfile, null, 2),
      'utf-8',
    );

    // Build manifest
    const tableFiles: string[] = [];
    let totalRows = 0;

    if (snapshot && tableData) {
      await fs.mkdir(dataDir, { recursive: true });

      if (Array.isArray(tableData)) {
        // tableData is an AsyncIterable<GenerationBatch> — group by table and stream
        const tableCounts: Record<string, number> = {};
        for await (const batch of tableData as AsyncIterable<GenerationBatch>) {
          if (batch.phase !== 'insert') continue;
          if (!tableCounts[batch.table]) {
            tableCounts[batch.table] = 0;
            tableFiles.push(`${batch.table}.ndjson.gz`);
          }
        }
        for (const tableName of Object.keys(tableCounts)) {
          const filename = `${tableName}.ndjson.gz`;
          const count = await writeGzipNdjsonStream(tableData, path.join(dataDir, filename), tableName);
          totalRows += count;
        }
      } else {
        for (const [tableName, rows] of Object.entries(tableData as Record<string, Record<string, unknown>[]>)) {
          const filename = `${tableName}.ndjson.gz`;
          const count = await writeGzipNdjsonStream(rows, path.join(dataDir, filename), tableName);
          tableFiles.push(filename);
          totalRows += count;
        }
      }
    } else {
      for (const count of Object.values(lockfile.perTableRowCounts)) {
        totalRows += count;
      }
    }

    const manifest: BundleManifest = {
      seedforgeVersion: lockfile.seedforgeVersion,
      createdAt: new Date().toISOString(),
      createdBy: getUsername(),
      schemaHash: lockfile.schemaHash,
      configHash: lockfile.configHash,
      seedValue: lockfile.seedValue,
      perTableRowCounts: lockfile.perTableRowCounts,
      hasSnapshot: !!snapshot,
      tableFiles,
      totalRows,
    };

    await fs.writeFile(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    // Create tar+gzip bundle
    const entries = ['manifest.json', 'config.json', 'lockfile.json'];
    if (snapshot && tableFiles.length > 0) {
      entries.push(...tableFiles.map((f) => path.join('data', f)));
    }

    await tarCreate(
      {
        gzip: true,
        file: path.resolve(out),
        cwd: tmpDir,
        portable: true,
      },
      entries,
    );

    return path.resolve(out);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
