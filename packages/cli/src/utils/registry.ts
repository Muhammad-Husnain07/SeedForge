import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface RegistryConfig {
  registryUrl: string;
  apiToken: string;
  org?: string;
}

function configDir(): string {
  return path.join(os.homedir(), '.seedforge');
}

function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export async function readRegistryConfig(): Promise<RegistryConfig | null> {
  const envUrl = process.env.SEEDFORGE_REGISTRY_URL;
  const envToken = process.env.SEEDFORGE_REGISTRY_TOKEN;
  if (envUrl && envToken) {
    return { registryUrl: envUrl, apiToken: envToken };
  }
  try {
    const raw = await fs.readFile(configPath(), 'utf-8');
    return JSON.parse(raw) as RegistryConfig;
  } catch {
    return null;
  }
}

export async function writeRegistryConfig(config: RegistryConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export async function registryFetch(
  registryUrl: string,
  apiToken: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const url = `${registryUrl.replace(/\/+$/, '')}${pathname}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}
