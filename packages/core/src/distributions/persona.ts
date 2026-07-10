import type { PRNG } from './prng.js';
import { weightedCategorical } from './weighted.js';
import type { ChurnConfig } from '../config/types.js';

export interface PersonaOverride {
  field: string;
  generator?: { kind: string; params: Record<string, unknown> };
  value?: unknown;
}

export interface Persona {
  name: string;
  selectionWeight: number;
  overrides: PersonaOverride[];
  cascades?: Record<string, number>;
  churn?: ChurnConfig;
}

export interface PersonaSet {
  personas: Persona[];
}

export function assignPersona(prng: PRNG, personaSet: PersonaSet): Persona | null {
  if (personaSet.personas.length === 0) return null;

  const weights: Record<string, number> = {};
  for (const p of personaSet.personas) {
    weights[p.name] = p.selectionWeight;
  }

  const selected = weightedCategorical(prng, weights);
  return personaSet.personas.find((p) => p.name === selected) ?? null;
}
