export type ValidationRule =
  | 'not-null'
  | 'enum-values'
  | 'unique-cardinality'
  | 'fk-ordering'
  | 'row-count'
  | 'fk-reference'
  | 'junction-orphan';

export type ValidationStatus = 'pass' | 'fail' | 'warn';

export interface ValidationEntry {
  table: string;
  column?: string;
  rule: ValidationRule;
  status: ValidationStatus;
  message?: string;
}

export interface PreFlightResult {
  valid: boolean;
  entries: ValidationEntry[];
}

export interface PostWriteResult {
  valid: boolean;
  entries: ValidationEntry[];
}

export interface VerifyOptions {
  sampleSize?: number;
}

export interface PreFlightOptions {
  nullProbability?: number;
}
