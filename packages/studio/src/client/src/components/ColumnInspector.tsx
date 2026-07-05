import React from 'react';

interface ColumnInfo {
  name: string;
  logicalType: string;
  nativeType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  enumValues?: string[];
  maxLength?: number;
  comment?: string;
}

interface ColumnInspectorProps {
  tableName: string | null;
  columns: ColumnInfo[] | null;
  matches: Record<string, { semanticType: string; confidence: number }> | null;
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'confidence-high-bg';
  if (confidence >= 0.5) return 'confidence-mid-bg';
  return 'confidence-low-bg';
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'mid';
  return 'low';
}

export function ColumnInspector({ tableName, columns, matches }: ColumnInspectorProps) {
  if (!tableName) {
    return (
      <div className="panel-section">
        <div className="empty-state">
          Click a <span className="click-hint">table node</span> in the graph to inspect its columns
        </div>
      </div>
    );
  }

  if (!columns) {
    return (
      <div className="panel-section column-inspector">
        <div className="table-name">{tableName}</div>
        <div className="preview-empty">No column data available</div>
      </div>
    );
  }

  return (
    <div className="panel-section column-inspector">
      <div className="table-name"># {tableName}</div>
      {columns.map((col) => {
        const match = matches?.[col.name];
        const confidence = match?.confidence ?? 0;
        return (
          <div key={col.name} className="column-item">
            <span className={`confidence-dot ${confidenceClass(confidence)}`} />
            <span className="column-name">{col.isPrimaryKey ? '#' : ''}{col.name}</span>
            <span className="column-type">{col.nativeType}{col.nullable ? '?' : ''}</span>
            {match && (
              <span className="column-semantic">{match.semanticType}</span>
            )}
            <span className="column-confidence">{confidenceLabel(confidence)}</span>
          </div>
        );
      })}
    </div>
  );
}
