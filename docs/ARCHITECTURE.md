# SeedForge Architecture

## The Problem

1. **Manual seeding is tedious** — hand-writing INSERT statements for hundreds of realistic rows takes hours.
2. **Faker libraries generate isolated values** — `faker.name()` produces "John Doe", but no realistic cross-table relationships.
3. **No real-world statistical patterns** — 80% of users are inactive, 20% drive 90% of revenue. Faker distributions are uniform by default.
4. **Schema drift silently breaks seeds** — a new required column and the carefully hand-crafted seed file crashes at runtime.
5. **Not shareable or reproducible** — seed data lives on one machine with no versioning or lockfile.

## The Solution

A CLI + core engine that:

1. **Introspects** a real database schema — tables, columns, types, nullability, foreign keys, indexes, defaults
2. **Infers** per-column data generators from column names, types, and constraints
3. **Applies** developer-defined business rules — distributions, personas, cross-table correlations
4. **Generates** a fully deterministic dataset from a single numeric seed
5. **Validates** generated data against schema constraints before writing
6. **Writes** efficiently using bulk inserts
7. **Exports / imports** via lockfile + bundle for team sharing

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5 (strict, ESM) | Type safety, ecosystem |
| Monorepo | pnpm + Turborepo | Fast installs, parallel builds |
| DB drivers | `pg`, `mysql2`, `mongodb` | Mature, community standard |
| Fake data | `@faker-js/faker` | Best-in-class, seeded PRNG |
| CLI | Commander.js | Declarative subcommand support |
| Validation | Zod | Runtime schema validation, TS-first |
| Property tests | fast-check | Generator-based property testing |
| Tests | Vitest | Fast, Vite-native, ESM-compatible |

## Package Layout

```
packages/
  core/                 — Schema IR, relationship graph, semantic analyzer,
                           distributions, config DSL, generation engine,
                           validation layer. DB-agnostic — no database drivers.
                           Deps: @faker-js/faker, zod.

  adapter-postgres/     — Postgres introspection (INFORMATION_SCHEMA, pg_catalog)
                          + bulk writer (multi-row INSERT, COPY, fresh/truncate/append).
                          Deps: pg, @seed-forge/core.

  adapter-mysql/        — MySQL introspection (INFORMATION_SCHEMA)
                          + bulk writer (multi-row INSERT, fresh/truncate/append).
                          Deps: mysql2, @seed-forge/core.

  adapter-mongodb/      — MongoDB schema inference (document sampling via
                          $sample aggregation) + bulk writer (insertMany).
                          Deps: mongodb, @seed-forge/core.

  cli/                  — The `seedforge` command. Thin orchestration.
                            Deps: commander, all of the above.

  studio/               — Local web dashboard. Fastify backend + React/Vite frontend.
                            REST APIs for schema, graph, config, plan, seed execution.
                            SSE-based live progress. ER diagram via React Flow.

  integration-tests/    — Testcontainers-based end-to-end pipeline tests
                            (private, not published).

  seedforge-plugin-geo/ — Example plugin demonstrating the plugin system
                            (private, not published).
```

## Data Flow

```
Database
   │
   ▼  (adapter introspects)
Schema IR (tables, columns, types, FKs, constraints, enums)
   │
   ▼  (core — graph/buildGraph)
Relationship Graph (nodes, edges, insertionOrder, cycles)
   │
   ▼  (core — semantic/analyzer)
Semantic Matches (per-column generator suggestions with confidence)
   │
   ▼  (core — config/merge)
Generation Plan (resolved generators per column, counts, personas)
   │
   ▼  (core — validate/preflight)
Pre-flight Validation (NOT NULL, enum values, unique cardinality, FK order)
   │  ❌ fail → report returned, no DB write
   │  ✅ pass → continue
   ▼  (core — generate/engine, seeded PRNG)
Row Stream (flat row objects with resolved FK references)
   │
   │  [parallel path: BoundedQueue per dependency level → worker_threads
   │   generates independent levels concurrently, byte-identical output]
   │
   ▼  (core — validate/postwrite, opt-in)
Post-write Verification (row counts, FK sample check, junction orphans)
   │
   ▼  (adapter — bulk writer, transaction)
   │  [batch size per adapter: PG 5000, MySQL 1000, MongoDB 5000]
   │  [WriteProgressEmitter streams per-table row counts]
   ▼
Database
```

## Core Subsystems

