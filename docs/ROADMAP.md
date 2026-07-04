# Roadmap

> 19 milestones toward a production-ready SeedForge.

## Completed

- [x] **0. Project brief** — Concept, scope, milestone definition
- [x] **1. Monorepo tooling + core domain types** — pnpm workspaces, Turborepo, TypeScript strict, ESM, `LogicalType`, `DatabaseSchema`, `TableSchema`, `ColumnSchema`
- [x] **2. Multi-database schema introspection engine** — Postgres and MySQL introspection via INFORMATION_SCHEMA, MongoDB inference via document sampling. Registry-based dispatcher, deterministic hash. Tested against docker-compose PG + MySQL fixtures.

## Planned

- [ ] **3. Relationship graph & dependency resolution** — Topological sort of FK dependencies, cycle detection, row generation order
- [ ] **4. Semantic field analyzer** — Column-name-based generator inference (`email` → faker.email, `created_at` → timestamp, etc.)
- [ ] **5. Statistical distribution & persona library** — Pareto, normal, uniform distributions; admin/buyer personas
- [ ] **6. Business rules config DSL** — `seedforge.config.ts` with Zod-validated schema
- [ ] **7. Core generation engine** — Seeded PRNG row generation with FK resolution
- [ ] **8. Database writers / loaders** — Bulk insert (Postgres COPY, MySQL batch, MongoDB insertMany)
- [ ] **9. Validation & constraint-checking layer** — NOT NULL, UNIQUE, CHECK, FK integrity before write
- [ ] **10. Lockfile & schema drift detection** — Schema fingerprint, drift warnings
- [ ] **11. Export / import & sharing bundles** — Portable seed bundles for team sharing
- [ ] **12. LLM-assisted semantic & business-rule suggestions** — Claude-powered column inference and rule proposals
- [ ] **13. Full CLI + interactive init wizard** — `seedforge init`, `seedforge generate`, `seedforge introspect`
- [ ] **14. Plugin system** — Custom generators, transformers, and data sources
- [ ] **15. Integration test suite** — Testcontainers-based multi-DB integration tests
- [ ] **16. Performance hardening** — Large-dataset optimization, streaming, progress reporting
- [ ] **17. Local web studio dashboard** — Optional GUI for config, preview, and monitoring
- [ ] **18. Packaging, docs, CI/CD, npm publish**
