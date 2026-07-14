import { buildServer } from './server.js';
import { initializeContext } from './context.js';
import { isAuthEnabled } from './auth.js';

export interface StudioOptions {
  configPath?: string;
  port?: number;
  host?: string;
}

export async function startStudio(options: StudioOptions = {}): Promise<void> {
  const port = options.port ?? 3456;
  const configPath = options.configPath;
  const auth = isAuthEnabled();

  console.error(`[studio] Loading config: ${configPath ?? 'seedforge.config.ts'}`);
  await initializeContext(configPath);
  console.error('[studio] Context initialized (schema, graph, plan ready)');

  const server = await buildServer({ configPath });

  // If SEEDFORGE_STUDIO_TOKEN is set, auth gate protects all routes
  // so we can safely bind beyond localhost for team deployment.
  // Otherwise default to localhost-only with zero-config.
  const bindHost = options.host ?? (auth ? '0.0.0.0' : '127.0.0.1');

  await server.listen({ port, host: bindHost });
  console.error(`\n  seedforge studio running at http://${bindHost}:${port}\n`);
  if (auth) {
    console.error('  Authentication: enabled (SEEDFORGE_STUDIO_TOKEN)');
  } else {
    console.error('  Authentication: disabled (set SEEDFORGE_STUDIO_TOKEN to enable)');
    console.error('  ⚠  Bound to 127.0.0.1 only — use a reverse proxy for remote access');
  }
}

// Allow running standalone
const isMain = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts');
if (isMain) {
  const idx = process.argv.indexOf('--port');
  const port = idx !== -1 ? parseInt(process.argv[idx + 1] ?? '3456', 10) : 3456;
  const cfgIdx = process.argv.indexOf('--config');
  const configPath = cfgIdx !== -1 ? process.argv[cfgIdx + 1] : undefined;

  startStudio({ port, configPath }).catch((err) => {
    console.error('[studio] Fatal error:', err);
    process.exit(1);
  });
}
