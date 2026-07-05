# SeedForge

**Intelligent, deterministic database seeding for Postgres, MySQL, and MongoDB.**

SeedForge introspects your database schema, infers column semantics, applies business rules, and generates realistic relational seed data — deterministically and reproducibly.

## Status

Pre-alpha — under active development. Milestone X (Studio Dashboard) is complete.

## Monorepo Structure

```
seedforge/
├── packages/
│   ├── core/              — Schema IR, relationship graph, semantic analyzer,
│   │                         distributions, config DSL, generation engine,
│   │                         validation layer, lockfile management, plugin system,
│   │                         bundle export/import, parallel worker_threads
│   ├── adapter-postgres/  — Postgres introspection + bulk writer (`pg` driver)
│   ├── adapter-mysql/     — MySQL introspection + bulk writer (`mysql2`)
│   ├── adapter-mongodb/   — MongoDB schema inference + bulk writer (`mongodb`)
│   ├── cli/               — CLI orchestration: seed, generate, validate, suggest
│   │                         (LLM), introspect, diff, export, import, reset, doctor, studio
│   └── studio/            — Local web dashboard: Fastify server + React/Vite frontend
│                            ER diagram (React Flow), live config preview (SSE),
│                            one-click seed with progress
├── fixtures/ecommerce/    — Test fixtures: schema.sql, docker-compose.yml, seed data
├── docs/                  — Architecture, roadmap, setup guide, adapter docs, benchmarks
└── tsconfig.base.json     — Shared TypeScript strict config
```

## Quick Start

```bash
# Install
pnpm install

# Build all packages
pnpm build

# Start test databases
docker compose -f fixtures/ecommerce/docker-compose.yml up -d

# Run all tests
pnpm test

# Lint
pnpm lint

# Launch the local web studio dashboard
seedforge studio --config examples/ecommerce/seedforge.config.ts
```

## Key Features

### Introspection & Schema Analysis
- **Multi-database introspection** — Postgres (INFORMATION_SCHEMA + pg_catalog), MySQL (INFORMATION_SCHEMA), MongoDB (document sampling)
- **Registry pattern dispatcher** — `registerIntrospector()` / `introspect(config)` unified API
- **Type normalization** — Native DB types mapped to a shared `LogicalType` enum
- **Enum detection** — Postgres `pg_enum` labels, MySQL `ENUM(...)` parsing
- **Check constraint parsing** — `BETWEEN`, `IN`, `>`, `<`, `>=`, `<=` for integer columns
- **MongoDB schema inference** — nested flattening, extended JSON ($oid, $date), nullable tracking

### Relationship Graph
- **FK dependency resolution** — topological sort, insertion order determination
- **Cycle detection** — self-referential FK isolation, multi-table cycle detection
- **Junction table classification** — composite-PK + 2-FK → many-to-many edge merging
- **One-to-one detection** — FK columns with unique constraints

### Semantic Analysis
- **20+ column-name rules** — email, phone, name, address, currency, URL, IP, slug, SKU, rating, timestamp, boolean flag, enum, FK reference, and more
- **Confidence scoring** — per-match confidence 0–1 with configurable threshold
- **Rule priority system** — deterministic override ordering by priority

### Statistical Distributions
- **8 distribution functions** — uniformInt, uniformReal, weightedCategorical, paretoInt, exponential, normal, zipf, recencyWeighted
- **Seeded PRNG** — mulberry32 with `deriveStream()` for independent sub-streams per cell
- **Deterministic reproducibility** — same seed + config → identical dataset

### Configuration DSL
- **Zod-validated config** — table counts, field overrides, count-per-parent, personas, cascades
- **Derived fields** — custom `fn(row, ctx)` functions for computed columns
- **Persona system** — weighted persona selection with field overrides and child-table cascades

### Generation Engine
- **20+ generator kinds** — uuid, faker, weighted-categorical, bounded-integer, boolean, timestamp, currency, FK reference, derived, slug, and more
- **Deterministic PRNG streaming** — independent sub-streams per table/row/field
- **FK resolution** — parent-row PK caching, self-referential FK patch phase
- **Unique enforcement** — retry loop with configurable `retryLimit`
- **Null injection** — per-column nullProbability based on logical type
- **Parallel generation** — `generateParallel()` uses `worker_threads` to process independent dependency levels concurrently; byte-identical output to sequential mode
- **Bounded backpressure** — `BoundedQueue` prevents runaway memory between generation and write stages
- **Configurable batch sizes** — per-adapter defaults: Postgres 5000, MySQL 1000, MongoDB 5000; overridable via `--batch-size`

### Streaming Pipeline
- **Fully streaming** — generation yields batches via async generator; writers consume one batch at a time with no full-table accumulation
- **Patch phase** — self-referential FK updates are applied after inserts in a dedicated stream phase
- **Progress events** — `WriteProgressEmitter` streams per-table row counts during write

### Database Writers
- **Postgres** — multi-row `INSERT` (small batches) / `COPY` (large batches), `fresh`/`truncate`/`append` modes, transaction rollback on error, progress events
- **MySQL** — multi-row `INSERT`, same write modes and rollback behavior
- **MongoDB** — `insertMany`, same write modes and rollback behavior

### Validation & Constraint Checking
- **Pre-flight validation** — catches misconfigurations before any DB connection:
  - NOT NULL columns with non-zero null probability
  - Enum/CHECK values outside declared allowed set
  - Unique constraints with insufficient generator cardinality
  - FK insertion order violations
- **Post-write verification** — opt-in validation after generation:
  - Row count match against plan
  - Random-sample FK reference integrity (configurable sample size, default 50)
  - Junction table orphan detection
- **Structured results** — grouped-by-table pass/fail report, CI-gateable via `valid` boolean

### Schema Drift Detection
- **Canonical schema hashing** — `computeSchemaHash()` produces deterministic SHA256 digests
- **Lockfile comparison** — drift warnings before generation (planned)

### Local Studio Dashboard
- **Fastify backend** — serves static frontend SPA, provides REST + SSE APIs for schema, graph, config, plan, and seed execution
- **React + Vite frontend** — ER diagram (React Flow), interactive config panel, one-click "Seed now", live progress via SSE
- **Inline config editing** — in-memory config overrides applied before seed; persist edits back to `seedforge.config.ts`
- **Deterministic parity** — studio's "Seed now" produces identical results to CLI `seedforge seed` for the same config + seed

## Project Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages (Turborepo parallel) |
| `pnpm test` | Run all tests |
| `pnpm lint` | ESLint across all packages |
| `pnpm clean` | Remove all `dist/` folders |
| `pnpm dev` | Watch mode for all packages |
| `pnpm studio:dev` | Studio dev mode (Vite dev server + Fastify backend) |

## Benchmarks

With a 1M `order_items` scale (1,886,991 total rows across 7 tables) on Windows 11 x64 / Node 22:
- **Throughput**: ~7,989 rows/s (236.2 s total)
- **Memory**: 264 MB RSS delta (well under 512 MB ceiling)
- **Determinism**: sequential and parallel mode produce byte-identical output for the same seed

See [docs/benchmarks.md](docs/benchmarks.md) for full numbers across 10K / 100K / 1M scales.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan.

## Contributing

See [docs/SETUP.md](docs/SETUP.md) for local development setup.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Adapters](docs/ADAPTERS.md)
- [Setup Guide](docs/SETUP.md)
- [Roadmap](docs/ROADMAP.md)
- [Benchmarks](docs/benchmarks.md)
