#!/usr/bin/env node
/**
 * Generates docs/cli/reference.md from Commander's help output.
 * Run: node scripts/gen-cli-docs.mjs
 * Regenerate whenever CLI commands or options change.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Prevent the CLI from parsing our script args
process.env.VITEST = 'true';

const { program } = await import(pathToFileURL(resolve(root, 'packages/cli/dist/index.js')).href);

function collectCommandLines(cmd, depth) {
  const lines = [];
  const indent = '  '.repeat(depth);
  lines.push(`${indent}- \`${cmd.name()}\` — ${cmd.description()}`);
  for (const o of cmd.options) {
    const flags = o.flags.replace(/--/g, '\\-\\-');
    const desc = o.description || '';
    const def = o.defaultValue !== undefined ? ` (default: \`${JSON.stringify(o.defaultValue)}\`)` : '';
    lines.push(`${indent}  - \`${flags}\` ${desc}${def}`);
  }
  for (const sub of cmd.commands) {
    if (sub.name() === '*' || sub.name() === 'help') continue;
    lines.push(...collectCommandLines(sub, depth + 1));
  }
  return lines;
}

function helpText(cmd) {
  return cmd.helpInformation().trim();
}

async function main() {
  const lines = [
    '# CLI Reference',
    '',
    '> Auto-generated from `seedforge --help`. Do not edit by hand.',
    `> Regenerate with: \`node scripts/gen-cli-docs.mjs\``,
    `> Generated on: ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Usage',
    '',
    '```',
    'seedforge <command> [options]',
    '```',
    '',
    '## Global Options',
    '',
  ];

  for (const o of program.options) {
    const flags = o.flags.replace(/--/g, '\\-\\-');
    const desc = o.description || '';
    const def = o.defaultValue !== undefined ? ` (default: \`${JSON.stringify(o.defaultValue)}\`)` : '';
    lines.push(`- \`${flags}\` — ${desc}${def}`);
  }

  lines.push('');
  lines.push('## Commands');
  lines.push('');

  for (const cmd of program.commands) {
    if (cmd.name() === '*' || cmd.name() === 'help') continue;
    lines.push('');
    lines.push(`### \`seedforge ${cmd.name()}\``);
    lines.push('');
    lines.push('```');
    lines.push(helpText(cmd));
    lines.push('```');
  }

  lines.push('');

  const outPath = resolve(root, 'docs/cli/reference.md');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf-8');
  console.log(`Generated ${outPath}`);
}

await main();
