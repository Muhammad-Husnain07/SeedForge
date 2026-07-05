import type { FastifyInstance } from 'fastify';
import { eventBus, type SSEEvent } from '../events.js';

export async function eventsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const unsubscribe = eventBus.subscribe((event: SSEEvent) => {
      try {
        const data = JSON.stringify(event.data);
        reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
      } catch { /* connection closed */ }
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
