# Contributing to SeedForge

## Local Development Setup

See [docs/SETUP.md](docs/SETUP.md) for full setup instructions.

Quick start:

```bash
git clone https://github.com/Muhammad-Husnain07/SeedForge.git
cd SeedForge
pnpm install
pnpm build
pnpm test
```

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`
- ES modules (`"type": "module"`) with NodeNext module resolution
- No semicolons (via Prettier)
- ESLint with `typescript-eslint` and `eslint-config-prettier`

Run lint before submitting:

```bash
pnpm lint
```

## Testing

Unit tests run standalone; integration tests require Docker containers:

```bash
# Unit tests only
pnpm test

# Integration tests (requires Docker)
docker compose -f fixtures/ecommerce/docker-compose.yml up -d
pnpm test:integration
```

## Pull Request Process

1. Ensure all tests pass locally (`pnpm test`)
2. Run `pnpm lint` and fix any issues
3. Update or add tests for new functionality
4. Update docs if the CLI or config API changes
5. If you add a new package, add it to `.changeset/config.json` `ignore` list if it shouldn't be published

## Release Process

Maintainers trigger a release by pushing a `v*` tag:

```bash
pnpm changeset        # describe the changes
pnpm changeset version # bump versions
git add . && git commit -m "chore: version bump"
git tag v0.1.0
git push --tags
```

The publish workflow on GitHub Actions builds and publishes all packages to npm.

## Reporting Issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) — bug reports and feature requests have dedicated formats.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
