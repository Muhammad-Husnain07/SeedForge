# Local Development Setup

## Prerequisites

- **Node.js** >= 18.17
- **pnpm** >= 9.4.0 (`npm install -g pnpm`)
- **Docker Desktop** — required for integration tests (Postgres + MySQL + MongoDB)

## Install

```bash
git clone https://github.com/Muhammad-Husnain07/SeedForge.git
cd SeedForge
pnpm install
```

## Build

```bash
# Build all packages
pnpm build

# Build a single package
pnpm --filter @seedforge/adapter-postgres build
```

The build uses `tsup` with `--format esm` to produce ESM-compatible output in each package's `dist/` folder.

## Test

### Start test databases

```bash
docker compose -f fixtures/ecommerce/docker-compose.yml up -d
```

This starts Postgres 16 and MySQL 8 containers pre-loaded with the e-commerce fixture schema (7 tables, enums, FKs, composite PKs, check constraints).

### Run tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @seedforge/adapter-mongodb test
```

### Test skip behavior

Integration tests that require a live database (Postgres, MySQL) automatically skip if the database is unreachable (3-second connection timeout). This allows running tests without Docker.

## Project Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all packages (Turborepo parallel) |
| `pnpm test` | Run all tests (depends on build) |
| `pnpm lint` | ESLint across all packages |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm clean` | Remove all `dist/` folders |
| `pnpm dev` | Watch mode for all packages |

## Package Scripts (per package)

Each package supports `build`, `dev`, `test`, `lint`, `lint:fix`, and `clean` scripts.

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`
- ES modules (`"type": "module"`) with NodeNext module resolution
- No semicolons (via Prettier)
- ESLint with `typescript-eslint` and `eslint-config-prettier`

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design overview.
