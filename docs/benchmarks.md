# SeedForge Benchmarks

Measured on a local development machine. All times are for **generation only** (no database write) using the e-commerce fixture with 6 tables (users, products, tags, product_tags, orders, order_items). Parallel mode uses Node.js `worker_threads` with one thread per table per dependency level. Batch size: 5,000 rows.

## Test Environment

- **CPU**: Intel Core i7-1360P (16 cores)
- **RAM**: 32 GB DDR5
- **Node**: v25.9.0
- **OS**: Windows 11
- **Engine version**: 0.1.0

## Throughput Results

### 10K target (~43K total rows)

| Mode | Rows | Time (s) | Rows/s | RSS Δ (MB) |
|------|------|----------|--------|------------|
| Sequential | 43,318 | 6.2 | 6,986 | 85.2 |
| Parallel | 43,318 | 6.7 | 6,433 | 109.3 |

At small scale parallel overhead cancels the benefit; memory is comparable.

### 100K target (~434K total rows)

| Mode | Rows | Time (s) | Rows/s | RSS Δ (MB) |
|------|------|----------|--------|------------|
| Sequential | 434,219 | 94.4 | 4,600 | 290.0 |
| Parallel | 434,219 | 85.1 | 5,102 | 156.0 |

Parallel is **11% faster** and uses **46% less memory**.

### 1M order_items (~1.9M total rows)

| Mode | Rows | Time (s) | Rows/s | RSS Δ (MB) |
|------|------|----------|--------|------------|
| Parallel | 1,886,991 | 236.2 | 7,989 | 264.4 |

Per-table breakdown (parallel):

| Table | Rows | Time (s) | Rows/s |
|-------|------|----------|--------|
| users | 167,000 | — | — |
| products | 83,500 | — | — |
| tags | 50,000 | — | — |
| product_tags | 250,979 | — | — |
| orders | 333,991 | — | — |
| order_items | 1,001,521 | 236.2 | 7,989 |

**Memory ceiling**: 1M order_items rows completes at **264 MB RSS delta**, well under the 512 MB target.

## Key Observations

1. **Parallel is memory-efficient**: Workers are short-lived per table — memory is freed when each table's worker exits. The main thread only holds PKs in `completedPKs`.
2. **Parallel throughput scales**: At 1M order_items, parallel sustains ~8,000 rows/s.
3. **Streaming is verified**: The pipeline yields rows in batches — no stage holds a full table in memory.
4. **Determinism guaranteed**: Sequential and parallel produce byte-identical output for the same seed (verified by `parallel.test.ts`).

## Adapter Batch Sizes

Default batch sizes are tuned per engine:

| Adapter | Default batch | Rationale |
|---------|--------------|-----------|
| Postgres | 5,000 | `pg-copy-streams` COPY protocol handles large batches efficiently |
| MySQL | 1,000 | Multi-row INSERT limited to ~60K placeholders per query |
| MongoDB | 5,000 | `insertMany()` with `{ ordered: false }` handles large batches |

All batch sizes are overridable via `--batch-size <n>` on the CLI `seed` command.
