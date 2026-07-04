export interface GenerateOptions {
  batchSize?: number;
  uniqueRetryLimit?: number;
  nullProbability?: number;
}

export interface GenerationBatch {
  table: string;
  rows: Record<string, unknown>[];
  phase: 'insert' | 'patch';
  patchInfo?: {
    patchColumn: string;
    pkColumn: string;
  };
}

export class GenerationError extends Error {
  constructor(
    public table: string,
    public column: string,
    message: string,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}
