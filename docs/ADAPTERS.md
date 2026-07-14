# Database Adapters

SeedForge uses a registry-based adapter pattern to support multiple database backends. Each adapter is an independent `@seed-forge/adapter-*` package that depends on `@seed-forge/core` (types only — no circular dependency).

## Architecture

```
core/introspect.ts          ← registry dispatch (introspection)
  │
  ├── adapter-postgres/      ← pg driver, INFORMATION_SCHEMA + pg_catalog
  ├── adapter-mysql/         ← mysql2 driver, INFORMATION_SCHEMA (uppercase columns)
  └── adapter-mongodb/       ← mongodb driver, document sampling inference

core/writer/types.ts         ← BatchWriter interface (shared)
  │
  ├── adapter-postgres/      ← multi-row INSERT / COPY, transaction-managed
  ├── adapter-mysql/         ← multi-row INSERT, transaction-managed
  └── adapter-mongodb/       ← insertMany, transaction-managed
```

## Registry Pattern

Adapters register themselves with the core dispatcher:

```typescript
import { registerIntrospector, introspect } from '@seed-forge/core';
import { introspect as pgIntrospect } from '@seed-forge/adapter-postgres';

registerIntrospector('postgres', { introspect: pgIntrospect });
const schema = await introspect({
  dialect: 'postgres',
  connectionString: 'postgres://user:pass@localhost:5432/db',
});
```

## Common Writer Interface

All adapters implement the `BatchWriter` interface:

```typescript
interface BatchWriter {
  write(
    batches: AsyncIterable<GenerationBatch>,
    graph: RelationshipGraph,
    schema: DatabaseSchema,
    options?: WriteOptions,
  ): Promise<WriteResult>;
}
```

### Write Modes

| Mode | Behavior |
|------|----------|
| `fresh` | Error if any table/collection already contains rows |
| `truncate` | Clear all rows before writing |
| `append` | Add to existing data without clearing |

### Progress Events

Writers emit progress events via the `WriteProgressEmitter` for CLI progress bars and monitoring:

```typescript
interface WriteProgressEvent {
  table: string;
  phase: 'insert' | 'patch' | 'truncate' | 'verify';
  rowsWritten: number;
  rowsTotal: number;
}
```

### Transaction Safety

All three adapters wrap writes in a single transaction. If any batch fails, the transaction is rolled back, leaving the database in its original state. The `fresh` mode check also runs within the transaction.

---

## Adapter: Postgres (`@seed-forge/adapter-postgres`)

### Introspection

| Query | Tables |
|-------|--------|
| Enum labels | `pg_type` + `pg_enum` (public namespace) |
| User tables | `information_schema.tables` (table_type = 'BASE TABLE') |
| Columns | `information_schema.columns` |
| Primary keys | `table_constraints` + `key_column_usage` |
| Foreign keys | `table_constraints` + `key_column_usage` + `constraint_column_usage` + `referential_constraints` |
| Unique constraints | `table_constraints` + `key_column_usage` |
| Check constraints | `table_constraints` + `check_constraints` |

### Type Mapping

Maps ~35+ native PG types to `LogicalType`. Notable mappings:
- `int4`, `int8`, `serial`, `oid` → `integer`
- `numeric`, `decimal`, `float8`, `money` → `float`
- `USER-DEFINED` (in enum set) → `enum`
- `ARRAY` → `array`
- `timestamptz`, `timestamp with time zone` → `timestamp`

### Writer

The Postgres writer uses two insert strategies depending on batch size:

- **Multi-row INSERT** (batches < 100 rows): `INSERT INTO table (cols) VALUES (...), (...), ... ON CONFLICT DO NOTHING`
- **COPY** (batches >= 100 rows): `COPY table (cols) FROM STDIN WITH (FORMAT csv)` via `pg-copy-streams`

For self-referential FK resolution, the writer applies a two-phase write:
1. **Insert phase**: write all rows with FK columns set to NULL
2. **Patch phase**: update FK columns in-place using `UPDATE ... FROM (VALUES ...)` for bulk patching

---

## Adapter: MySQL (`@seed-forge/adapter-mysql`)

### Introspection

Equivalent INFORMATION_SCHEMA queries against the current `DATABASE()`. Uses uppercase column references (MySQL stores metadata columns in upper case; `mysql2` v3 preserves original case).

### Notable Features

- **Enum parsing** — `column_type` field like `enum('a','b')` parsed via custom quote-aware parser
- **`TINYINT(1)` detection** — `isTinyInt1()` returns `boolean` for `tinyint(1)` columns

### Type Mapping

Maps 30+ MySQL types. Notable:
- `tinyint(1)` → `boolean` (via column_type regex match)
- `enum(...)` → `enum` (via column_type parsing)
- `datetime`, `timestamp` → `timestamp`
- `year` → `integer`

### Writer

The MySQL writer uses multi-row `INSERT IGNORE` statements for all batch sizes:

```
INSERT IGNORE INTO `table` (col1, col2) VALUES (?, ?), (?, ?), ...
```

For self-referential FK resolution:
1. **Insert phase**: write all rows with FK columns set to NULL
2. **Patch phase**: bulk `UPDATE ... JOIN` to patch FK values

---

## Adapter: MongoDB (`@seed-forge/adapter-mongodb`)

### Inference Approach

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

