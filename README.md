# QLCT API

NestJS backend for QLCT Family Expense Tracker.

## Setup

```bash
# Install dependencies
yarn install

# Environment variables
cp .env.example .env.local

# Run migrations
supabase db push

# Development
yarn dev

# Production build
yarn build
yarn start:prod
```

## Project Structure

```
src/              # NestJS application code, including Supabase service
test/             # Unit, e2e, and database tests
supabase/         # Supabase CLI config and migrations
.github/          # CI/CD workflows
```

## Deployment

- **CI**: Pull requests and pushes to `main` affecting API or Supabase files run type checking, lint, build, and unit tests without requiring a local Supabase instance.
- **Migrations**: On a push to `main` (or manual dispatch), production migrations run automatically after CI build succeeds. Supabase CLI connects to remote and safely applies any pending migrations (idempotent).
- **Render**: CI triggers deployment of the tested commit to Render only after migrations succeed. HTTP errors fail the deploy job; a successful trigger does not mean the Render deployment has finished.

Configure these GitHub Actions repository secrets:

| Secret                  | Purpose                                                        | Example / Default |
| ----------------------- | -------------------------------------------------------------- | ----------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token (`sbp_...`) for CLI             | [Create token](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF`  | Production Supabase project reference                          | `adetfttrkukiwzhjpqld` |
| `SUPABASE_DB_PASSWORD`  | Production database password                                   | Your DB password  |
| `RENDER_API_KEY`        | Render API token                                               | Render account API key |
| `RENDER_SERVICE_ID`     | Render backend service ID                                      | `srv-...`         |

Disable **Auto-Deploy** on Render so it cannot deploy before CI and migrations finish. Keep backend runtime secrets configured on Render, not in frontend environment files. Use backward-compatible migrations because the old backend remains live while migrations run, and add new migration files rather than editing migrations already applied to production.

See [DEPLOYMENT_SETUP.md](../DEPLOYMENT_SETUP.md) for details.
