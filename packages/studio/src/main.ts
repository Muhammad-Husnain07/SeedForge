import { buildServer } from './server.js';
import { initializeContext } from './context.js';

export interface StudioOptions {
  configPath?: string;
  port?: number;
}

export async function startStudio(options: StudioOptions = {}): Promise<void> {
  const port = options.port ?? 3456;
  const configPath = options.configPath;

  console.error(`[studio] Loading config: ${configPath ?? 'seedforge.config.ts'}`);
  await initializeContext(configPath);
  console.error('[studio] Context initialized (schema, graph, plan ready)');

  const server = await buildServer({ configPath });

  await server.listen({ port, host: '127.0.0.1' });
  console.error(`\n  seedforge studio running at http://127.0.0.1:${port}\n`);
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
