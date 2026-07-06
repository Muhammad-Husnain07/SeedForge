# @seed-forge/seedforge

Zero-setup entry point for [SeedForge](https://github.com/Muhammad-Husnain07/SeedForge) — a deterministic, intelligent seed data generator for Postgres, MySQL, and MongoDB.

This is a thin meta-package that delegates to `@seed-forge/cli`. No CLI source is duplicated here.

## Usage

```bash
# Scaffold a config file
npx @seed-forge/seedforge init

# Seed your database
npx @seed-forge/seedforge seed
```

Or scaffold a reusable project:

```bash
npx create-seedforge my-project
cd my-project
seedforge init
seedforge seed
```

## Documentation

See the [main repository](https://github.com/Muhammad-Husnain07/SeedForge) for full documentation, API reference, and contributing guide.
