import React, { useState, useCallback } from 'react';

interface PersonaInfo {
  name: string;
  selectionWeight: number;
  overrideFieldCount: number;
  cascades?: Record<string, number>;
}

interface TablePlanInfo {
  count: number | { kind: string; params: Record<string, unknown> };
  personaCount: number;
  fieldCount: number;
  fields: { column: string; source: string; confidence: number; semanticType: string }[];
  personas: PersonaInfo[];
}

interface PlanData {
  tables: Record<string, TablePlanInfo>;
}

interface ConfigPanelProps {
  config: Record<string, unknown> | null;
  plan: PlanData | null;
  onConfigChange: (patch: Record<string, unknown>) => void;
}

export function ConfigPanel({ config, plan, onConfigChange }: ConfigPanelProps) {
  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});

  const handleWeightChange = useCallback((tableName: string, personaName: string, value: number) => {
    setLocalWeights((prev) => ({ ...prev, [`${tableName}.${personaName}`]: value }));

    // Debounced: send to server
    const patch = {
      tables: {
        [tableName]: {
          personas: plan?.tables[tableName]?.personas.map((p) =>
            p.name === personaName ? { ...p, selectionWeight: value } : p
          ),
        },
      },
    };
    onConfigChange(patch);
  }, [plan, onConfigChange]);

  if (!plan || !config) {
    return (
      <div className="panel-section">
        <div className="preview-empty">No plan data available</div>
      </div>
    );
  }

  const tableEntries = Object.entries(plan.tables);

  return (
    <div className="panel-section">
      <div className="panel-section-header">Persona Weights</div>
      {tableEntries.length === 0 && (
        <div className="preview-empty">No tables with personas</div>
      )}
      {tableEntries.map(([tableName, tablePlan]) =>
        tablePlan.personas.length === 0 ? null : (
          <div key={tableName} style={{ marginBottom: 'var(--space-md)' }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--accent)',
              marginBottom: 'var(--space-xs)',
            }}>
              {tableName}
            </div>
            {tablePlan.personas.map((persona) => {
              const key = `${tableName}.${persona.name}`;
              const value = localWeights[key] ?? persona.selectionWeight;
              return (
                <div key={persona.name} className="config-field">
                  <label>
                    {persona.name}
                    <span className="range-value">{value.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={value}
                    onChange={(e) => handleWeightChange(tableName, persona.name, parseFloat(e.target.value))}
                    aria-label={`${tableName} ${persona.name} weight`}
                  />
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