### Inferred Column Structure

```typescript
// From: { _id: { "$oid": "..." }, address: { city: "NYC" } }
// Produces:
[
  { name: "_id", logicalType: "uuid", nullable: false, isPrimaryKey: true },
  { name: "address.city", logicalType: "string", nullable: true },
]
```

### Writer

The MongoDB writer uses `insertMany` for all batch sizes:

```typescript
await collection.insertMany(docs, { ordered: false });
```

For self-referential FK resolution:
1. **Insert phase**: write all documents
2. **Patch phase**: `updateMany` with per-document `$set` operations

### Limitations

- Array element types are not deeply inferred; arrays are marked `'array'`
- No FK detection (MongoDB has no native referential constraints)
- Inference accuracy scales with sample size (max 1,000 docs)
- MongoDB has no native transactions in all configurations; rollback is best-effort

---

## Adapter: SQLite (`@seed-forge/adapter-sqlite`)

### Introspection

The SQLite adapter uses an in-process SQLite engine (`sql.js`, WebAssembly-based, no native dependencies) and queries the following system tables and PRAGMAs:

| Query / PRAGMA | Purpose |
|---|---|
| `sqlite_master` | List user tables (excludes `sqlite_%` internal tables) |
| `PRAGMA table_info(name)` | Columns: name, declared type, notnull, default, pk ordinal |
| `PRAGMA foreign_key_list(name)` | Foreign keys: referenced table/columns, on delete/update rules |
| `PRAGMA index_list(name)` | Indexes: name, unique flag, origin (pk / c / u) |
| `PRAGMA index_info(name)` | Columns in each unique index |

Check constraints are parsed from the `sqlite_master.sql` DDL text using regex, since SQLite does not expose them via PRAGMAs.

### Type Mapping & Affinity

SQLite uses a **type-affinity** system rather than strict column types. A column's declared type determines its storage affinity, but any value can be stored in any column regardless. The adapter maps from the **declared type** (as reported by `PRAGMA table_info`) to the `LogicalType` enum:

| Declared Type Convention | LogicalType | Rationale |
|---|---|---|
| `INT`, `INTEGER`, `BIGINT`, `SMALLINT`, `TINYINT`, etc. | `integer` | Direct numeric mapping |
| `REAL`, `FLOAT`, `DOUBLE`, `NUMERIC`, `DECIMAL` | `float` | Floating-point / arbitrary precision |
| `TEXT`, `VARCHAR`, `CHAR`, `CLOB` | `string` | Text storage class |
| `BLOB` | `binary` | Binary large object |
| `BOOLEAN` | `boolean` | Common convention; stored as INTEGER 0/1 |
| `DATE` | `date` | Convention; stored as TEXT (ISO 8601) or INTEGER (Julian day) |
| `DATETIME`, `TIMESTAMP` | `timestamp` | Convention; stored as TEXT or INTEGER |
| `UUID` | `uuid` | Convention; stored as TEXT |
| `JSON` | `json` | Convention; stored as TEXT |

Columns with **no declared type** default to `BLOB` affinity and are mapped to `string`, matching the common pattern of storing arbitrary data as text.

**Judgment calls:**
- `DATETIME` / `TIMESTAMP` → `timestamp` rather than `string` because these are almost universally used for date/time values in SQLite schemas, even though SQLite stores them as TEXT or INTEGER under the hood.
- `BOOLEAN` → `boolean` rather than `integer` because it's the most common convention in ORMs like Prisma and Drizzle, and SeedForge's generator can produce proper boolean values.
- `NUMERIC` / `DECIMAL` → `float` rather than `integer` because they carry a decimal point in practice.
- `DATE` → `date` rather than `string` following the same convention as PostgreSQL's `date` type.

### Writer

The SQLite writer uses batched `INSERT INTO table (cols) VALUES (...)` statements within a single transaction:

```
BEGIN;
INSERT INTO "users" ("id", "name") VALUES (?, ?), (?, ?), ...;
INSERT INTO "posts" ("id", "author_id", "title") VALUES (?, ?, ?), ...;
COMMIT;
```

**Key characteristics:**
- **No COPY equivalent** — SQLite has no bulk-load mechanism like PostgreSQL's COPY or MySQL's `LOAD DATA`. The adapter groups rows into batches (default 1,000 rows, respecting a max of 999 SQL variables per query) within a transaction, which provides most of the throughput benefit.
- **File persistence** — The adapter uses `sql.js` (WASM-based SQLite, no native compilation needed). After the transaction completes, the database buffer is exported to disk. This means the entire `.db` file is rewritten on each `write()` call, which is fine for seed-data sizes (typically < 10MB).
- **Transaction safety** — Writes are wrapped in BEGIN/COMMIT/ROLLBACK. If any batch fails, the transaction is rolled back and the original `.db` file is preserved.

### Limitations

- SQLite has no native `ENUM` type — enum constraints must be expressed as `CHECK (col IN (...))`.
- SQLite has no native `UUID` type — UUIDs are stored as `TEXT` in practice.
- No `COPY` / bulk-load equivalent — performance for very large datasets may be lower than PostgreSQL or MySQL.
- The `sql.js` engine is in-process and WASM-based; maximum database size is limited by available memory (typically 1–2 GB in practice).
- Concurrent writes are not supported — the adapter opens the database exclusively for writing.
