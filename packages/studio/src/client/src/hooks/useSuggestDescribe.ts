import { useState, useCallback } from 'react';

interface SuggestDescribeResult {
  configDraft: string | null;
  error?: string;
}

export function useSuggestDescribe() {
  const [result, setResult] = useState<SuggestDescribeResult | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async (description: string) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/suggest-describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const data = await res.json() as SuggestDescribeResult & { configDraft?: string; error?: string };
      setResult(data);
    } catch (err) {
      setResult({ configDraft: null, error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
  }, []);

  return { result, loading, generate, clear };
}
