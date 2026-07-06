# @seed-forge/studio

## 0.2.3

### Patch Changes

- Auto-generated patch release
- Updated dependencies
  - @seed-forge/adapter-mongodb@0.2.3
  - @seed-forge/adapter-mysql@0.2.3
  - @seed-forge/adapter-postgres@0.2.3
  - @seed-forge/core@0.2.3

## 0.2.2

### Patch Changes

- @seed-forge/core@0.2.2
- @seed-forge/adapter-postgres@0.2.2
- @seed-forge/adapter-mysql@0.2.2
- @seed-forge/adapter-mongodb@0.2.2

## 0.2.0

### Minor Changes

---

'seedforge': minor
'@seed-forge/cli': minor
'@seed-forge/studio': minor
'@seed-forge/adapter-mongodb': minor
'@seed-forge/adapter-mysql': minor
'@seed-forge/adapter-postgres': minor
---

Phase 2, Milestone A: unscoped `seedforge` entry point, `create-seedforge` scaffold, security bumps, programmatic exports

- **seedforge** (new): Meta-package that provides `npx seedforge` — delegates to `@seed-forge/cli`
- **create-seedforge** (new): Project scaffold — `npx create-seedforge my-project`
- **@seed-forge/cli**: Added programmatic exports (`exports` field, `initCommand` re-export); all workspace deps changed to `workspace:^`
- **@seed-forge/studio**: Bumped `@fastify/static` from `^8.0.0` to `^9.1.1` (fixes CVE-2026-6410, CVE-2026-6414)
- **All packages**: Internal dependency specifiers changed from `workspace:*` to `workspace:^`

### Patch Changes

- Updated dependencies
  - @seed-forge/adapter-mongodb@0.2.0
  - @seed-forge/adapter-mysql@0.2.0
  - @seed-forge/adapter-postgres@0.2.0
  - @seed-forge/core@0.2.0

## 0.1.1

### Patch Changes

- Rename npm scope from `@seedforge` to `@seed-forge` (npm org `seed-forge`). Remove `seedforge` meta-package (name blocked on npm — too similar to existing `seed-forge`).
- Updated dependencies
  - @seed-forge/core@0.1.1
  - @seed-forge/adapter-postgres@0.1.1
  - @seed-forge/adapter-mysql@0.1.1
  - @seed-forge/adapter-mongodb@0.1.1

## 0.1.0

### Minor Changes

- First public release — Milestone XI: publishable monorepo with meta-package, Changesets versioning, CI/CD workflows, comprehensive docs, zero ESLint errors. Deterministic seed data generator for relational databases with CLI, streaming, parallel mode, and plugins.

### Patch Changes

- Updated dependencies
  - @seed-forge/core@0.1.0
  - @seed-forge/adapter-postgres@0.1.0
  - @seed-forge/adapter-mysql@0.1.0
  - @seed-forge/adapter-mongodb@0.1.0
