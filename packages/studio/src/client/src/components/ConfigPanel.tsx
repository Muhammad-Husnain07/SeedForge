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
  onSuggestDescribe?: (description: string) => void;
  suggestLoading?: boolean;
  suggestResult?: { configDraft: string | null; error?: string } | null;
  onSuggestClear?: () => void;
}

export function ConfigPanel({ config, plan, onConfigChange, onSuggestDescribe, suggestLoading, suggestResult, onSuggestClear }: ConfigPanelProps) {
  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});
  const [description, setDescription] = useState('');

  const handleWeightChange = useCallback((tableName: string, personaName: string, value: number) => {
    setLocalWeights((prev) => ({ ...prev, [`${tableName}.${personaName}`]: value }));
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

  const handleGenerate = useCallback(() => {
    if (description.trim() && onSuggestDescribe) {
      onSuggestDescribe(description.trim());
    }
  }, [description, onSuggestDescribe]);

  const handleApplyDraft = useCallback(() => {
    if (!suggestResult?.configDraft) return;
    // Send the full draft content as a text config to replace current
    onConfigChange({
      _suggestedDraft: suggestResult.configDraft,
    });
  }, [suggestResult, onConfigChange]);

  return (
    <div className="panel-section">
      <div className="panel-section-header">Persona Weights</div>
      {(!plan || Object.keys(plan.tables).length === 0) && (
        <div className="preview-empty">No tables with personas</div>
      )}
      {plan && Object.entries(plan.tables).map(([tableName, tablePlan]) =>
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

      {/* Natural-language config authoring */}
      <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
        <div className="panel-section-header" style={{ marginBottom: 'var(--space-sm)' }}>AI Config</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your data model in plain English..."
          rows={4}
          style={{
            width: '100%',
            padding: 'var(--space-sm) var(--space-md)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '3px',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-xs)',
            resize: 'vertical',
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
          <button
            onClick={handleGenerate}
            disabled={suggestLoading || !description.trim()}
            style={{
              flex: 1,
              padding: '6px 12px',
              background: suggestLoading ? 'var(--bg-elevated)' : 'var(--accent)',
              border: 'none',
              borderRadius: '3px',
              color: suggestLoading ? 'var(--text-muted)' : 'var(--bg-base)',
              cursor: suggestLoading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
            }}
          >
            {suggestLoading ? 'Generating...' : 'Generate'}
          </button>
          {suggestResult && (
            <button
              onClick={onSuggestClear}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {suggestLoading && (
          <div className="preview-empty" style={{ marginTop: 'var(--space-sm)' }}>Consulting AI...</div>
        )}

        {suggestResult?.error && (
          <div style={{
            marginTop: 'var(--space-sm)',
            padding: 'var(--space-sm)',
            background: 'var(--bg-elevated)',
            borderLeft: '3px solid var(--confidence-low)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--confidence-low)',
          }}>
            {suggestResult.error}
          </div>
        )}

        {suggestResult?.configDraft && (
          <div style={{ marginTop: 'var(--space-sm)' }}>
            <div className="panel-section-header" style={{ marginBottom: 'var(--space-xs)' }}>Draft</div>
            <pre
              contentEditable
              suppressContentEditableWarning
              style={{
                width: '100%',
                maxHeight: 240,
                overflow: 'auto',
                padding: 'var(--space-sm) var(--space-md)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {suggestResult.configDraft}
            </pre>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              <button
                onClick={handleApplyDraft}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  background: 'var(--confidence-high)',
                  border: 'none',
                  borderRadius: '3px',
                  color: 'var(--bg-base)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
