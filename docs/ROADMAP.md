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
- [x] **10. Lockfile & schema drift detection** — Schema fingerprint, drift warnings before generation. Lockfile bundle for CI reproducibility.
- [x] **11. Export / import & sharing bundles** — Portable seed bundles for team sharing. Import a seed bundle to reproduce any dataset.
- [x] **12. LLM-assisted semantic & business-rule suggestions** — Claude-powered column inference and business-rule proposals via `seedforge suggest` (seedforge suggest — LLM-assisted semantic analysis).
- [x] **13. Full CLI + interactive init wizard** — `seedforge init`, `seedforge generate`, `seedforge introspect`, `seedforge validate`, `seedforge suggest`, `seedforge seed`, `seedforge studio`.
- [x] **14. Plugin system** — Custom generators, transformers, and data sources. Hook system for pre/post generation events.
- [x] **15. Integration test suite** — Testcontainers-based multi-DB integration tests. Full end-to-end generation → write → verify pipelines.
- [x] **16. Performance hardening** — Large-dataset optimization, streaming, progress reporting. Benchmark suite. 1M order_items @ 7,989 rows/s with 264 MB RSS.
- [x] **17. Local web studio dashboard** — Fastify backend + React/Vite frontend with ER diagram, config panel, live progress via SSE, one-click "Seed now".

## Completed (continued)

- [x] **18. Packaging, docs, CI/CD, npm publish** — `.github/workflows/ci.yml` (lint + unit + integration on PR), `.github/workflows/publish.yml` (tag-triggered publish with npm provenance), `.changeset/config.json` (Changesets `fixed` config, synced versions). All 6 packages live on npm at `@seed-forge/*` v0.1.1: `@seed-forge/core`, `@seed-forge/cli`, `@seed-forge/adapter-postgres`, `@seed-forge/adapter-mysql`, `@seed-forge/adapter-mongodb`, `@seed-forge/studio`, plus `@seed-forge/plugin-geo`. Auto-generated CLI reference, architect docs, config DSL reference, plugin-authoring guide, contributing guide, issue templates.

## Planned

- [ ] **19. Production hardening** — HTTPS, auth, multi-user workspaces, cloud-hosted studio.

## Phase 2 — Next Level

- [x] **A. Single-command install & real branding** — `npx @seed-forge/seedforge init` / `seed forge seed` as primary entry point, `npx create-seedforge` scaffolding, `workspace:^` range specifiers, `@fastify/static` security bump, programmatic `@seed-forge/cli` exports
- [ ] **B. Deepen the business-logic story** — ORM-native schema parsing (Prisma, Drizzle), time-series / cohort / event-stream generation, natural-language config authoring via LLM, production clone-and-anonymize mode (copy production schema → generate anonymized replica)
- [ ] **C. Team collaboration & ecosystem** — Hosted profile registry (share + discover generator profiles), GitHub Actions CI plugin, test-framework bindings (Vitest fixture setup / teardown)
- [ ] **D. More engines, harder studio** — SQLite adapter (zero-Docker seed), studio hardening (auth, saved configurations, multi-project workspaces, one-click re-seed)
- [ ] **E. Depth & confidence** — Test coverage expansion (property-based tests for generation engine, edge-case fuzzing), `seedforge audit` command (data-quality checks: referential integrity, cardinality boundaries, outlier detection)

