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

- **CI**: Pull requests and pushes to `main` affecting API or Supabase files run type checking, lint, build, and tests. Tests use local Supabase, never the production database.
- **Migrations**: On a push to `main`, production migrations run only when that push changes `supabase/migrations/**`. Only pending migrations are applied, after CI succeeds.
- **Render**: CI triggers deployment of the tested commit after migrations succeed, or after CI when there are no migration changes. HTTP errors fail the deploy job; a successful trigger does not mean the Render deployment has finished.

Configure these GitHub Actions repository secrets:

| Secret                  | Purpose                               |
| ----------------------- | ------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase account token for the CLI    |
| `SUPABASE_PROJECT_REF`  | Production Supabase project reference |
| `SUPABASE_DB_PASSWORD`  | Production database password          |
| `RENDER_API_KEY`        | Render API token                      |
| `RENDER_SERVICE_ID`     | Render backend service ID             |

Disable **Auto-Deploy** on Render so it cannot deploy before CI and migrations finish. Keep backend runtime secrets configured on Render, not in frontend environment files. Use backward-compatible migrations because the old backend remains live while migrations run, and add new migration files rather than editing migrations already applied to production.

See [DEPLOYMENT_SETUP.md](../DEPLOYMENT_SETUP.md) for details.
