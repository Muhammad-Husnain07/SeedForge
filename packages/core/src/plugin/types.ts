import type { DatabaseSchema } from '../types/index.js';
import type { GenerationPlan, SeedContext } from '../config/types.js';
import type { PRNG } from '../distributions/prng.js';

export interface FieldContext {
  table: string;
  column: string;
  rowIndex: number;
}

export interface FieldGenerator {
  (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG, ctx: FieldContext): unknown;
  /** Declare which DB logical types this generator is compatible with (for validation) */
  compatibleTypes?: string[];
  /** Estimate how many distinct values this generator can produce given count rows */
  estimateDistinct?: (params: Record<string, unknown>, count: number) => number | null;
}

export interface GeneratorRegistry {
  register(kind: string, generator: FieldGenerator): void;
  get(kind: string): FieldGenerator | undefined;
  has(kind: string): boolean;
  knownKinds(): string[];
}

export interface SeedForgePlugin {
  name: string;
  version?: string;
  onSchemaIntrospected?(schema: DatabaseSchema): void | Promise<void>;
  registerGenerators?(registry: GeneratorRegistry): void;
  beforeGenerate?(plan: GenerationPlan): void | Promise<void>;
  afterGenerate?(metadata: { tables: string[]; totalRows: number }): void | Promise<void>;
  beforeInsert?(table: string, batch: Record<string, unknown>[]): void | Promise<void>;
  afterInsert?(table: string, batch: Record<string, unknown>[]): void | Promise<void>;
}