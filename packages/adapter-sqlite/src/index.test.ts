import { describe, it, expect } from 'vitest';

describe('@seed-forge/adapter-sqlite', () => {
  it('should export name, introspect, write, sample', async () => {
    const mod = await import('./index.js');
    expect(mod.name).toBe('@seed-forge/adapter-sqlite');
    expect(typeof mod.introspect).toBe('function');
    expect(typeof mod.write).toBe('function');
    expect(typeof mod.sample).toBe('function');
  });
});
