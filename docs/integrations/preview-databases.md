# Preview Databases with SeedForge

Seed ephemeral preview/branch databases with realistic deterministic data the moment a PR opens — the same data every teammate sees, from a pinned registry profile.

## How it works

```
PR opened → provider API creates DB branch → migrations run
    → seedforge pull <org>/<project>/<profile> → seedforge seed --mode fresh
    → preview environment deploys with real-looking data
```

The seed profile is published once via `seedforge push` and versioned. Every branch
pulls the same profile, so every preview has byte-identical data — no more "works
on my machine" for seeded data.

---

## Neon

This recipe uses the [Neon](https://neon.tech) branching API (free tier). The same
pattern works for any provider with a branching/restore API.

### Prerequisites

- A Neon project with `main` branch containing your schema (migrations applied)
- `SEEDFORGE_REGISTRY_URL` and `SEEDFORGE_REGISTRY_TOKEN` configured
- `NEON_API_KEY` — generated from [Neon Console → Account → API keys](https://console.neon.tech/docs/manage/api-keys)
- `seedforge login` completed locally or CI env vars set

### One-time setup

```bash
# Push a seed profile to the registry (run after main branch is seeded)
seedforge push preview-medium --project my-app
```

### GitHub Actions workflow

Place this in `.github/workflows/preview.yml`:

```yaml
name: Preview Database
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  seed-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create Neon branch
        id: neon-branch
        run: |
          # Create a branch from main with an ephemeral copy of the data
          RESP=$(curl -s -X POST "https://api.neon.tech/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches" \
            -H "Authorization: Bearer ${{ secrets.NEON_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "endpoints": [{"type": "read_write"}],
              "branch": {
                "parent_id": "br-main-parent-id",
                "name": "pr-${{ github.event.number }}"
              }
            }')
          # Extract the connection string for the new branch
          CONN_STR=$(echo "$RESP" | jq -r '.endpoints[0].host // empty')
          if [ -z "$CONN_STR" ]; then
            # Fallback: construct from branch response
            BRANCH_ID=$(echo "$RESP" | jq -r '.branch.id')
            echo "connection-string=postgresql://neondb_owner:${NEON_PASSWORD}@${BRANCH_ID}.${NEON_PROJECT_ID}.cloud.neon.tech/neondb?sslmode=require" >> $GITHUB_OUTPUT
          else
            echo "connection-string=postgresql://neondb_owner:${NEON_PASSWORD}@${CONN_STR}/neondb?sslmode=require" >> $GITHUB_OUTPUT
          fi
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Run migrations
        run: npx prisma db push  # or drizzle-kit push, or your migration tool
        env:
          DATABASE_URL: ${{ steps.neon-branch.outputs.connection-string }}

      - name: Seed preview database
        uses: seedforge/seedforge/.github/actions/seedforge-action@v1
        with:
          connection-string: ${{ steps.neon-branch.outputs.connection-string }}
          registry-url: ${{ secrets.SEEDFORGE_REGISTRY_URL }}
          registry-token: ${{ secrets.SEEDFORGE_REGISTRY_TOKEN }}
          profile: my-org/my-app/preview-medium
          mode: fresh

      - name: Comment PR with seed status
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `✅ Preview database seeded with profile \`preview-medium\`.\nConnection: Neon branch \`pr-${context.issue.number}\``
            })
```

### Cleanup

Add a workflow on `pull_request: closed` to delete the Neon branch:

```yaml
name: Cleanup Preview
on:
  pull_request:
    types: [closed]

jobs:
  teardown:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s -X DELETE "https://api.neon.tech/v2/projects/${{ secrets.NEON_PROJECT_ID }}/branches/br-pr-${{ github.event.number }}" \
            -H "Authorization: Bearer ${{ secrets.NEON_API_KEY }}"
```

---

## Supabase

With Supabase's [branching](https://supabase.com/docs/guides/platform/branching):

```yaml
- name: Create Supabase preview branch
  run: |
    supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
    supabase db branch create pr-${{ github.event.number }}
    echo "connection-string=postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres" >> $GITHUB_OUTPUT
