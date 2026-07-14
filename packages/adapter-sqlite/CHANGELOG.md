# @seed-forge/adapter-sqlite

## 0.2.4

### Minor Changes

- Phase 2, Milestone D: SQLite adapter with WASM-based introspection and writer.
  No Docker required — runs in-process via sql.js.

### Features

- **Introspection**: Queries `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list`,
  `PRAGMA index_list`/`index_info`, and parses `CHECK` constraints from DDL via regex.
- **Type mapping**: Declared-type affinity → LogicalType (INTEGER, REAL, TEXT, BLOB, BOOLEAN,
  DATE, DATETIME, TIMESTAMP, UUID, JSON).
- **Writer**: Batched `INSERT` within a transaction (default 1,000 rows/batch, max 999 vars).
  `fresh`/`truncate`/`append` write modes. File persistence via `sql.js` buffer export.
- **Sampler**: Reads rows via `SELECT * FROM table ORDER BY RANDOM() LIMIT n`.
- **Zero native deps**: Uses `sql.js` WASM build — no native compilation needed.
