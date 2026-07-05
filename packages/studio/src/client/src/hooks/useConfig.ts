import { useState, useCallback } from 'react';

export function useConfig() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  const updateConfig = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const updated = await res.json() as Record<string, unknown>;
      setConfig(updated);
    } catch (err) {
      console.error('Config update failed:', err);
    }
  }, []);

  return { config, updateConfig };
}
