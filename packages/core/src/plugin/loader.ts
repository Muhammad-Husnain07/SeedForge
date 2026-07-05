import type { SeedForgePlugin, GeneratorRegistry } from './types.js';
import { generatorRegistry } from './registry.js';
import type { DatabaseSchema } from '../types/index.js';
import type { GenerationPlan } from '../config/types.js';
import path from 'node:path';

export interface LoadedPlugin {
  plugin: SeedForgePlugin;
  source: string;
}

export interface PluginLoaderResult {
  plugins: LoadedPlugin[];
  hookGeneratorsRegistered: boolean;
  scanResults?: { name: string; path: string }[];
}

function validatePlugin(raw: unknown, source: string): SeedForgePlugin {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Plugin at '${source}' did not export a valid plugin object. Expected a SeedForgePlugin export.`);
  }

  const plugin = raw as Record<string, unknown>;

  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error(`Plugin at '${source}' is missing required 'name' field (string).`);
  }

  const hooks = ['onSchemaIntrospected', 'registerGenerators', 'beforeGenerate', 'afterGenerate', 'beforeInsert', 'afterInsert'];
  const hasHook = hooks.some((h) => typeof plugin[h] === 'function');

  if (!hasHook) {
    throw new Error(`Plugin '${plugin.name}' at '${source}' does not implement any SeedForgePlugin lifecycle hooks.`);
  }

  return plugin as unknown as SeedForgePlugin;
}

async function resolvePlugin(spec: string | { name: string; options?: Record<string, unknown> }): Promise<{ plugin: SeedForgePlugin; source: string; options?: Record<string, unknown> }> {
  const pkgName = typeof spec === 'string' ? spec : spec.name;
  const options = typeof spec === 'object' ? spec.options : undefined;

  let mod: Record<string, unknown>;
  let source: string;

  try {
    const resolvedPath = pkgName.startsWith('.') || pkgName.startsWith('/') || pkgName.startsWith('..')
      ? path.resolve(process.cwd(), pkgName)
      : pkgName;
    mod = await import(resolvedPath);
    source = pkgName;
  } catch (err) {
    throw new Error(`Failed to load plugin '${pkgName}': ${(err as Error).message}`);
  }

  const exported = (mod.default ?? mod) as unknown;
  const plugin = validatePlugin(exported, source);

  return { plugin, source, options };
}

export async function loadPlugins(
  pluginSpecs: (string | { name: string; options?: Record<string, unknown> })[] | undefined,
): Promise<PluginLoaderResult> {
  const result: PluginLoaderResult = { plugins: [], hookGeneratorsRegistered: false };

  if (!pluginSpecs || pluginSpecs.length === 0) return result;

  for (const spec of pluginSpecs) {
    const { plugin, source } = await resolvePlugin(spec);

    if (plugin.registerGenerators) {
      plugin.registerGenerators(generatorRegistry);
      result.hookGeneratorsRegistered = true;
    }

    result.plugins.push({ plugin, source });
  }

  return result;
}

export async function scanAvailablePlugins(): Promise<{ name: string; path: string }[]> {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const cwd = process.cwd();
    const nodeModulesDir = path.join(cwd, 'node_modules');

    let entries: string[];
    try {
      entries = await fs.readdir(nodeModulesDir);
    } catch {
      // Also check parent (for monorepo root)
      try {
        const parentDir = path.resolve(cwd, '..');
        const parentModules = path.join(parentDir, 'node_modules');
        entries = await fs.readdir(parentModules);
      } catch {
        return [];
      }
    }

    const results: { name: string; path: string }[] = [];
    for (const entry of entries) {
      if (entry.startsWith('seedforge-plugin-') || entry.startsWith('@seedforge/plugin-')) {
        results.push({ name: entry, path: path.join(nodeModulesDir, entry) });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function callPluginHook(
  plugins: LoadedPlugin[],
  hook: keyof SeedForgePlugin,
  ...args: unknown[]
): void {
  for (const { plugin } of plugins) {
    const fn = plugin[hook] as ((...a: unknown[]) => void | Promise<void>) | undefined;
    if (typeof fn === 'function') {
      fn(...args);
    }
  }
}