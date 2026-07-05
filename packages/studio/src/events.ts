import { EventEmitter } from 'node:events';

export type SSEEventType = 'preview' | 'config-changed' | 'seed-progress' | 'seed-done' | 'seed-error';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

class EventBus extends EventEmitter {
  private clients: Set<(event: SSEEvent) => void> = new Set();

  subscribe(callback: (event: SSEEvent) => void): () => void {
    this.clients.add(callback);
    return () => this.clients.delete(callback);
  }

  emit(type: SSEEventType, data: unknown): boolean {
    const event: SSEEvent = { type, data };
    for (const cb of this.clients) {
      try { cb(event); } catch { /* drop dead listeners */ }
    }
    return super.emit(type, data);
  }

  onProgress(cb: (event: SSEEvent) => void): () => void {
    return this.subscribe(cb);
  }
}

export const eventBus = new EventBus();
