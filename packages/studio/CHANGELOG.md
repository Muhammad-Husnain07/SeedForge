# @seed-forge/studio

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

## 0.2.4

### Minor Changes

- Phase 2, Milestone D: Studio hardening for team deployment. Auth gate,
  path-traversal regression fix, schema-diff overlay on ER diagram,
  natural-language config authoring in config panel.

### Features

- **Auth gate**: `SEEDFORGE_STUDIO_TOKEN` env var enables Bearer-token authentication.
  All routes except `/api/health` require `Authorization: Bearer <token>` header.
  Binds to `0.0.0.0` when token is set, `127.0.0.1` when disabled (zero-config safe default).
- **Schema-diff overlay**: Visual drift detection on the ER graph — added/removed tables
  and columns highlighted directly on the diagram (green/red borders, badges, strikethrough).
  Toggle button and drift summary legend built into React Flow Controls.
- **Natural-language config authoring**: Textarea in ConfigPanel calls `POST /api/suggest-describe`,
  renders the generated config draft as an editable inline diff with "Apply" button.
- **Path-traversal hardening**: Regression test verifying `@fastify/static` with `wildcard: false`
  prevents `../`, `%2f`, and `%2e%2e%2f` traversal payloads from leaking files outside the static root.

### Fixes

- **Fastify 5 hook compatibility**: Auth hook changed from sync to `async` to prevent
  pipeline hang on health-check routes.
- **Type safety**: `buildServer` return type changed from `ReturnType<typeof Fastify>` (resolves as `any`)
  to `Promise<FastifyInstance>` for proper TypeScript strict-mode compliance.
