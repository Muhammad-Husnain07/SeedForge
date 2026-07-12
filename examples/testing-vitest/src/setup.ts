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
