# Plugin System

SeedForge supports plugins that extend its functionality through lifecycle hooks. Plugins can register custom generators, react to schema introspection, and hook into the generation pipeline.

## Interface

Every plugin must export a `SeedForgePlugin` object as its default export:

```typescript
interface SeedForgePlugin {
  name: string;
  version?: string;

  // Called after database introspection completes
  onSchemaIntrospected?(schema: DatabaseSchema): void | Promise<void>;

  // Register custom generators that config DSL can reference by kind
  registerGenerators?(registry: GeneratorRegistry): void;

  // Called before generation starts, with the full GenerationPlan
  beforeGenerate?(plan: GenerationPlan): void | Promise<void>;

  // Called after all generation completes, with all generated rows
  afterGenerate?(dataset: Record<string, Record<string, unknown>[]>): void | Promise<void>;

  // Called before a batch of rows is inserted into a table
  beforeInsert?(table: string, batch: Record<string, unknown>[]): void | Promise<void>;

  // Called after a batch of rows is inserted into a table
  afterInsert?(table: string, batch: Record<string, unknown>[]): void | Promise<void>;
}
```

## Generator Registry

The `registerGenerators` hook receives a `GeneratorRegistry` with these methods:

```typescript
interface GeneratorRegistry {
  register(kind: string, generator: FieldGenerator): void;
  get(kind: string): FieldGenerator | undefined;
  has(kind: string): boolean;
  knownKinds(): string[];
}
```

A `FieldGenerator` is a function with optional metadata:

```typescript
interface FieldGenerator {
  (params: Record<string, unknown>, row: Record<string, unknown>, prng: PRNG, ctx: FieldContext): unknown;

  // Declare which DB logical types this generator is compatible with (for validation)
  compatibleTypes?: string[];

  // Estimate distinct values this generator can produce (for unique constraint checks)
  estimateDistinct?: (params: Record<string, unknown>, count: number) => number | null;
}
```

## Enabling Plugins

Plugins are **never auto-activated**. Add them explicitly to `seedforge.config.ts`:

```typescript
export default defineConfig({
  connection: { ... },
  tables: { ... },
  plugins: ['@seedforge/plugin-geo'],
});
```

Each entry can be:
- An npm package name: `'@seedforge/plugin-geo'`
- A local path: `'./packages/my-plugin'`
- An object with options: `{ name: '@seedforge/plugin-geo', options: { ... } }`

## Example: `@seedforge/plugin-geo`

This built-in example plugin provides a `geo.city` generator that returns internally-consistent city/region/country/lat-lng tuples from a static dataset of real cities.

### Usage

```typescript
// seedforge.config.ts
import { defineConfig } from '@seedforge/core';

export default defineConfig({
  connection: { dialect: 'postgres', connectionString: '...' },
  tables: {
    users: {
      count: 100,
      fields: {
        city: { kind: 'geo.city', params: { country: 'United States' } },
        // Returns: { city: 'Portland', region: 'Oregon', country: 'United States',
        //            countryCode: 'US', latitude: 45.5152, longitude: -122.6784 }
      },
    },
  },
  plugins: ['@seedforge/plugin-geo'],
});
```

### Generator: `geo.city`

| Param | Type | Description |
|-------|------|-------------|
| `country` | string (optional) | Filter to cities in a specific country |
| `countryCode` | string (optional) | Filter to cities in a specific country code (e.g., 'US', 'JP') |

Returns an object with: `{ city, region, country, countryCode, latitude, longitude }`.

The lat/lng values are always consistent with the city name — they come from the same dataset record, so you'll never get "Paris" with coordinates in Tokyo.

### Source

Full source at `packages/seedforge-plugin-geo/`:

- `src/data.ts` — ~100 real cities with verified coordinates
- `src/index.ts` — Plugin implementation registering `geo.city` with `compatibleTypes` and `estimateDistinct`
- `src/index.test.ts` — 7 tests covering correctness, filtering, determinism

The plugin only depends on `@seedforge/core`'s public types (`SeedForgePlugin`, `PRNG`, `GeneratorRegistry`).

## Writing a Plugin

### 1. Create the package

```json
{
  "name": "seedforge-plugin-myplugin",
  "type": "module",
  "dependencies": { "@seedforge/core": "^0.1.0" }
}
```

### 2. Implement the interface

```typescript
// src/index.ts
import type { SeedForgePlugin } from '@seedforge/core';

const plugin: SeedForgePlugin = {
  name: 'seedforge-plugin-myplugin',

  registerGenerators(registry) {
    const myGenerator = Object.assign(
      (params, row, prng) => {
        // Generate a value
        return 'my-value';
      },
      {
        compatibleTypes: ['string'],
        estimateDistinct: (_params, _count) => 1000,
      },
    );

    registry.register('my-custom-kind', myGenerator);
  },
};

export default plugin;
```

### 3. Use it

```typescript
plugins: ['seedforge-plugin-myplugin']
```

Then reference `{ kind: 'my-custom-kind', params: {} }` in any field config.

## Lifecycle Hook Order

1. `onSchemaIntrospected(schema)` — after `introspect()` completes
2. `registerGenerators(registry)` — at plugin load time (before generation)
3. `beforeGenerate(plan)` — before any rows are generated
4. `beforeInsert(table, batch)` — before each batch is written
5. `afterInsert(table, batch)` — after each batch is written
6. `afterGenerate(dataset)` — after all generation completes

## Discoverability

SeedForge scans `node_modules` for packages matching `seedforge-plugin-*` or `@seedforge/plugin-*`. These are listed as available-but-not-enabled — they are never auto-activated.

## Validation Errors

If you remove a plugin from `plugins: [...]` but a field still references its generator kind, you'll get a clear error:

```
unknown generator kind: 'geo.city' for column
```

This is a runtime error from the generation engine, not a crash — the error message tells you exactly which generator is missing.
