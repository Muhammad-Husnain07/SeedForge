import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { introspect, write } from '@seed-forge/adapter-postgres';
import { withSeed } from '@seed-forge/testing';
import { seedConfig } from './seedConfig.js';

describe('determinism', () => {
  it('produces identical data with the same seed across two seed cycles', async () => {
    const connStr = process.env.DATABASE_URL!;
    const connectConfig = { dialect: 'postgres' as const, connectionString: connStr };
    const adapter = { introspect, write };

    // First seed cycle: seed with seed=42, capture all rows
    const data1 = await withSeed(adapter, connectConfig, seedConfig, { seed: 42, mode: 'fresh' }, async () => {
      const pool = new pg.Pool({ connectionString: connStr });
      try {
        const tables = (await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
        )).rows.map((r: { tablename: string }) => r.tablename);
        const allData: Record<string, unknown[][]> = {};
        for (const t of tables) {
          const res = await pool.query(`SELECT * FROM "${t}" ORDER BY "${t === 'product_tags' ? 'product_id' : 'id'}"`);
          allData[t] = res.rows.map(r => Object.values(r));
        }
        return allData;
      } finally {
        await pool.end();
      }
    });

    // Second seed cycle: same seed=42, capture all rows again
    const data2 = await withSeed(adapter, connectConfig, seedConfig, { seed: 42, mode: 'fresh' }, async () => {
      const pool = new pg.Pool({ connectionString: connStr });
      try {
        const tables = (await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
        )).rows.map((r: { tablename: string }) => r.tablename);
        const allData: Record<string, unknown[][]> = {};
        for (const t of tables) {
          const res = await pool.query(`SELECT * FROM "${t}" ORDER BY "${t === 'product_tags' ? 'product_id' : 'id'}"`);
          allData[t] = res.rows.map(r => Object.values(r));
        }
        return allData;
      } finally {
        await pool.end();
      }
    });

    // Both cycles must produce byte-identical data
    const keys1 = Object.keys(data1).sort();
    const keys2 = Object.keys(data2).sort();
    expect(keys1).toEqual(keys2);
    for (const table of keys1) {
      expect(data1[table]).toEqual(data2[table]);
    }
  }, 60_000);
});
