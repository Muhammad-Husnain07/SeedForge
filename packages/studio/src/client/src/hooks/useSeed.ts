import { useState, useEffect, useCallback } from 'react';

interface ProgressEntry {
  rowsWritten: number;
  rowsTotal: number;
  phase: string;
}

interface SeedDoneResult {
  runId: string;
  result: {
    rowsWritten: Record<string, number>;
    elapsedMs: number;
  };
}

export function useSeed() {
  const [progress, setProgress] = useState<Record<string, ProgressEntry> | null>(null);
  const [done, setDone] = useState<SeedDoneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProgress(null);
    setDone(null);
    setError(null);
  }, []);

  // Listen for SSE events
  useEffect(() => {
    let evtSource: EventSource | null = null;

    function connect() {
      evtSource = new EventSource('/api/events');

      evtSource.addEventListener('seed-progress', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as { runId: string; table: string; rowsWritten: number; rowsTotal: number; phase: string };
          setProgress((prev) => ({
            ...prev,
            [data.table]: { rowsWritten: data.rowsWritten, rowsTotal: data.rowsTotal, phase: data.phase },
          }));
        } catch { /* ignore */ }
      });

      evtSource.addEventListener('seed-done', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as { runId: string; result: { rowsWritten: Record<string, number>; elapsedMs: number } };
          setDone(data);
        } catch { /* ignore */ }
      });

      evtSource.addEventListener('seed-error', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as { runId: string; error: string };
          setError(data.error);
        } catch { /* ignore */ }
      });

      evtSource.onerror = () => {
        evtSource?.close();
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => evtSource?.close();
  }, []);

  return { progress, done, error, reset };
}
