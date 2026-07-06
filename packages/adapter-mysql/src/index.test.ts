import { describe, it, expect } from 'vitest';
import { name } from './index.js';

describe('@seed-forge/adapter-mysql', () => {
  it('should export its name', () => {
    expect(name).toBe('@seed-forge/adapter-mysql');
  });
});
