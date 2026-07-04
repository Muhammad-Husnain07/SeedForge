# Database Adapters

SeedForge uses a registry-based adapter pattern to support multiple database backends. Each adapter is an independent `@seedforge/adapter-*` package that depends on `@seedforge/core` (types only — no circular dependency).

## Architecture

```
core/introspect.ts          ← registry dispatch
  │
  ├── adapter-postgres/      ← pg driver, INFORMATION_SCHEMA + pg_catalog
  ├── adapter-mysql/         ← mysql2 driver, INFORMATION_SCHEMA (uppercase columns)
  └── adapter-mongodb/       ← mongodb driver, document sampling inference
```

## Registry Pattern

Adapters register themselves with the core dispatcher:

```typescript
import { registerIntrospector, introspect } from '@seedforge/core';
import { introspect as pgIntrospect } from '@seedforge/adapter-postgres';

registerIntrospector('postgres', { introspect: pgIntrospect });
const schema = await introspect({
  dialect: 'postgres',
  connectionString: 'postgres://user:pass@localhost:5432/db',
});
```

## Adapter: Postgres (`@seedforge/adapter-postgres`)

### Source queries

| Query | Tables |
|-------|--------|
| Enum labels | `pg_type` + `pg_enum` (public namespace) |
| User tables | `information_schema.tables` (table_type = 'BASE TABLE') |
| Columns | `information_schema.columns` |
| Primary keys | `table_constraints` + `key_column_usage` |
| Foreign keys | `table_constraints` + `key_column_usage` + `constraint_column_usage` + `referential_constraints` |
| Unique constraints | `table_constraints` + `key_column_usage` |
| Check constraints | `table_constraints` + `check_constraints` |

### Type mapping

Maps ~35+ native PG types to `LogicalType`. Notable mappings:
- `int4`, `int8`, `serial`, `oid` → `integer`
- `numeric`, `decimal`, `float8`, `money` → `float`
- `USER-DEFINED` (in enum set) → `enum`
- `ARRAY` → `array`
- `timestamptz`, `timestamp with time zone` → `timestamp`

## Adapter: MySQL (`@seedforge/adapter-mysql`)

### Source queries

Equivalent INFORMATION_SCHEMA queries against the current `DATABASE()`. Uses uppercase column references (MySQL stores metadata columns in upper case; `mysql2` v3 preserves original case).

### Notable features

- **Enum parsing** — `column_type` field like `enum('a','b')` parsed via custom quote-aware parser
- **`TINYINT(1)` detection** — `isTinyInt1()` returns `boolean` for `tinyint(1)` columns

### Type mapping

Maps 30+ MySQL types. Notable:
- `tinyint(1)` → `boolean` (via column_type regex match)
- `enum(...)` → `enum` (via column_type parsing)
- `datetime`, `timestamp` → `timestamp`
- `year` → `integer`

## Adapter: MongoDB (`@seedforge/adapter-mongodb`)

### Inference approach

MongoDB has no formal schema, so SeedForge **infers** one by sampling documents:

1. Connect to the database, list all collections
2. For each collection:
   - Get estimated document count
   - Sample up to 1,000 documents (uses `$sample` aggregation if count > 1000)
3. Walk every sampled document:
   - **Flatten nested objects** to dot-notation columns (`address.city`, `address.zip`)
   - **Detect extended JSON** — `{ "$oid": "..." }` → uuid, `{ "$date": "..." }` → timestamp
   - **Track nullability** — fields absent or `null` in any doc are marked nullable
   - **Merge types** — integer+float → float, type mismatch → string
4. Return a standard `TableSchema` with empty `foreignKeys` and `uniqueConstraints`

### Inferred column structure

```typescript
// From: { _id: { "$oid": "..." }, address: { city: "NYC" } }
// Produces:
[
  { name: "_id", logicalType: "uuid", nullable: false, isPrimaryKey: true },
  { name: "address.city", logicalType: "string", nullable: true },
]
```

### Limitations

- Array element types are not deeply inferred; arrays are marked `'array'`
- No FK detection (MongoDB has no native referential constraints)
- Inference accuracy scales with sample size (max 1,000 docs)
