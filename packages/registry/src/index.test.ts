import { describe, it, expect } from 'vitest';

describe('@seed-forge/registry', () => {
  it('exports DB utilities (createPool, insertProfile, fetchProfile, listProfiles, runMigrations)', async () => {
    const mod = await import('./db.js');
    expect(typeof mod.createPool).toBe('function');
    expect(typeof mod.insertProfile).toBe('function');
    expect(typeof mod.fetchProfile).toBe('function');
    expect(typeof mod.listProfiles).toBe('function');
  });

  it('exports runMigrations and seedDemoToken', async () => {
    const mod = await import('./migrate.js');
    expect(typeof mod.runMigrations).toBe('function');
    expect(typeof mod.seedDemoToken).toBe('function');
  });
});
