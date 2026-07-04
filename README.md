# SeedForge

**Intelligent, deterministic database seeding for Postgres, MySQL, and MongoDB.**

SeedForge introspects your database schema, infers column semantics, applies business rules, and generates realistic relational seed data — deterministically and reproducibly.

## Status

Pre-alpha — under active development. Milestone II (schema relationship graph + dependency resolution) is next.

## Monorepo Structure

```
seedforge/
├── packages/
│   ├── core/              — Schema IR, relationship graph, generation engine (DB-agnostic)
│   ├── adapter-postgres/  — Postgres introspection via `pg` driver
│   ├── adapter-mysql/     — MySQL introspection via `mysql2`
│   ├── adapter-mongodb/   — MongoDB schema inference via `mongodb`
│   ├── cli/               — CLI orchestration (placeholder)
│   └── studio/            — Local web dashboard (placeholder)
├── fixtures/ecommerce/    — Test fixtures: schema.sql, docker-compose.yml, seed data
├── docs/                  — Architecture, roadmap, adapter documentation
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
```

## Key Features (Implemented)

- **Multi-database introspection** — Postgres (INFORMATION_SCHEMA + pg_catalog), MySQL (INFORMATION_SCHEMA), MongoDB (document sampling)
- **Registry pattern dispatcher** — `registerIntrospector()` / `introspect(config)` unified API
- **Type normalization** — Native DB types mapped to a shared `LogicalType` enum (`uuid`, `string`, `integer`, `float`, `boolean`, `date`, `timestamp`, `json`, `enum`, `binary`, `array`)
- **Enum detection** — Postgres `pg_enum` labels, MySQL `ENUM(...)` column type parsing
- **Self-referential FK detection** — `users.referred_by → users.id`
- **Composite PK detection** — `product_tags(product_id, tag_id)`
- **MySQL `TINYINT(1)` → `boolean` normalization**
- **MongoDB schema inference** — nested flattening (dot-notation columns), extended JSON (`$oid`→uuid, `$date`→timestamp), nullable field tracking
- **Deterministic schema hashing** — `computeSchemaHash()` produces canonical SHA256 digests
- **Docker test fixtures** — Postgres 16 + MySQL 8 with 7-table e-commerce schema

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full 19-milestone plan.

## Contributing

See [docs/SETUP.md](docs/SETUP.md) for local development setup.
