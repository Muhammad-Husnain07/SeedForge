# Roadmap

> 19 milestones toward a production-ready SeedForge.

## Legend

- ✅ **Done** — implemented, tested, merged
- 🔄 **In progress** — actively being worked on
- 📋 **Planned** — scoped but not started

## Completed

- [x] **0. Project brief** — Concept, scope, milestone definition
- [x] **1. Monorepo tooling + core domain types** — pnpm workspaces, Turborepo, TypeScript strict, ESM, `LogicalType`, `DatabaseSchema`, `TableSchema`, `ColumnSchema`
- [x] **2. Multi-database schema introspection engine** — Postgres and MySQL introspection via INFORMATION_SCHEMA, MongoDB inference via document sampling. Registry-based dispatcher, deterministic hash. Tested against docker-compose PG + MySQL fixtures.
- [x] **3. Relationship graph & dependency resolution** — Topological sort of FK dependencies, cycle detection, junction table classification, one-to-one detection. Kahn's algorithm with edge filtering.
- [x] **4. Semantic field analyzer** — 20+ column-name-based generator inference rules with priority system and confidence scoring. Covers email, phone, name, address, currency, URL, IP, slug, SKU, rating, timestamps, boolean flags, enums, FK references, and more.
- [x] **5. Statistical distribution & persona library** — 8 PRNG functions (uniform, weighted, Pareto, normal, exponential, zipf, recency), seeded mulberry32 with independent sub-streams, persona assignment with cascades.
- [x] **6. Business rules config DSL** — `SeedForgeConfig` with Zod-validated schema, table counts, field overrides, count-per-parent, derived fields, personas. `buildGenerationPlan()` merges config with inferred matches.
- [x] **7. Core generation engine** — Seeded PRNG row generation, 20+ generator kinds, FK resolution via PK cache, self-referential FK patch phase, unique enforcement with retry, null injection.
- [x] **8. Database writers / loaders** — Bulk insert for Postgres (multi-row INSERT + COPY), MySQL (multi-row INSERT), MongoDB (insertMany). Fresh/truncate/append modes, transaction rollback on error, progress events.
- [x] **9. Validation & constraint-checking layer** — Pre-flight validation (NOT NULL, enum/CHECK values, unique cardinality, FK ordering) + post-write verification (row counts, FK reference sampling, junction orphans). Structured CI-gateable results.

## Planned

- [ ] **10. Lockfile & schema drift detection** — Schema fingerprint, drift warnings before generation. Lockfile bundle for CI reproducibility.
- [ ] **11. Export / import & sharing bundles** — Portable seed bundles for team sharing. Import a seed bundle to reproduce any dataset.
- [ ] **12. LLM-assisted semantic & business-rule suggestions** — Claude-powered column inference and business-rule proposals via `seedforge suggest`.
- [ ] **13. Full CLI + interactive init wizard** — `seedforge init`, `seedforge generate`, `seedforge introspect`, `seedforge validate`, `seedforge suggest`.
- [ ] **14. Plugin system** — Custom generators, transformers, and data sources. Hook system for pre/post generation events.
- [ ] **15. Integration test suite** — Testcontainers-based multi-DB integration tests. Full end-to-end generation → write → verify pipelines.
- [ ] **16. Performance hardening** — Large-dataset optimization, streaming, progress reporting. Benchmark suite.
- [ ] **17. Local web studio dashboard** — Optional GUI for config, preview, and monitoring. Real-time generation visualization.
- [ ] **18. Packaging, docs, CI/CD, npm publish** — Full documentation site, GitHub Actions CI, npm package publishing.

## Milestone Details

### 10. Lockfile & Schema Drift Detection
- Generate a lockfile after each successful generation (schema hash + config snapshot)
- Before generation, compare live schema to lockfile; warn on drift
- Track which columns have user overrides vs inferred matches
- Lockfile format: JSON with schema hash, config hash, and per-column generator assignments

### 11. Export / Import & Sharing Bundles
- Export: bundle all generated rows + schema + config into a portable archive
- Import: reproduce a dataset from a bundle without re-generation
- Versioned bundles for CI/CD pipeline reproducibility

### 12. LLM-Assisted Suggestions
- `seedforge suggest` subcommand
- Sends unresolved columns + schema context to Claude
- Returns suggested generators and business rules
- Interactive accept/reject flow

### 13. Full CLI
- `seedforge init` — scaffold a new config file with interactive prompts
- `seedforge introspect` — run introspection and print schema summary
- `seedforge validate` — run pre-flight validation standalone
- `seedforge generate` — full generate + write pipeline
- `seedforge suggest` — LLM-assisted column resolution

### 14. Plugin System
- Plugin registration API matching the introspector registry pattern
- Custom generator plugins: new generator kinds with custom value production
- Transformer plugins: post-generation row transforms
- Data source plugins: external APIs, CSV files, etc.

### 15. Integration Tests
- Testcontainers-based: spin up real PG/MySQL/MongoDB containers per test suite
- Full pipeline: introspect → analyze → plan → generate → write → verify
- Stress tests with large datasets (100K+ rows)

### 16. Performance
- Benchmark suite for generation throughput (rows/sec)
- Streaming optimization for very large datasets
- Memory profiling and leak detection
- Configurable batch sizes and parallelization
