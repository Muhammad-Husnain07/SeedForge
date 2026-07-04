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
| Tests | Vitest | Fast, Vite-native, ESM-compatible |

## Package Layout

```
packages/
  core/                 — Schema IR, relationship graph, semantic analyzer,
                          distributions, rules engine, generation engine.
                          DB-agnostic — no database drivers.
                          Deps: @faker-js/faker, zod.

  adapter-postgres/     — Postgres introspection (INFORMATION_SCHEMA, pg_catalog)
                          + bulk writer (planned). Deps: pg, @seedforge/core.

  adapter-mysql/        — MySQL introspection (INFORMATION_SCHEMA)
                          + bulk writer (planned). Deps: mysql2, @seedforge/core.

  adapter-mongodb/      — MongoDB schema inference (document sampling via
                          $sample aggregation). Deps: mongodb, @seedforge/core.

  cli/                  — The `seedforge` command. Thin orchestration.
                          Deps: commander, all of the above.

  studio/               — Local web dashboard (stretch goal, placeholder).
```

## Data Flow

```
Database
   │
   ▼  (adapter introspects)
Schema IR (tables, columns, types, FKs, constraints)
   │
   ▼  (core — semantic analyzer + rules engine)
Generator Plan (per-column generator functions × distributions × correlations)
   │
   ▼  (core — generation engine, seeded PRNG)
Row Stream (flat row objects with resolved FK references)
   │
   ▼  (core — validation layer)
Validated Row Stream
   │
   ▼  (adapter — bulk writer)
Database
```

## Design Principles

### 1. Deterministic by default
Same seed + schema + config → same dataset. Reproducible across machines and CI.

### 2. AI at suggestion time only
LLM (Claude) is called only when the user explicitly requests semantic or business-rule suggestions. Generation itself is a pure function.

### 3. DB-agnostic core
The `core` package never imports a database driver. Each adapter translates concrete DB metadata into a shared Schema IR.

### 4. Schema drift is a first-class concern
Every generation run produces a lockfile. Before generating, SeedForge compares the live schema to the lockfile and warns on drift.

## Current State (Milestone II Complete)

- ✅ Monorepo tooling — pnpm workspaces, Turborepo, TypeScript strict
- ✅ Core domain types — `LogicalType`, `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `ForeignKey`
- ✅ Postgres introspection — 7 information_schema queries, enum detection, 6 tests
- ✅ MySQL introspection — equivalent queries, Enum parsing, `TINYINT(1)` → boolean, 7 tests
- ✅ MongoDB inference — document sampling, nested flattening, extended JSON, 8 tests
- ✅ Core dispatcher — registry pattern, `computeSchemaHash()` canonical SHA256, 5 tests
- ✅ Docker fixture — Postgres 16 + MySQL 8 with 7-table e-commerce schema
- 🔄 **Next: Relationship graph & dependency resolution**
