# seedforge

## 0.2.0

### Minor Changes

- Phase 2, Milestone A: unscoped `seedforge` entry point, `create-seedforge` scaffold, security bumps, programmatic exports

  - **seedforge** (new): Meta-package that provides `npx seedforge` — delegates to `@seed-forge/cli`
  - **create-seedforge** (new): Project scaffold — `npx create-seedforge my-project`
  - **@seed-forge/cli**: Added programmatic exports (`exports` field, `initCommand` re-export); all workspace deps changed to `workspace:^`
  - **@seed-forge/studio**: Bumped `@fastify/static` from `^8.0.0` to `^9.1.1` (fixes CVE-2026-6410, CVE-2026-6414)
  - **All packages**: Internal dependency specifiers changed from `workspace:*` to `workspace:^`

### Patch Changes

- Updated dependencies
  - @seed-forge/cli@0.2.0
