# Configuration DSL Reference

SeedForge uses a TypeScript configuration file (`seedforge.config.ts`) with full type-checking via the `defineConfig()` helper.

## Basic Structure

```typescript
import { defineConfig } from '@seedforge/core';

export default defineConfig({
  connection: { /* database connection */ },
  tables: { /* per-table configuration */ },
  plugins: ['@seedforge/plugin-geo'],
});
```

## `connection`

```typescript
connection: {
  dialect: 'postgres' | 'mysql' | 'mongodb';
  host?: string;       // default: localhost
  port?: number;       // default: 5432 (pg), 3306 (mysql), 27017 (mongo)
  database: string;
  user?: string;
  password?: string;
  connectionString?: string;  // alternative to individual fields
}
```

## `tables`

Each key in `tables` matches a table name in the database.

### `count`

Fixed row count:

```typescript
users: { count: 100 }
```

Dynamic count from a distribution:

```typescript
products: { count: { kind: 'uniformInt', params: { min: 40, max: 60 } } }
```

### `countPerParent`

Rows per parent row (for child tables in one-to-many relationships):

```typescript
orders: {
  countPerParent: {
    users: { kind: 'paretoInt', params: { min: 0, max: 30, alpha: 1.16 } }
  }
}
```

### `fields`

Override the inferred generator for specific columns:

```typescript
users: {
  fields: {
    email: { kind: 'faker', params: { method: 'internet.email' } },
    role: { kind: 'weighted-categorical', params: {
      values: ['admin', 'moderator', 'user'],
      weights: [0.05, 0.15, 0.8]
    }},
    city: { kind: 'geo.city', params: { country: 'United States' } },
  }
}
```

### Derived Fields

Compute a value from other columns in the same row:

```typescript
users: {
  fields: {
    display_name: {
      kind: 'derived',
      params: {
        fn: (row) => `${row.first_name} ${row.last_name}`,
      },
    },
  },
}
```

### `personas`

Define weighted sub-populations with field overrides and child-table cascades:

```typescript
users: {
  count: 1000,
  personas: [
    {
      name: 'power_user',
      selectionWeight: 0.15,
      overrides: {
        role: { kind: 'constant', params: { value: 'admin' } },
      },
      cascades: {
        orders: 8,  // power users get 8 orders instead of the default distribution
      },
    },
    {
      name: 'inactive',
      selectionWeight: 0.10,
      overrides: {
        status: { kind: 'constant', params: { value: 'inactive' } },
      },
      cascades: {
        orders: 0,  // inactive users get no orders
      },
    },
  ],
}
```

## Generator Kinds

| Kind | Params | Description |
|------|--------|-------------|
| `uuid` | — | Random UUID v4 |
| `faker` | `method: string` | Faker.js method (e.g., `'internet.email'`, `'person.firstName'`) |
| `bounded-integer` | `min: number`, `max: number` | Random integer in range |
| `float` | `min: number`, `max: number`, `decimals?: number` | Random float in range |
| `boolean` | — | Random boolean |
| `timestamp` | `start?: string`, `end?: string` | Random datetime in range (ISO 8601) |
| `currency` | — | Random USD amount (decimal) |
| `enum` | `values: string[]` | Random value from enum set |
| `weighted-categorical` | `values: any[]`, `weights: number[]` | Weighted random selection |
| `constant` | `value: any` | Always returns the same value |
| `derived` | `fn: (row, ctx?) => any` | Computed from other columns |
| `slug` | — | URL-safe slug from faker |
| `reference` | — | FK reference (auto-resolved) |
| `geo.city` | `country?: string`, `countryCode?: string` | Real city with lat/lng (plugin) |

## Distribution Functions

Used in `count`, `countPerParent`, and other numeric parameters.

| Function | Params | Description |
|----------|--------|-------------|
| `uniformInt` | `min, max` | Uniform random integer |
| `uniformReal` | `min, max` | Uniform random float |
| `weightedCategorical` | `values, weights` | Weighted selection |
| `paretoInt` | `min, max, alpha` | Pareto (power-law) integer — 80/20 distributions |
| `exponential` | `lambda` | Exponential distribution |
| `normal` | `mean, stddev` | Normal (Gaussian) distribution |
| `zipf` | `n, alpha` | Zipf distribution — word frequency-like |
| `recencyWeighted` | `min, max, recencyPower` | More recent values are more likely |

## Null Injection

By default, SeedForge injects nulls in nullable columns based on their logical type. Override globally:

```typescript
{
  nullProbability: 0.1,  // 10% null for all nullable columns
}
```

Or per column in `fields`:

```typescript
{
  fields: {
    middle_name: { kind: 'faker', params: { method: 'person.firstName' }, nullProbability: 0.7 },
  }
}
```

## Plugins

Plugins listed in `plugins: [...]` are loaded and can register custom generator kinds. See [Plugin Authoring Guide](plugins.md).

```typescript
plugins: [
  '@seedforge/plugin-geo',
  './path/to/local-plugin',
  { name: 'seedforge-plugin-custom', options: { apiKey: '...' } },
]
```

## Example

Full working example at [examples/ecommerce/seedforge.config.ts](../examples/ecommerce/seedforge.config.ts).
