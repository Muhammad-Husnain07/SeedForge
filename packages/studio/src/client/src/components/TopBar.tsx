import React from 'react';

interface TopBarProps {
  connected: boolean;
  tableCount: number;
}

export function TopBar({ connected, tableCount }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="topbar-brand">
        seedforge studio
      </div>
      <div className="topbar-status">
        <span className="status-dot" style={{ background: connected ? 'var(--confidence-high)' : 'var(--confidence-low)' }} />
        {connected ? `${tableCount} tables` : 'disconnected'}
      </div>
    </div>
  );
}
