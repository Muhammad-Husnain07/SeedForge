import React from 'react';

interface SeedButtonProps {
  onSeed: () => void;
  disabled: boolean;
}

export function SeedButton({ onSeed, disabled }: SeedButtonProps) {
  return (
    <div className="panel-section">
      <button
        className="seed-button"
        onClick={onSeed}
        disabled={disabled}
      >
        {disabled ? 'Seeding in progress...' : 'Seed now'}
      </button>
    </div>
  );
}
