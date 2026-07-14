import { useState, useEffect } from 'react';

interface DiffEntry {
  type: string;
  table: string;
  column?: string;
  detail: string;
}

interface ChangedTable {
  name: string;
  status: 'added' | 'removed' | 'changed';
  addedCols: string[];
  removedCols: string[];
  changedCols: { name: string; detail: string }[];
}

interface DiffData {
  hasDrift: boolean;
  entries: DiffEntry[];
  formatted: string;
  addedTables: string[];
  removedTables: string[];
  changedTables: ChangedTable[];
}

export function useDiff() {
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch('/api/diff')
      .then((r) => r.json() as Promise<DiffData>)
      .then(setDiff)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return { diff, loading, refresh };
}
