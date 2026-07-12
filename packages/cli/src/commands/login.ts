import { input, password } from '@inquirer/prompts';
import { readRegistryConfig, writeRegistryConfig } from '../utils/registry.js';
import { isJsonMode, printJson, printSuccess, printError } from '../utils/format.js';

export async function loginCommand(): Promise<void> {
  try {
    const existing = await readRegistryConfig();

    const registryUrl = await input({
      message: 'Registry URL',
      default: existing?.registryUrl,
      validate: (v) => (v.length > 0 ? true : 'Registry URL is required'),
    });

    const apiToken = await password({
      message: 'API token',
      mask: true,
      validate: (v) => (v.length > 0 ? true : 'API token is required'),
    });

    // Validate by hitting the health endpoint
    const url = `${registryUrl.replace(/\/+$/, '')}/health`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Registry unreachable at ${url} (HTTP ${res.status})`);
    }

    await writeRegistryConfig({ registryUrl, apiToken });

    if (isJsonMode()) {
      printJson({ success: true, registryUrl });
    } else {
      printSuccess(`Logged in to ${registryUrl}`);
    }
  } catch (err) {
    printError(`Login failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
