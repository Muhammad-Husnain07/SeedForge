import { useState, useEffect } from 'react';

interface EdgeData {
  from: string;
  to: string;
  type: string;
  foreignKey: { columns: string[]; referencedTable: string; referencedColumns: string[] };
  viaJunctionTable?: string;
}

interface GraphData {
  nodes: string[];
  edges: EdgeData[];
  levels: string[][];
  insertionOrder: string[];
  cycles: string[][];
}

export function useGraph() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json() as Promise<GraphData>)
      .then(setGraph)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { graph, loading };
}
