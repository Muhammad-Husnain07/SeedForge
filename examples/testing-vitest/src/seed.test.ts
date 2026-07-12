import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { introspect, write } from '@seed-forge/adapter-postgres';
import { seedForgeSetup } from '@seed-forge/testing/vitest';
import { seedConfig } from './seedConfig.js';

seedForgeSetup({
  adapter: { introspect, write },
  connectConfig: {
    dialect: 'postgres',
    connectionString: process.env.DATABASE_URL!,
  },
  seedConfig,
  scope: 'file',
  seed: 42,
});

const TABLES = ['users', 'products', 'tags', 'product_tags', 'orders', 'order_items', 'reviews'];

describe('e-commerce fixture', () => {
  it('seeds all 7 tables with rows', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
    try {
      for (const table of TABLES) {
        const res = await pool.query(`SELECT COUNT(*) AS cnt FROM "${table}"`);
        const count = parseInt(res.rows[0]?.cnt ?? '0', 10);
        expect(count).toBeGreaterThan(0);
      }
    } finally {
      await pool.end();
    }
  });

  it('has no FK orphans', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
    try {
      const res = await pool.query(`
        SELECT COUNT(*) AS orphans FROM "users" u
        WHERE u."referred_by" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "users" p WHERE p."id" = u."referred_by")
      `);
      expect(parseInt(res.rows[0]?.orphans ?? '0', 10)).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
