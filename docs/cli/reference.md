# CLI Reference

> Auto-generated from `seedforge --help`. Do not edit by hand.
> Regenerate with: `node scripts/gen-cli-docs.mjs`
> Generated on: 2026-07-06

## Usage

```
seedforge <command> [options]
```

## Global Options

- `-V, \-\-version` — output the version number
- `\-\-json` — machine-readable JSON output (for scripting/CI)

## Commands


### `seedforge init`

```
Usage: seedforge init [options]

Scaffold a new seedforge.config.ts via interactive wizard

Options:
  -c, --config <path>  config output path (default: "seedforge.config.ts")
  --force              overwrite existing config without confirmation
  -h, --help           display help for command
```

### `seedforge introspect`

```
Usage: seedforge introspect [options]

Print or save the full DatabaseSchema from the live database

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  --out <file>         write schema JSON to file
  -h, --help           display help for command
```

### `seedforge validate`

```
Usage: seedforge validate [options]

Run pre-flight validation checks against the config and database

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  -h, --help           display help for command
```

### `seedforge suggest`

```
Usage: seedforge suggest [options]

Use AI to propose config for unresolved columns. By default only schema
metadata is sent (safe). Use --include-samples to include sample values (may
include PII).

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  -o, --output <path>  write suggestions to a .suggested.ts file instead of
                       printing
  --include-samples    WARNING: include sample distinct values from the
                       database. This may include real user PII. Only use on
                       databases you own.
  --provider <name>    LLM provider: anthropic, openai, google, deepseek, xai,
                       openrouter, ollama
  --model <name>       model name override (defaults to provider-appropriate
                       model)
  --tables <names...>  only suggest for these tables
  --dry-run            print what would be sent to the LLM without calling it
  -h, --help           display help for command
```

### `seedforge generate`

```
Usage: seedforge generate [options]

Generate seed data. Use --preview <n> for a dry run without writing to the
database.

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  --seed <value>       seed value for deterministic generation
  --preview <n>        print n sample rows per table without writing to
                       database
  -h, --help           display help for command
```

### `seedforge seed`

```
Usage: seedforge seed [options]

Generate and write seed data to the database

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  --seed <value>       seed value override (default: derived from schema hash)
  --mode <mode>        write mode: fresh | truncate | append (default: "fresh")
  --tables <tables>    comma-separated list of tables to seed
  --batch-size <n>     rows per batch (default: 5000 postgres/mongo, 1000
                       mysql)
  --parallel           use worker_threads for parallel per-level generation
  --count <n>          target total rows (scales config proportionally)
  --verify             run post-write verification checks
  --benchmark          print per-table timing and throughput report
  -h, --help           display help for command
```

### `seedforge reset`

```
Usage: seedforge reset [options]

Truncate all tables and reseed using the last-used config and seed from the
lockfile

Options:
  -h, --help  display help for command
```

### `seedforge diff`

```
Usage: seedforge diff [options]

Check for schema drift between lockfile and live database (CI gate)

Options:
  -c, --config <path>    path to config file (default: "seedforge.config.ts")
  -l, --lockfile <path>  path to lockfile
  -h, --help             display help for command
```

### `seedforge export`

```
Usage: seedforge export [options]

Package config, lockfile, and optional data snapshot into a .sfbundle archive

Options:
  -o, --out <file>       output .sfbundle file
  --snapshot             include compressed data snapshot for byte-identical
                         restore
  -c, --config <path>    path to config file (default: "seedforge.config.ts")
  -l, --lockfile <path>  path to lockfile
  -h, --help             display help for command
```

### `seedforge import`

```
Usage: seedforge import [options] <file>

Import a .sfbundle archive into the target database

Arguments:
  file                 .sfbundle file to import

Options:
  --force              skip schema mismatch warning
  -c, --config <path>  path to config file (for replay generation) (default:
                       "seedforge.config.ts")
  -h, --help           display help for command
```

### `seedforge studio`

```
Usage: seedforge studio [options]

Launch the local web studio dashboard (Fastify + React)

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  -p, --port <n>       port to bind (default: 3456)
  -h, --help           display help for command
```

### `seedforge doctor`

```
Usage: seedforge doctor [options]

Sanity-check the environment: config, database connection, and lockfile

Options:
  -c, --config <path>  path to config file (default: "seedforge.config.ts")
  -h, --help           display help for command
```
