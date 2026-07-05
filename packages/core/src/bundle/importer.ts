import { readBundle, readSnapshotDataStream, readConfigJson, readLockfileJson, cleanupBundle } from './unpack.js';
import { checkImportCompatibility } from './compare.js';
import type { ImportOptions, ImportResult } from './types.js';

export async function importBundle(options: ImportOptions): Promise<ImportResult> {
  const startTime = Date.now();
  const { tmpDir, manifest } = await readBundle(options.file);
  const rowsImported: Record<string, number> = {};

  try {
    const liveSchema = await options.introspect();
    const compat = checkImportCompatibility(
      manifest,
      liveSchema.schemaHash,
      liveSchema.tables,
    );

    if (compat.blocks.length > 0) {
      return {
        manifest,
        rowsImported,
        elapsedMs: Date.now() - startTime,
        schemaMatch: compat.schemaMatch,
        schemaWarnings: compat.warnings,
        blocked: true,
        blockedReason: compat.blocks.join('\n'),
      };
    }

    if (!options.force && compat.warnings.length > 0) {
      return {
        manifest,
        rowsImported,
        elapsedMs: Date.now() - startTime,
        schemaMatch: compat.schemaMatch,
        schemaWarnings: compat.warnings,
        blocked: true,
        blockedReason: 'Schema mismatch detected. Use --force to override.',
      };
    }

    if (manifest.hasSnapshot) {
      const tableNames = manifest.tableFiles.map((f) => f.replace(/\.ndjson\.gz$/, ''));
      for (const tableName of tableNames) {
        // Stream rows one by one instead of loading entire table into memory
        const batch: Record<string, unknown>[] = [];
        let count = 0;
        for await (const row of readSnapshotDataStream(tmpDir, tableName)) {
          batch.push(row);
          if (batch.length >= 1000) {
            count += await options.writeRows(tableName, batch);
            batch.length = 0;
          }
        }
        if (batch.length > 0) {
          count += await options.writeRows(tableName, batch);
        }
        rowsImported[tableName] = count;
      }
    } else {
      const lockfileJson = (await readLockfileJson(tmpDir)) as {
        seedValue: number;
      };
      const configJson = await readConfigJson(tmpDir);
      const seed = lockfileJson.seedValue;
      await options.replayGeneration?.(
        configJson as Record<string, unknown>,
        seed,
        (tableName: string, rows: Record<string, unknown>[]) =>
          options.writeRows(tableName, rows),
      );
    }

    return {
      manifest,
      rowsImported,
      elapsedMs: Date.now() - startTime,
      schemaMatch: compat.schemaMatch,
      schemaWarnings: compat.warnings,
      blocked: false,
    };
  } finally {
    await cleanupBundle(tmpDir);
  }
}
