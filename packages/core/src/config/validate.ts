import { z } from 'zod';
import type { DatabaseSchema } from '../types/index.js';
import type { SeedForgeConfig, FieldConfig, DerivedField } from './types.js';
import { getGenerator } from '../plugin/registry.js';

const isDerivedField = (v: unknown): v is { fn: (...args: unknown[]) => unknown } =>
  typeof v === 'object' && v !== null && 'fn' in v && typeof (v as Record<string, unknown>).fn === 'function';

const DistributionSpecSchema = z.object({
  kind: z.string(),
  params: z.record(z.unknown()),
});

const DerivedFieldSchema: z.ZodType<DerivedField> = z.custom((v) => isDerivedField(v));

const FieldConfigSchema: z.ZodType<FieldConfig> = z.union([
  DistributionSpecSchema,
  DerivedFieldSchema,
]);

const PersonaOverrideSchema = z.object({
  field: z.string(),
  generator: z.object({ kind: z.string(), params: z.record(z.unknown()) }).optional(),
  value: z.unknown().optional(),
});

const PersonaSchema = z.object({
  name: z.string(),
  selectionWeight: z.number().min(0).max(1),
  overrides: z.array(PersonaOverrideSchema),
  cascades: z.record(z.number()).optional(),
});

const TableConfigSchema = z.object({
  count: z.union([z.number().int().nonnegative(), DistributionSpecSchema]).optional(),
  fields: z.record(FieldConfigSchema).optional(),
  countPerParent: z.record(z.union([z.number().int().nonnegative(), DistributionSpecSchema])).optional(),
  personas: z.array(PersonaSchema).optional(),
  overrides: z.array(z.record(z.unknown())).optional(),
});

export const SeedForgeConfigSchema = z.object({
  connection: z.object({
    dialect: z.enum(['postgres', 'mysql', 'mongodb']),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.union([z.boolean(), z.record(z.unknown())]).optional(),
  }),
  tables: z.record(TableConfigSchema),
});

const TYPE_COMPATIBILITY: Record<string, string[]> = {
  email: ['string'],
  uuid: ['uuid', 'string'],
  firstName: ['string'],
  lastName: ['string'],
  fullName: ['string'],
  phone: ['string'],
  street: ['string'],
  city: ['string'],
  state: ['string'],
  country: ['string'],
  zip: ['string'],
  url: ['string'],
  ip: ['string'],
  slug: ['string'],
  imageUrl: ['string'],
  longText: ['string'],
  currency: ['float', 'integer'],
  boolean: ['boolean'],
  timestamp: ['timestamp', 'date'],
  enum: ['enum', 'string'],
  quantity: ['integer'],
  sku: ['string'],
  rating: ['integer'],
  foreignKey: ['uuid', 'string'],
  latitude: ['float', 'integer'],
  longitude: ['float', 'integer'],
  'weighted-categorical': ['enum', 'integer', 'string'],
  'bounded-integer': ['integer'],
  'log-normal-currency': ['float', 'integer'],
  'boolean-skewed': ['boolean'],
  'recent-timestamp': ['timestamp', 'date'],
  'dependent-timestamp': ['timestamp', 'date'],
  faker: ['string', 'float', 'integer', 'boolean'],
  unknown: [],
};

function isGeneratorSpecConfig(v: unknown): v is { kind: string; params: Record<string, unknown> } {
  return typeof v === 'object' && v !== null && 'kind' in v && !('fn' in v);
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateConfig(config: SeedForgeConfig, schema: DatabaseSchema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const tableNames = new Set(schema.tables.map((t) => t.name));

  for (const [tableName, tableConfig] of Object.entries(config.tables)) {
    if (!tableNames.has(tableName)) {
      issues.push({
        path: `tables.${tableName}`,
        message: `table '${tableName}' not found in schema. Available tables: ${[...tableNames].join(', ')}`,
      });
      continue;
    }

    const tableSchema = schema.tables.find((t) => t.name === tableName)!;
    const columnNames = new Set(tableSchema.columns.map((c) => c.name));

    if (tableConfig.fields) {
      for (const [fieldName, fieldConfig] of Object.entries(tableConfig.fields)) {
        if (!columnNames.has(fieldName)) {
          issues.push({
            path: `tables.${tableName}.fields.${fieldName}`,
            message: `column '${fieldName}' not found in table '${tableName}'. Available columns: ${[...columnNames].join(', ')}`,
          });
          continue;
        }

        if (isGeneratorSpecConfig(fieldConfig) && !isDerivedField(fieldConfig)) {
          const columnSchema = tableSchema.columns.find((c) => c.name === fieldName)!;
          let allowedTypes = TYPE_COMPATIBILITY[fieldConfig.kind];
          if (!allowedTypes) {
            const pluginGen = getGenerator(fieldConfig.kind);
            allowedTypes = pluginGen?.compatibleTypes;
          }
          if (allowedTypes && !allowedTypes.includes(columnSchema.logicalType) && !allowedTypes.includes('*')) {
            issues.push({
              path: `tables.${tableName}.fields.${fieldName}`,
              message: `generator kind '${fieldConfig.kind}' is not compatible with column type '${columnSchema.logicalType}'. Expected one of: ${allowedTypes.join(', ')}`,
            });
          }
        }
      }
    }

    if (tableConfig.countPerParent) {
      for (const parentTable of Object.keys(tableConfig.countPerParent)) {
        if (!tableNames.has(parentTable)) {
          issues.push({
            path: `tables.${tableName}.countPerParent.${parentTable}`,
            message: `parent table '${parentTable}' not found in schema. Available tables: ${[...tableNames].join(', ')}`,
          });
        }
      }
    }

    if (tableConfig.personas) {
      for (let i = 0; i < tableConfig.personas.length; i++) {
        const p = tableConfig.personas[i]!;
        for (const override of p.overrides) {
          if (!columnNames.has(override.field)) {
            issues.push({
              path: `tables.${tableName}.personas[${i}].overrides.${override.field}`,
              message: `persona override field '${override.field}' not found in table '${tableName}'`,
            });
          }
        }
      }
    }
  }

  return issues;
}
