import { startRegistry } from './server.js';

async function main() {
  const host = process.env.HOST ?? '0.0.0.0';
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3457;
  await startRegistry({ host, port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
