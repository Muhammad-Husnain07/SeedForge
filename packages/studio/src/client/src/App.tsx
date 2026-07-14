import React, { useEffect, useState, useCallback } from 'react';
import { TopBar } from './components/TopBar.js';
import { ErDiagram } from './components/ErDiagram.js';
import { ColumnInspector } from './components/ColumnInspector.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { PreviewPane } from './components/PreviewPane.js';
import { SeedButton } from './components/SeedButton.js';
import { SeedProgress } from './components/SeedProgress.js';
import { useSchema } from './hooks/useSchema.js';
import { useGraph } from './hooks/useGraph.js';
import { useConfig } from './hooks/useConfig.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useSeed } from './hooks/useSeed.js';
import { useDiff } from './hooks/useDiff.js';
import { useSuggestDescribe } from './hooks/useSuggestDescribe.js';

type PanelTab = 'columns' | 'config' | 'preview' | 'seed';

export function App() {
  const { schema, loading: schemaLoading } = useSchema();
  const { graph, loading: graphLoading } = useGraph();
  const { config, updateConfig } = useConfig();
  const { lastEvent } = useEventStream();
  const seed = useSeed();
  const { diff, refresh: refreshDiff } = useDiff();
  const suggest = useSuggestDescribe();

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>('columns');
  const [previewData, setPreviewData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [seedRunId, setSeedRunId] = useState<string | null>(null);
  const [showDrift, setShowDrift] = useState(false);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'preview' && lastEvent.data?.tables) {
      const map: Record<string, Record<string, unknown>[]> = {};
      for (const t of lastEvent.data.tables as { table: string; rows: Record<string, unknown>[] }[]) {
        map[t.table] = t.rows;
      }
      setPreviewData((prev) => ({ ...prev, ...map }));
    }
  }, [lastEvent]);

  const handleTableClick = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    setActiveTab('columns');
  }, []);

  const handleSeedNow = useCallback(async () => {
    try {
      const res = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'fresh' }),
      });
      const { runId } = await res.json() as { runId: string };
      setSeedRunId(runId);
      setActiveTab('seed');
    } catch (err) {
      console.error('Seed failed to start:', err);
    }
  }, []);

  const handleToggleDrift = useCallback(() => {
    setShowDrift((prev) => !prev);
    if (!showDrift) refreshDiff();
  }, [showDrift, refreshDiff]);

  const handleSuggestDescribe = useCallback(async (description: string) => {
    await suggest.generate(description);
    setActiveTab('config');
  }, [suggest]);

  if (schemaLoading || graphLoading) {
    return (
      <div className="app-layout">
        <TopBar connected={false} tableCount={0} />
        <div className="graph-area">
          <div className="empty-state">Loading schema...</div>
        </div>
        <div className="side-panel">
          <div className="empty-state">Loading...</div>
        </div>
      </div>
    );
  }

  const selectedTableSchema = selectedTable
    ? schema?.tables.find((t: { name: string }) => t.name === selectedTable) ?? null
    : null;

  return (
    <div className="app-layout">
      <TopBar
        connected={true}
        tableCount={graph?.nodes.length ?? 0}
      />
      <div className="graph-area">
        {graph ? (
          <ErDiagram
            graph={graph}
            selectedTable={selectedTable}
            onTableClick={handleTableClick}
            schemaTables={schema?.tables}
            diff={diff}
            showDrift={showDrift}
            onToggleDrift={handleToggleDrift}
          />
        ) : (
          <div className="empty-state">No graph data</div>
        )}
      </div>
      <div className="side-panel">
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {(['columns', 'config', 'preview', 'seed'] as PanelTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '8px 4px',
                background: activeTab === tab ? 'var(--bg-elevated)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'columns' && (
          <ColumnInspector
            tableName={selectedTable}
            columns={selectedTableSchema?.columns ?? null}
            matches={null}
          />
        )}
        {activeTab === 'config' && (
          <ConfigPanel
            config={config}
            plan={null}
            onConfigChange={(cfg) => { void updateConfig(cfg); }}
            onSuggestDescribe={handleSuggestDescribe}
            suggestLoading={suggest.loading}
            suggestResult={suggest.result}
            onSuggestClear={suggest.clear}
          />
        )}
        {activeTab === 'preview' && (
          <PreviewPane
            previewData={previewData}
            tables={graph?.nodes ?? []}
          />
        )}
        {activeTab === 'seed' && (
          <>
            <SeedButton onSeed={() => { void handleSeedNow(); }} disabled={seedRunId !== null && seed.progress !== null} />
            {seedRunId && <SeedProgress runId={seedRunId} seed={seed} />}
          </>
        )}
      </div>
    </div>
  );
}
