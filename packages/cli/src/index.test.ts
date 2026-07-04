import { describe, it, expect } from 'vitest';
import { name } from './index.js';

describe('@seedforge/cli', () => {
  it('should export its name', () => {
    expect(name).toBe('@seedforge/cli');
  });
});
