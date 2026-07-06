import { useState, useEffect } from 'react';

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let evtSource: EventSource | null = null;

    function connect() {
      evtSource = new EventSource('/api/events');

      evtSource.onopen = () => setConnected(true);

      evtSource.addEventListener('config-changed', (e: MessageEvent) => {
        try {
          setLastEvent({ type: 'config-changed', data: JSON.parse(e.data as string) as Record<string, unknown> });
        } catch { /* ignore */ }
      });

      evtSource.addEventListener('preview', (e: MessageEvent) => {
        try {
          setLastEvent({ type: 'preview', data: JSON.parse(e.data as string) as Record<string, unknown> });
        } catch { /* ignore */ }
      });

      evtSource.onerror = () => {
        setConnected(false);
        evtSource?.close();
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => evtSource?.close();
  }, []);

  return { lastEvent, connected };
}
