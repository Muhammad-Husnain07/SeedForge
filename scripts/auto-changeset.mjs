#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

async function getChangedPackages() {
  let lastTag;
  try {
    lastTag = execSync('git describe --tags --abbrev=0', { cwd: root, encoding: 'utf-8' }).trim();
  } catch {
    lastTag = execSync('git rev-list --max-parents=0 HEAD', { cwd: root, encoding: 'utf-8' }).trim();
  }

  const diff = execSync(`git diff --name-only ${lastTag}..HEAD`, { cwd: root, encoding: 'utf-8' }).trim();
  if (!diff) return [];

  const changedFiles = diff.split('\n');
  const changedDirs = new Set();

  for (const file of changedFiles) {
    const match = file.match(/^packages\/([^/]+)\//);
    if (match) changedDirs.add(match[1]);
  }

  const packagesDir = resolve(root, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!changedDirs.has(entry.name)) continue;
    try {
      const pkg = JSON.parse(
        await readFile(resolve(packagesDir, entry.name, 'package.json'), 'utf-8'),
      );
      if (pkg.private) continue;
      results.push(pkg.name);
    } catch { /* skip */ }
  }

  return results;
}

async function getExistingChangesets() {
  const changesetDir = resolve(root, '.changeset');
  const files = await readdir(changesetDir);
  return files.filter(f => f.endsWith('.md'));
}

async function main() {
  const packages = await getChangedPackages();

  if (packages.length === 0) {
    const existing = await getExistingChangesets();
    if (existing.length > 0) {
      console.log(`Using ${existing.length} existing changeset(s)`);
      return;
    }
    console.log('No packages changed and no existing changesets — nothing to publish');
    return;
  }

  const frontmatter = packages.map(name => `"${name}": patch`).join('\n');
  const changeset = `---\n${frontmatter}\n---\n\nAuto-generated patch release\n`;

  const name = Date.now().toString(36);
  const outPath = resolve(root, '.changeset', `${name}.md`);
  await writeFile(outPath, changeset, 'utf-8');
  console.log(`Created changeset for: ${packages.join(', ')}`);
}

await main();
