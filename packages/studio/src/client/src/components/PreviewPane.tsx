import React, { useState, useCallback, useEffect } from 'react';

interface PreviewPaneProps {
  previewData: Record<string, Record<string, unknown>[]>;
  tables: string[];
}

export function PreviewPane({ previewData, tables }: PreviewPaneProps) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-select first table when data arrives
  useEffect(() => {
    if (!selectedTable && tables.length > 0) {
      setSelectedTable(tables[0]!);
    }
  }, [tables, selectedTable]);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowsPerTable: 10 }),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Request initial preview on mount
  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const rows = selectedTable ? previewData[selectedTable] : null;

  const allColumns = rows && rows.length > 0
    ? Object.keys(rows[0]!).filter((k) => k !== 'phase' && k !== 'patchInfo')
    : [];

  return (
    <div className="panel-section">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-sm)',
      }}>
        <div className="panel-section-header" style={{ margin: 0 }}>
          Live Preview
        </div>
        <button
          onClick={() => { void refreshPreview(); }}
          disabled={loading}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            padding: '2px 8px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          {loading ? '...' : 'refresh'}
        </button>
      </div>

      {/* Table selector */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        marginBottom: 'var(--space-sm)',
      }}>
        {tables.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTable(t)}
            style={{
              padding: '2px 8px',
              background: selectedTable === t ? 'var(--accent)' : 'var(--bg-elevated)',
              border: `1px solid ${selectedTable === t ? 'var(--accent)' : 'var(--border)'}`,
              color: selectedTable === t ? 'var(--bg-base)' : 'var(--text-secondary)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-xs)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Preview rows */}
      {rows && rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="preview-table">
            <thead>
              <tr>
                {allColumns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {allColumns.map((col) => (
                    <td key={col} title={row[col] == null ? '' : JSON.stringify(row[col])}>
                      {row[col] == null ? '∅' : JSON.stringify(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="preview-empty">{loading ? 'Generating...' : 'No preview data. Click refresh.'}</div>
      )}
    </div>
  );
}