### 1. Schema IR (`types/index.ts`)
Shared domain types that all adapters map to: `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `ForeignKey`. All adapter tests produce instances of these types.

### 2. Introspection Dispatcher (`introspect.ts`)
Registry pattern: `registerIntrospector(dialect, adapter)` → `introspect(connectionConfig)`. Each adapter module self-registers on import. Includes `computeSchemaHash()` for deterministic schema fingerprinting.

### 3. Relationship Graph (`graph/`)
Topological sort of FK dependencies (Kahn's algorithm) to produce a valid insertion order. Classifies edges as one-to-many / one-to-one / self-referential / many-to-many. Detects and isolates cycles.

### 4. Semantic Analyzer (`semantic/`)
20+ prioritized rules match column names and types to generators. Priority 100 (enum) → Priority 69 (rating). Each rule returns a `GeneratorSpec` with confidence. Unresolved columns are tracked for user override.

### 5. Statistical Distributions (`distributions/`)
Pure PRNG functions built on mulberry32. Each distribution is a function `(prng, params) → value`. Independent sub-streams via `deriveStream(namespace, ...parts)`.

### 6. Config DSL & Plan Builder (`config/`)
- `defineConfig()` — identity helper for type-safe config objects
- `validateConfig()` — Zod schema validation + type compatibility checks
- `buildGenerationPlan()` — merges config overrides with inferred matches; throws on unresolved columns

### 7. Generation Engine (`generate/`)
- `generate()` — async generator that yields `GenerationBatch` objects
- `generateParallel()` — parallel version using `worker_threads`; processes independent dependency levels concurrently
- Determinism guarantee: sequential and parallel produce byte-identical output for the same seed
- Field-level PRNG sub-streams for deterministic per-cell values
- FK resolution via PK cache with self-referential patch phase
- Unique enforcement with configurable retry limit
- Null injection based on column nullability and logical type
- Bounded backpressure via `BoundedQueue` prevents runaway memory

### 8. Validation Layer (`validate/`)
Two-pass validation system:

**Pre-flight** (`validatePreFlight`):
- NOT NULL: detects global `nullProbability > 0` conflicting with NOT NULL columns
- Enum values: statically checks `weighted-categorical` value sets against declared `enumValues` / CHECK `IN` clauses
- Unique cardinality: estimates generator distinct-value domain vs requested row count; warns on mismatch, fails on severe mismatch
- FK ordering: defensive check that referenced tables precede referencing tables in insertion order

**Post-write** (`verifyPostWrite`):
- Row count match against plan (handles `countPerParent` relationships)
- Random-sample FK reference integrity (configurable sample, default 50)
- Junction table orphan detection

Both return structured `{ valid, entries[] }` objects — no direct terminal output, enabling CI gating via the `valid` boolean.

### 9. Database Writers (`writer/`)
Each adapter implements `BatchWriter` with three write modes:
- `fresh` — error if table is non-empty
- `truncate` — clear table before writing
- `append` — add to existing data

Supports batch-oriented progress events (`WriteProgressEmitter`), AbortSignal cancellation, and configurable batch sizes.

Default batch sizes: Postgres 5,000 (switches to COPY above 500), MySQL 1,000, MongoDB 5,000.

## Design Principles

### 1. Deterministic by default
Same seed + schema + config → same dataset. Reproducible across machines and CI.

### 2. AI at suggestion time only
LLM (Claude) is called only when the user explicitly requests semantic or business-rule suggestions. Generation itself is a pure function.

### 3. DB-agnostic core
The `core` package never imports a database driver. Each adapter translates concrete DB metadata into a shared Schema IR.

### 4. Schema drift is a first-class concern
Every generation run produces a lockfile. Before generating, SeedForge compares the live schema to the lockfile and warns on drift.

### 5. Validate early, verify often
Pre-flight catches config mistakes before any DB connection. Post-write verifies data integrity after generation. Both produce structured, CI-gateable results.

## Deviations from the Original Design

The implementation evolved during development in several ways worth noting:

1. **Parallel generation was not in the original plan.** The original architecture assumed a purely sequential generation pipeline. `generateParallel()` with `worker_threads` was added to meet the 1M row throughput target while staying under 512 MB RSS.

2. **Plugin system uses a generator-registry pattern** rather than the originally conceived generic lifecycle-hook approach. The `GeneratorRegistry` with `register(kind, fn)` was simpler to implement and aligned with how the config DSL references generators by kind string. Lifecycle hooks (`beforeGenerate`, `afterGenerate`, etc.) were added later as a second dimension.

3. **`afterGenerate` receives metadata, not the full dataset.** The original plugin spec passed `Record<string, Record<string, unknown>[]>` (all rows). Because the pipeline is streaming (no stage holds a full table), this was changed to `{ tables: string[], totalRows: number }`. Plugins that need row-level access should use `beforeInsert` / `afterInsert`.

4. **Studio evolved from a stretch goal to a full dashboard.** Originally listed as a "nice-to-have," the studio grew into a Fastify backend + React/Vite frontend with SSE-based live progress, an ER diagram (React Flow), and a "Seed now" button that mirrors the CLI exactly.

5. **Lockfile/drift and export/import were implemented earlier than the roadmap planned.** These shipped in Milestone IX/X rather than being separate milestones, because the bundle format was needed for the studio's "download snapshot" feature.

6. **Package count grew.** The original doc listed 6 packages (core, 3 adapters, cli, studio). The actual monorepo now contains 9 packages (adding `integration-tests` and `seedforge-plugin-geo`).

7. **All packages ship at the same version.** With `@changesets/cli` and the `fixed` config, all publishable packages (`@seed-forge/core`, `@seed-forge/adapter-*`, `@seed-forge/cli`, `@seed-forge/studio`) are released together with synced version numbers. This was not part of the original design but simplifies the install experience.

## Current State (Milestone XI Complete)

- ✅ Monorepo tooling — pnpm workspaces, Turborepo, TypeScript strict
- ✅ Core domain types — `LogicalType`, `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `ForeignKey`
- ✅ Postgres introspection — 7 information_schema queries, enum detection, 6 tests
- ✅ MySQL introspection — equivalent queries, enum parsing, `TINYINT(1)` → boolean, 7 tests
- ✅ MongoDB inference — document sampling, nested flattening, extended JSON, 8 tests
- ✅ Core dispatcher — registry pattern, `computeSchemaHash()` canonical SHA256, 5 tests
- ✅ Docker fixture — Postgres 16 + MySQL 8 with 7-table e-commerce schema
- ✅ Relationship graph — topological sort, cycle detection, junction merging, 12 tests
- ✅ Semantic analyzer — 20+ rules, priority system, confidence scoring, 12 tests
- ✅ Statistical distributions — 8 PRNG functions, persona assignment, 20+ tests
- ✅ Config DSL — Zod validation, type compatibility, plan merging, 12 tests
- ✅ Generation engine — 20+ generators, FK resolution, unique enforcement, 15 tests
- ✅ Parallel generation — `generateParallel()` using worker_threads, BoundedQueue backpressure, byte-identical seq/par output
- ✅ Database writers — Postgres (COPY/INSERT), MySQL, MongoDB, 30+ integration tests
- ✅ Validation layer — pre-flight (4 checks) + post-write (3 checks), 9 tests
- ✅ Lockfile & schema drift detection — canonical schema hashing, lockfile generation and comparison
- ✅ Export/import bundles — portable seed bundle export/import for team sharing
- ✅ LLM suggest — `seedforge suggest` subcommand for Claude-powered column inference
- ✅ Full CLI — seed, generate, validate, suggest, introspect, diff, export, import, reset, doctor, studio
- ✅ Plugin system — custom generators, transformers, data sources via registration API
- ✅ Integration test suite — Testcontainers-based full end-to-end pipeline testing
- ✅ Performance hardening — streaming pipeline, BoundedQueue, benchmark suite, 1M order_items @ 7,989 rows/s
- ✅ Studio dashboard — Fastify backend + React/Vite frontend, ER diagram (React Flow), live progress (SSE), "Seed now" button
- ✅ Changesets monorepo versioning — `@changesets/cli` with `fixed` config for synced releases
- ✅ CI workflows — lint + unit + integration on PR, publish-on-tag with npm provenance
- ✅ README with verified 60-second quick-start — copy-pasteable `docker run` → `npx @seed-forge/cli init` → `npx @seed-forge/cli seed`
- ✅ Config DSL reference — all options, generators, distributions, personas documented
- ✅ CLI reference — auto-generated from Commander's `--help` output (always in sync)
- ✅ Plugin-authoring guide — updated to match actual `afterGenerate` metadata signature
- ✅ Examples project — `examples/ecommerce/` runnable out of the box
- ✅ License, contributing guide, issue templates — MIT, CONTRIBUTING.md, bug report + feature request templates
- 🔄 **Next: Production hardening — HTTPS, auth, multi-user workspaces, cloud-hosted studio**

## Test Suite

| Package | Test count | Environment |
|---|---|---|
| `@seed-forge/core` | ~130+ | Standalone (unit + property) |
| `@seed-forge/adapter-postgres` | ~18 | Docker Postgres 16 |
| `@seed-forge/adapter-mysql` | ~17 | Docker MySQL 8 |
| `@seed-forge/adapter-mongodb` | ~16 | Docker MongoDB 7 |
| `@seed-forge/cli` | ~5 | Standalone |
| **Total** | **~190+** | `docker compose up -d` |

> **Note**: All 258 tests pass across 28 test files as of Milestone X.
