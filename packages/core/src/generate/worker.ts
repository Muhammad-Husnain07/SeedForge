import { parentPort, workerData } from 'node:worker_threads';
import type { TableSchema } from '../types/index.js';
import type { GenerationPlan, ResolvedField } from '../config/types.js';
import type { GeneratorSpec } from '../semantic/types.js';
import { deriveStream } from '../distributions/prng.js';
import { assignPersona } from '../distributions/persona.js';
import type { Persona } from '../distributions/persona.js';
import { generateFieldValue } from './fields.js';
import { enforceUniqueRow, registerUnique } from './unique.js';
import type { UniqueContext } from './unique.js';
import { assignParents } from './parent.js';


interface WorkerInput {
  tableName: string;
  tableSchema: TableSchema;
  tablePlan: GenerationPlan['tables'][string];
  seed: number;
  parentPKs: Record<string, unknown[]>;
  batchSize: number;
  refDate?: number;
}

interface WorkerMessage {
  type: 'batch';
  table: string;
  rows: Record<string, unknown>[];
  phase: 'insert';
}

interface WorkerDoneMessage {
  type: 'done';
  pks: unknown[];
}

const input = workerData as WorkerInput;
const port = parentPort;

if (!port) {
  process.exit(1);
}

// Override Date.now for deterministic timestamp generation if refDate provided
if (input.refDate != null) {
  Date.now = () => input.refDate!;
}

function run(): void {
  const { tableName, tableSchema, tablePlan, seed, parentPKs, batchSize } = input;

  const pkCache = new Map<string, unknown[]>();
  for (const [table, pks] of Object.entries(parentPKs)) {
    pkCache.set(table, pks);
  }

  const uniqueCtx: UniqueContext = { existingKeys: new Map() };

  const assignments = assignParents(tableName, tableSchema, tablePlan, pkCache, seed);

  if (assignments.totalCount === 0) {
    port!.postMessage({ type: 'done', pks: [] });
    return;
  }

  const fieldOrder = sortFieldsByDependency(tablePlan.fields);
  const columnRegistry = fieldOrder.map((f) => ({ name: f.name, generator: f.generator }));

  const pkColumns = tableSchema.primaryKey;
  const pkColumn = pkColumns[0];
  const generatedPKs: unknown[] = [];

  const selfRefFK = tableSchema.foreignKeys.find(
    (fk) => fk.referencedTable === tableName,
  );
  const selfRefCol = selfRefFK?.columns[0];

  let buffer: Record<string, unknown>[] = [];

  for (let i = 0; i < assignments.totalCount; i++) {
    const row: Record<string, unknown> = {};

    if (assignments.bindings.length > i) {
      const binding = assignments.bindings[i]!;
      for (const [col, val] of Object.entries(binding.bindings)) {
        row[col] = val;
      }
    }

    let activePersona: Persona | null = null;
    if (tablePlan.personas.length > 0) {
      const personaPrng = deriveStream(String(seed), tableName, '__persona__', String(i));
      activePersona = assignPersona(personaPrng, { personas: tablePlan.personas });
    }

    for (const field of fieldOrder) {
      if (row[field.name] !== undefined) continue;

      const personaOverride = activePersona?.overrides.find(
        (o) => o.field === field.name,
      );

      let generator: GeneratorSpec;
      if (personaOverride?.value !== undefined) {
        row[field.name] = personaOverride.value;
        continue;
      } else if (personaOverride?.generator) {
        generator = personaOverride.generator;
      } else {
        generator = field.generator;
      }

      const fieldPrng = deriveStream(
        String(seed),
        tableName,
        '__row__',
        String(i),
        field.name,
      );

      row[field.name] = generateFieldValue(
        generator,
        row,
        fieldPrng,
        pkCache,
        tableSchema,
        tablePlan,
        { table: tableName, rowIndex: i },
      );
    }

    for (const col of tableSchema.columns) {
      if (row[col.name] === undefined) {
        const np = col.nullable ? 0.1 : 0;
        if (np > 0) {
          const nullPrng = deriveStream(
            String(seed),
            tableName,
            '__nullable__',
            col.name,
            String(i),
          );
          if (nullPrng.next() < np) {
            row[col.name] = null;
          }
        }
      }
    }

    if (selfRefCol) {
      row[selfRefCol] = null;
    }

    const uniqueResult = enforceUniqueRow(
      row,
      tableSchema.uniqueConstraints,
      uniqueCtx,
      columnRegistry,
      pkCache,
      tableSchema,
      tablePlan,
      { table: tableName, rowIndex: i, rootSeed: seed },
      50,
    );

    const finalRow = uniqueResult.row;
    registerUnique(finalRow, tableSchema.uniqueConstraints, uniqueCtx);

    if (pkColumn) {
      const pkVal = finalRow[pkColumn];
      generatedPKs.push(pkVal);
    }

    buffer.push(finalRow);

    if (buffer.length >= batchSize) {
      port!.postMessage({
        type: 'batch',
        table: tableName,
        rows: buffer,
        phase: 'insert',
      } satisfies WorkerMessage);
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    port!.postMessage({
      type: 'batch',
      table: tableName,
      rows: buffer,
      phase: 'insert',
    } satisfies WorkerMessage);
  }

  port!.postMessage({
    type: 'done',
    pks: generatedPKs,
  } satisfies WorkerDoneMessage);
}

function sortFieldsByDependency(fields: ResolvedField[]): { name: string; generator: GeneratorSpec; dependsOn?: string }[] {
  const entries = fields.map((f) => {
    const dependsOn = f.generator.params.dependsOn as string | undefined;
    return { name: f.column, generator: f.generator, dependsOn };
  });

  const sorted: { name: string; generator: GeneratorSpec; dependsOn?: string }[] = [];
  const remaining = [...entries];
  const inResult = new Set<string>();

  while (remaining.length > 0) {
    const batch = remaining.filter(
      (e) => !e.dependsOn || inResult.has(e.dependsOn),
    );
    if (batch.length === 0) {
      sorted.push(...remaining);
      break;
    }
    for (const b of batch) {
      sorted.push(b);
      inResult.add(b.name);
      const idx = remaining.indexOf(b);
      if (idx !== -1) remaining.splice(idx, 1);
    }
  }

  return sorted;
}

try {
  run();
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? (err.stack ?? '') : '';
  port.postMessage({ type: 'error', message: errMsg, stack: errStack });
}
