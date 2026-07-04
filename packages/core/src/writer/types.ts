import { EventEmitter } from 'node:events';
import type { GenerationBatch } from '../generate/types.js';
import type { RelationshipGraph } from '../graph/graph.js';
import type { DatabaseSchema } from '../types/index.js';

export type WriteMode = 'fresh' | 'truncate' | 'append';

export interface WriteProgressEvent {
  table: string;
  phase: 'insert' | 'patch' | 'truncate' | 'verify';
  rowsWritten: number;
  rowsTotal: number;
}

export interface WriteOptions {
  mode: WriteMode;
  batchSize?: number;
  onProgress?: (event: WriteProgressEvent) => void;
  progressEmitter?: WriteProgressEmitter;
  signal?: AbortSignal;
}

export interface WriteResult {
  rowsWritten: Record<string, number>;
  elapsedMs: number;
}

export interface BatchWriter {
  write(
    batches: AsyncIterable<GenerationBatch>,
    graph: RelationshipGraph,
    schema: DatabaseSchema,
    options?: WriteOptions,
  ): Promise<WriteResult>;
}

export class WriteProgressEmitter extends EventEmitter {
  emitProgress(event: WriteProgressEvent): void {
    this.emit('progress', event);
  }
}
