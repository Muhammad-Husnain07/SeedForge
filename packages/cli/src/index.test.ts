import { describe, it, expect } from 'vitest';
import { program } from './index.js';

describe('@seedforge/cli', () => {
  it('exports a commander program', () => {
    expect(program).toBeDefined();
    expect(program.name()).toBe('seedforge');
  });

  it('has all 12 commands', () => {
    const commands = program.commands.map((c) => c.name()).sort();
    expect(commands).toEqual([
      'diff',
      'doctor',
      'export',
      'generate',
      'import',
      'init',
      'introspect',
      'reset',
      'seed',
      'studio',
      'suggest',
      'validate',
    ]);
  });

  it('export command requires --out flag', () => {
    const exportCmd = program.commands.find((c) => c.name() === 'export')!;
    const outOption = exportCmd.options.find((o) => o.long === '--out');
    expect(outOption).toBeDefined();
    expect(outOption!.required).toBe(true);
  });

  it('import command has <file> argument', () => {
    const importCmd = program.commands.find((c) => c.name() === 'import')!;
    const args = importCmd.registeredArguments ?? [];
    expect(args.length).toBeGreaterThan(0);
    expect(args[0]!.name()).toBe('file');
  });

  it('seed command has --mode option', () => {
    const seedCmd = program.commands.find((c) => c.name() === 'seed')!;
    const modeOption = seedCmd.options.find((o) => o.long === '--mode');
    expect(modeOption).toBeDefined();
  });

  it('generate command has --preview option', () => {
    const genCmd = program.commands.find((c) => c.name() === 'generate')!;
    const previewOption = genCmd.options.find((o) => o.long === '--preview');
    expect(previewOption).toBeDefined();
  });

  it('init command has --force option', () => {
    const initCmd = program.commands.find((c) => c.name() === 'init')!;
    const forceOption = initCmd.options.find((o) => o.long === '--force');
    expect(forceOption).toBeDefined();
  });

  it('doctor command has --config option', () => {
    const doctorCmd = program.commands.find((c) => c.name() === 'doctor')!;
    const configOption = doctorCmd.options.find((o) => o.long === '--config');
    expect(configOption).toBeDefined();
  });

  it('introspect command has --out option', () => {
    const introspectCmd = program.commands.find((c) => c.name() === 'introspect')!;
    const outOption = introspectCmd.options.find((o) => o.long === '--out');
    expect(outOption).toBeDefined();
  });
});