import { describe, it, expect } from 'vitest';
import { name } from './index.js';

describe('@seedforge/adapter-mongodb', () => {
  it('should export its name', () => {
    expect(name).toBe('@seedforge/adapter-mongodb');
  });
});
