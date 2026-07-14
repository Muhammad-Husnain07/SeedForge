# @seed-forge/seedforge

**Deterministic, intelligent seed data generator for Postgres, MySQL, SQLite, and MongoDB.**

SeedForge introspects your database schema, infers column semantics, applies business rules, and generates realistic relational seed data — deterministically and reproducibly.

This is a **thin meta-package** — it provides the `seedforge` CLI binary and delegates all logic to `@seed-forge/cli`. No CLI source is duplicated here.

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for the database)
- [Node.js](https://nodejs.org/) >= 18.17

### Postgres

```bash
# 1. Start Postgres
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

### MySQL

```bash
docker run -d --name seedforge-mysql \
  -e MYSQL_ROOT_PASSWORD=seedforge \
  -e MYSQL_DATABASE=seedforge \
  -p 3306:3306 \
  mysql:8

# The init wizard will prompt for the connection string
npx @seed-forge/seedforge init
npx @seed-forge/seedforge seed
```

### MongoDB

```bash
docker run -d --name seedforge-mongo \
  -p 27017:27017 \
  mongo:7

npx @seed-forge/seedforge init
npx @seed-forge/seedforge seed
```

### SQLite (no Docker needed)

```bash
# SQLite runs in-process via WASM — just point at a .db file
npx @seed-forge/seedforge init   # select sqlite dialect
npx @seed-forge/seedforge seed
```

### Project Scaffold

```bash
npx create-seedforge my-project
cd my-project
seedforge init    # or edit .env first
seedforge seed
```

---

## CLI Reference

Every command accepts `--json` (global) for machine-readable output, plus per-command options shown below.

### `seedforge init`

Scaffold a new `seedforge.config.ts` via an interactive wizard.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Config output path | `seedforge.config.ts` |
| `--force` | Overwrite existing config without confirmation | — |

The wizard prompts for:
- Database connection string (or auto-detects `DATABASE_URL` from `.env`)
- Database dialect (Postgres, MySQL, MongoDB)
- Tables to seed (select none to seed all)
- Row counts per table
- Column-to-generator mapping with confidence scoring
- Seed value for deterministic reproduction

### `seedforge seed`

Generate and write seed data to the database.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `--seed <value>` | Override seed value | Derived from schema hash |
| `--mode <mode>` | Write mode: `fresh`, `truncate`, `append` | `fresh` |
| `--tables <tables>` | Comma-separated table list | All tables |
| `--batch-size <n>` | Rows per batch | 5000 (Postgres/Mongo), 1000 (MySQL) |
| `--parallel` | Use worker_threads for parallel generation | — |
| `--count <n>` | Target total rows (scales config proportionally) | — |
| `--verify` | Run post-write verification checks | — |
| `--benchmark` | Print per-table timing and throughput report | — |

Write modes:
- **fresh** — Drops all tables and recreates, then seeds (default)
- **truncate** — Truncates existing data, keeps schema, then seeds
- **append** — Adds rows alongside existing data

### `seedforge generate --preview <n>`

Preview generated rows without writing to the database.

| Option | Description | Default |
|--------|-------------|---------|
| `--preview <n>` | Print n sample rows per table | Required |
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `--seed <value>` | Override seed value | Derived from schema hash |

### `seedforge introspect`

Print or save the full `DatabaseSchema` from the live database.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `--out <file>` | Write schema JSON to file | — (prints to stdout) |

### `seedforge validate`

Run pre-flight validation checks against the config and database.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |

Validates:
- NOT NULL columns have generators that produce non-null values
- Enum/CHECK constraint values match generator output
- Unique column cardinality is feasible given row counts
- FK ordering matches topological sort
- Config references existing tables and columns

### `seedforge suggest`

Use AI to propose generator config for unresolved columns.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `-o, --output <path>` | Write suggestions to a `.suggested.ts` file | — (prints to stdout) |
| `--include-samples` | Include sample values from DB (may include PII) | — |
| `--provider <name>` | LLM provider: `anthropic`, `openai`, `google`, `deepseek`, `xai`, `openrouter`, `ollama` | `anthropic` |
| `--model <name>` | Model name override | Provider default |
| `--describe <text>` | Describe your dataset in plain English to get a full config draft | — |
| `--tables <names...>` | Only suggest for these tables | All unresolved |
| `--dry-run` | Print what would be sent without calling the LLM | — |

**Safety:** By default, only schema metadata (column names, types, constraints) is sent — no row data. Use `--include-samples` cautiously. The LLM is consulted **only** at suggest-time; `seedforge generate` and `seedforge seed` never call any AI service.

Supported LLM providers:
| Provider | Default Model | Env Variable |
|----------|---------------|--------------|
| anthropic | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` |
| openai | gpt-4o | `OPENAI_API_KEY` |
| google | gemini-2.0-flash | `GEMINI_API_KEY` |
| deepseek | deepseek-chat | `DEEPSEEK_API_KEY` |
| xai | grok-2 | `XAI_API_KEY` |
| openrouter | auto-router | `OPENROUTER_API_KEY` |
| ollama | llama3 | — (uses local Ollama server) |

### `seedforge diff`

Check schema drift between lockfile/live database/registry profile. Acts as a CI gate.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `-l, --lockfile <path>` | Path to lockfile | — |
| `--ci` | Output drift as GitHub Actions annotations, exit non-zero on drift | — |
| `--profile <ref>` | Compare against a registry profile (`<org>/<project>/<name>[:version]`) | — |
| `--force` | Acknowledge drift and exit 0 | — |

Exits with code 1 if drift is detected and not acknowledged (unless `--force` is used).

### `seedforge export`

Package config, lockfile, and optional data snapshot into a `.sfbundle` archive.

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --out <file>` | Output `.sfbundle` file | Required |
| `--snapshot` | Include compressed data snapshot | — |
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `-l, --lockfile <path>` | Path to lockfile | — |

### `seedforge import`

Import a `.sfbundle` archive into the target database.

| Argument | Description |
|----------|-------------|
| `<file>` | `.sfbundle` file to import |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Skip schema mismatch warning | — |
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |

### `seedforge studio`

Launch the local web studio dashboard.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `-p, --port <n>` | Port to bind | `3456` |

The studio provides:
- ER diagram (React Flow) of your database schema with schema-diff overlay
- Interactive config panel with inline editing and natural-language config authoring
- One-click "Seed now" with live progress
- Real-time row counts via SSE
- Bearer-token auth gate (`SEEDFORGE_STUDIO_TOKEN`) for safe team deployment

### `seedforge reset`

Truncate all tables and reseed using the last-used config and seed from the lockfile. No options — reads directly from `seedforge.config.ts` and the lockfile produced by the previous `seed` run.

### `seedforge doctor`

Sanity-check the environment: config parsing, database connectivity, and lockfile integrity.

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |

### `seedforge clone`

Clone and optionally anonymize data from a source database.

| Option | Description | Default |
|--------|-------------|---------|
| `--source <connection>` | Source database connection string | Required |
| `--anonymize` | Replace PII columns with generated values | — |
| `--i-understand-the-risk` | Acknowledge cloning from a production database | — |
| `--out <dir>` | Output directory for anonymized NDJSON files | `./anonymized` |
| `--max-rows <n>` | Maximum rows to sample per table | All rows |

### `seedforge login`

Log in to a SeedForge profile registry.

| Option | Description |
|--------|-------------|
| `-h, --help` | Display help |

### `seedforge push`

Push a named seed profile to the registry.

| Option | Description | Default |
|--------|-------------|---------|
| `<profile-name>` | Profile name | Required |
| `--version <version>` | Version tag | `latest` |
| `--project <name>` | Project name | CWD directory name |
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |
| `-l, --lockfile <path>` | Path to lockfile | — |

### `seedforge pull`

Pull a seed profile from the registry and import it.

| Argument | Description |
|----------|-------------|
| `<ref>` | `<org>/<project>/<profile-name>[:version]` |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Skip schema mismatch warning | — |
| `-c, --config <path>` | Path to config file | `seedforge.config.ts` |

---

## Configuration

The `init` wizard generates a `seedforge.config.ts` file that looks like:

```ts
import { defineConfig } from '@seed-forge/core';

export default defineConfig({
  connection: {
    dialect: 'postgres',
    connectionString: process.env.DATABASE_URL!,
  },
  tables: {
    users: {
      count: 50,
      fields: {
        email: { kind: 'faker', params: { method: 'internet.email' } },
        name: { kind: 'faker', params: { method: 'person.fullName' } },
      },
    },
  },
});
```

### Config DSL

| Section | Purpose |
|---------|---------|
| `connection` | Database dialect and connection URL |
| `tables.<name>.rowCount` | Number of rows to generate |
| `tables.<name>.countPerParent` | Child rows per parent (for hierarchical data) |
| `tables.<name>.fields.<col>` | Per-column generator configuration |
| `tables.<name>.personas` | Weighted persona presets with field overrides |
| `tables.<name>.cascades` | Table-level persona cascade rules |

### Generator Kinds

| Kind | Params | Description |
|------|--------|-------------|
| `uuid` | — | Random UUID v4 |
| `faker` | `method: string` | Faker.js method (e.g. `'internet.email'`, `'person.firstName'`) |
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

### Custom Generators via Plugin System

Plugins register new generator kinds and lifecycle hooks:

```ts
import type { SeedForgePlugin } from '@seed-forge/core';

const plugin: SeedForgePlugin = {
  name: 'geo',

  registerGenerators(registry) {
    registry.register('geo.city', Object.assign(
      (_params, _row, prng) => randomCity(prng.next()),
      { compatibleTypes: ['string'] },
    ));
  },

  onSchemaIntrospected(schema) { /* ... */ },
  beforeGenerate(plan) { /* ... */ },
};

export default plugin;
```

Example plugin: `@seed-forge/plugin-geo` provides realistic geographic data (cities, countries, coordinates).

---

## Adapters

SeedForge supports multiple databases through pluggable adapters:

| Adapter | Package | Introspection | Writer |
|---------|---------|---------------|--------|
| Postgres | `@seed-forge/adapter-postgres` | `INFORMATION_SCHEMA` + `pg_catalog` | Multi-row INSERT / COPY |
| MySQL | `@seed-forge/adapter-mysql` | `INFORMATION_SCHEMA` | Multi-row INSERT |
| MongoDB | `@seed-forge/adapter-mongodb` | Document sampling + schema inference | `insertMany` |
| SQLite | `@seed-forge/adapter-sqlite` | `PRAGMA` + `sqlite_master` | Batched INSERT (WASM, no Docker) |
| Prisma | `@seed-forge/adapter-prisma` | Schema file parser (`schema.prisma`) | — (introspection only) |
| Drizzle | `@seed-forge/adapter-drizzle` | Schema file parser (`schema.drizzle.ts`) | — (introspection only) |

The adapters are automatically resolved by the CLI — you only need to pick the dialect during `init`.

---

## Determinism

Given the same **seed value**, **config**, and **schema**, SeedForge produces byte-identical output every time.

- **Seeded PRNG:** Uses `mulberry32` with `deriveStream()` for independent sub-streams per cell
- **Schema hash:** A SHA256 digest of the canonical schema is computed and stored in the lockfile
- **Drift detection:** `seedforge diff` warns if the live schema has changed since the last seed
- **Lockfile bundles:** `.sfbundle` archives bundle config, lockfile, and optionally data for CI reproducibility
- **Parallel mode:** `--parallel` uses `worker_threads` for concurrent per-level generation and produces **byte-identical output** to sequential mode

---

## Schema Analysis

SeedForge infers column semantics from 20+ pattern-matching rules:

| Rule | Example Columns |
|------|----------------|
| email | `email`, `email_address`, `user_email` |
| phone | `phone`, `phone_number`, `contact_phone` |
| name | `first_name`, `last_name`, `full_name` |
| address | `street`, `city`, `state`, `zip`, `country` |
| currency | `price`, `amount`, `cost`, `revenue` |
| url | `url`, `website`, `avatar_url` |
| ip | `ip_address`, `ipv4`, `remote_addr` |
| slug | `slug`, `handle`, `username` |
| sku | `sku`, `product_code`, `part_number` |
| rating | `rating`, `score`, `stars` |
| timestamp | `created_at`, `updated_at`, `deleted_at` |
| boolean | `is_active`, `has_paid`, `is_admin`, `flag` |
| enum | Detected from `pg_enum`, `ENUM(...)`, or `CHECK IN(...)` |
| fk-reference | Foreign key columns referencing parent tables |
| uuid | `id`, `uuid`, `guid` (auto-detected PK) |

Each rule produces a confidence score (0–1) with a configurable threshold. Rules are evaluated in priority order, and the highest-confidence match wins.

---

## Installation (for programmatic use)

If you want to depend on SeedForge components from your own Node.js code:

```bash
npm install @seed-forge/core
npm install @seed-forge/adapter-postgres
```

| Package | Description |
|---------|-------------|
| `@seed-forge/seedforge` | Meta-package (this package — provides the `seedforge` CLI binary) |
| `@seed-forge/cli` | CLI orchestration (all commands) |
| `@seed-forge/core` | Engine, schema IR, distributions, config DSL, lockfile, plugin system |
| `@seed-forge/adapter-postgres` | Postgres introspection + bulk writer |
| `@seed-forge/adapter-mysql` | MySQL introspection + bulk writer |
| `@seed-forge/adapter-mongodb` | MongoDB schema inference + bulk writer |
| `@seed-forge/adapter-sqlite` | SQLite introspection + bulk writer (WASM, no Docker) |
| `@seed-forge/adapter-prisma` | Prisma schema file parser |
| `@seed-forge/adapter-drizzle` | Drizzle schema file parser |
| `@seed-forge/studio` | Web dashboard (Fastify + React/Vite) |
| `@seed-forge/testing` | In-process seed helpers for Vitest and Jest (private, monorepo-only) |

---

## Performance

On a 1M `order_items` scale (1,886,991 total rows across 7 tables), Windows 11 x64 / Node 22:

- **Throughput:** ~7,989 rows/s (236.2 s total)
- **Memory:** 264 MB RSS delta (well under 512 MB ceiling)
- **Determinism:** Sequential and parallel mode produce byte-identical output

---

## Documentation

- [Full CLI Reference](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/cli/reference.md)
- [Config DSL Reference](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/config-dsl.md)
- [Architecture](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/ARCHITECTURE.md)
- [Adapter Authoring Guide](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/ADAPTERS.md)
- [Plugin Authoring Guide](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/plugins.md)
- [Setup Guide](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/SETUP.md)
- [Roadmap](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/docs/ROADMAP.md)

---

## License

[MIT](https://github.com/Muhammad-Husnain07/SeedForge/blob/main/LICENSE)