```

Then run migrations (`supabase db push`) and seed via the action (same `seedforge-action`
as above).

---

## PlanetScale

With PlanetScale's branching:

```yaml
- name: Create PlanetScale branch
  run: |
    pscale branch create ${{ vars.PLANETSCALE_DB_NAME }} pr-${{ github.event.number }} --from main
    CONN_STR=$(pscale connect ${{ vars.PLANETSCALE_DB_NAME }} pr-${{ github.event.number }} --port 3307 2>&1 & sleep 2)
    echo "connection-string=mysql://root@127.0.0.1:3307/${{ vars.PLANETSCALE_DB_NAME }}" >> $GITHUB_OUTPUT
```

---

## Verification

After seeding, run `seedforge doctor` or query row counts directly:

```bash
seedforge doctor --json
# → { "rowsTotal": 58, "fkOrphans": 0, "valid": true }
```

Or in the CI workflow, add a step:

```yaml
  - name: Verify seed
  run: npx @seed-forge/seedforge doctor --config seedforge.config.ts
  env:
    SEEDFORGE_CONNECTION_STRING: ${{ steps.branch.outputs.connection-string }}
```

---

## CI validation

This repository includes a workflow (`.github/workflows/preview-demo.yml`) that validates
the preview-database pattern locally using Docker Postgres service containers. It
simulates the Neon branching flow without requiring a Neon account:

1. Loads the e-commerce fixture schema into a "main" database
2. Creates a `preview_pr_123` database (simulating a Neon branch API call)
3. Loads the same schema into the preview database
4. Seeds the preview database via `seedforge-action`
5. Verifies row counts across all 7 tables
6. Drops the preview database (cleanup)

To run locally:

```bash
# Start a Postgres container
docker run -d --name sf-preview \
  -e POSTGRES_USER=seedforge \
  -e POSTGRES_PASSWORD=seedforge \
  -e POSTGRES_DB=seedforge \
  -p 5432:5432 postgres:16

# Run the seeds
PGPASSWORD=seedforge psql -h localhost -U seedforge -d seedforge -f fixtures/ecommerce/schema.sql
PGPASSWORD=seedforge psql -h localhost -U seedforge -d seedforge -c "CREATE DATABASE preview_pr_123;"
PGPASSWORD=seedforge psql -h localhost -U seedforge -d preview_pr_123 -f fixtures/ecommerce/schema.sql
npx @seed-forge/seedforge seed --config fixtures/configs/postgres.ecommerce.ts --mode fresh
docker stop sf-preview && docker rm sf-preview
```

This validates the same architectural pattern used by the Neon, Supabase, and PlanetScale
recipes above.

---

## Drift detection during preview

If a PR changes the schema (e.g., adds a migration), `seedforge pull` at the top of the
seed step will detect schema mismatch and **block with a clear error** — same as local
`seedforge import` behaviour. This prevents seeding data into a schema that no longer
matches the profile.

To acknowledge intentional drift (e.g., after publishing an updated profile), set
`force: true`:

```yaml
- name: Seed (acknowledge drift)
  uses: seedforge/seedforge/.github/actions/seedforge-action@v1
  with:
    connection-string: ${{ steps.branch.outputs.connection-string }}
    profile: my-org/my-app/preview-medium
    mode: fresh
    force: true
```

When `force: true`, the action passes `--force` to `pull`, overriding hash mismatches.

---

## PR gate with `diff --ci`

Add a required PR check that fails when a migration would cause schema drift against
the published seed profile. This runs **before** the preview database is created,
saving time and Neon branch quota:

```yaml
- name: Check schema drift (PR gate)
  run: npx @seed-forge/seedforge diff --ci --profile my-org/my-app/preview-medium
  env:
    SEEDFORGE_CONNECTION_STRING: ${{ secrets.STAGING_DATABASE_URL }}
```

In `--ci` mode, the command outputs `::error` annotations that GitHub surfaces
inline on the PR's Files Changed tab. Exit code is non-zero on drift, which blocks
the PR from merging when this check is required.

The `test-action` CI job in this repository demonstrates this pattern — it runs
`seedforge diff --ci` before seeding the e-commerce fixture into a Postgres container:

```yaml
- name: Check schema drift
  run: npx @seed-forge/seedforge diff --ci --config fixtures/configs/postgres.ecommerce.ts
  env:
    SEEDFORGE_CONNECTION_STRING: postgresql://seedforge:seedforge@localhost:5432/seedforge
```


