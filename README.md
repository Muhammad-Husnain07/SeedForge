# SeedForge

**Intelligent, deterministic database seeding for Postgres, MySQL, and MongoDB.**

SeedForge introspects your database schema, infers column semantics, applies business rules, and generates realistic relational seed data — deterministically and reproducibly.

## Quick Start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) (for the database) and [Node.js](https://nodejs.org/) >= 18.17.

```bash
# 1. Start a Postgres container
docker run -d --name seedforge-pg \
  -e POSTGRES_USER=seedforge \
  -e POSTGRES_PASSWORD=seedforge \
  -e POSTGRES_DB=seedforge \
  -p 5432:5432 \
  postgres:16

# 2. Scaffold a config file
npx @seed-forge/seedforge init

# 3. Seed your database
npx @seed-forge/seedforge seed
```

That's it. By default SeedForge introspects the target database, infers column semantics, builds a generation plan, and writes realistic data to every table.

You can also scaffold a reusable project folder:

```bash
npx create-seedforge my-project
cd my-project
seedforge init       # or edit .env first
seedforge seed
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

### Schema Drift Detection
- **Canonical schema hashing** — `computeSchemaHash()` produces deterministic SHA256 digests
- **Lockfile comparison** — drift warnings before generation
- **Lockfile bundle** — portable `.sfbundle` for team sharing and CI reproducibility

### Plugin System
- **Generator registry** — plugins register custom generator kinds (e.g. `geo.city`)
- **Lifecycle hooks** — `onSchemaIntrospected`, `onBeforeGenerate`, `onAfterWrite`
- **Example plugin** — `@seed-forge/plugin-geo` provides realistic geographic data

### Local Studio Dashboard
- **Fastify backend** — serves static frontend SPA, provides REST + SSE APIs for schema, graph, config, plan, and seed execution
- **React + Vite frontend** — ER diagram (React Flow), interactive config panel, one-click "Seed now", live progress via SSE
- **Inline config editing** — in-memory config overrides applied before seed; persist edits back to `seedforge.config.ts`
- **Deterministic parity** — studio's "Seed now" produces identical results to CLI `seedforge seed` for the same config + seed

### LLM-Assisted Suggestions
- **`seedforge suggest`** — sends unresolved column metadata to an LLM (Claude, GPT, Gemini, etc.)
- **Schema-only by default** — safe for any database; `--include-samples` for value-aware suggestions
- **Zero LLM calls during generation** — the AI is consulted only at suggest-time

## Package Reference

The `npx @seed-forge/seedforge` entry point auto-installs `@seed-forge/cli` and all adapters. If you prefer a minimal install, pull only the packages you need:

```bash
npm install @seed-forge/adapter-postgres
npx @seed-forge/cli seed
```

| Package | Description |
|---------|-------------|
| `@seed-forge/seedforge` | Zero-install entry point (meta-package, delegates to `@seed-forge/cli`) |
| `create-seedforge` | Project scaffold (`npx create-seedforge my-project`) |
| `@seed-forge/cli` | CLI orchestration (seed, generate, validate, suggest, studio) |
| `@seed-forge/core` | Engine, schema IR, distributions, config DSL, lockfile, plugin system |
| `@seed-forge/adapter-postgres` | Postgres introspection + bulk writer |
| `@seed-forge/adapter-mysql` | MySQL introspection + bulk writer |
| `@seed-forge/adapter-mongodb` | MongoDB schema inference + bulk writer |
| `@seed-forge/studio` | Web dashboard (Fastify + React/Vite) |

## Project Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages (Turborepo parallel) |
| `pnpm test` | Run all unit tests |
| `pnpm test:integration` | Run integration tests (requires Docker) |
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

## Documentation

- [CLI Reference](docs/cli/reference.md) — auto-generated from `seedforge --help`
- [Config DSL Reference](docs/config-dsl.md) — all config options, generators, distributions, personas
- [Architecture](docs/ARCHITECTURE.md)
- [Adapters](docs/ADAPTERS.md)
- [Plugin Authoring Guide](docs/plugins.md)
- [Setup Guide](docs/SETUP.md)
- [Roadmap](docs/ROADMAP.md)
- [Benchmarks](docs/benchmarks.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, code style, and PR workflow.

## License

[MIT](LICENSE)
