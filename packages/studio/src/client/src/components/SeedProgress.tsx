import React from 'react';
import { useSeed } from '../hooks/useSeed.js';

interface SeedProgressProps {
  runId: string;
  seed: ReturnType<typeof useSeed>;
}

export function SeedProgress({ runId: _runId, seed }: SeedProgressProps) {
  const progress = seed.progress;
  const done = seed.done;
  const error = seed.error;

  if (error) {
    return (
      <div className="panel-section">
        <div className="seed-result error">
          <div className="result-label">Error</div>
          <div className="result-value">{error}</div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel-section">
        <div className="seed-result success">
          <div className="result-label">Seed Complete</div>
          {done.result && (
            <>
              <div className="result-value" style={{ marginTop: 4 }}>
                {Object.values(done.result.rowsWritten).reduce<number>((a, b) => a + b, 0)} total rows
              </div>
              <div className="result-value">
                {(done.result.elapsedMs / 1000).toFixed(1)}s
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="panel-section">
        <div className="progress-text">Starting...</div>
      </div>
    );
  }

  const tables = Object.keys(progress);
  const totalWritten = tables.reduce((sum, t) => sum + (progress[t]?.rowsWritten ?? 0), 0);
  const totalTarget = tables.reduce((sum, t) => sum + (progress[t]?.rowsTotal ?? 0), 0);
  const pct = totalTarget > 0 ? Math.min(100, (totalWritten / totalTarget) * 100) : 0;

  return (
    <div className="panel-section">
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-text">{totalWritten} / {totalTarget} rows</div>
        <table className="progress-table">
          <tbody>
            {tables.map((t) => (
              <tr key={t}>
                <td className="table-label">{t}</td>
                <td className="table-count">{progress[t]?.rowsWritten ?? 0} / {progress[t]?.rowsTotal ?? '?'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
