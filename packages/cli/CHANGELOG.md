# @seed-forge/cli

## 0.2.6

### Patch Changes

- Auto-generated patch release
- Updated dependencies
  - @seed-forge/adapter-drizzle@0.1.3
  - @seed-forge/adapter-mongodb@0.2.6
  - @seed-forge/adapter-mysql@0.2.6
  - @seed-forge/adapter-postgres@0.2.6
  - @seed-forge/adapter-prisma@0.1.3
  - @seed-forge/core@0.2.6
  - @seed-forge/studio@0.2.6

## 0.2.5

### Patch Changes

- Auto-generated patch release
- Updated dependencies
  - @seed-forge/adapter-drizzle@0.1.2
  - @seed-forge/adapter-mongodb@0.2.5
  - @seed-forge/adapter-mysql@0.2.5
  - @seed-forge/adapter-postgres@0.2.5
  - @seed-forge/adapter-prisma@0.1.2
  - @seed-forge/core@0.2.5
  - @seed-forge/studio@0.2.5

## 0.2.4

### Minor Changes

- Phase 2, Milestone D: SQLite dialect support, studio hardening integration.

### Features

- **SQLite dialect**: Full CLI support for `sqlite` dialect — `seedforge init`, `seedforge seed`,
  `seedforge introspect`, `seedforge validate`, `seedforge diff`, `seedforge suggest` all work
  with SQLite databases. Adapter auto-resolved from config dialect.
- **New adapter deps**: `@seed-forge/adapter-sqlite`, `@seed-forge/adapter-prisma`,
  `@seed-forge/adapter-drizzle` added as optional dependencies for runtime resolution.
