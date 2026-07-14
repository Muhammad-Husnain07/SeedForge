# @seed-forge/core

## 0.2.6

### Patch Changes

- Auto-generated patch release

## 0.2.5

### Patch Changes

- Auto-generated patch release

## 0.2.4

### Minor Changes

- Phase 2, Milestone D: SQLite dialect support, schema hash improvements.

### Features

- **SQLite dialect**: Added `'sqlite'` to the `Dialect` union type. Schema
  introspection and generation engine fully compatible.
- **Introspection dispatcher**: `registerIntrospector('sqlite', ...)` path added
  alongside existing postgres/mysql/mongodb/prisma/drizzle entries.
