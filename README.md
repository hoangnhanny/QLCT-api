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
src/              # NestJS application code
supabase/         # Database migrations
.github/          # CI/CD workflows
```

## Deployment

- **Render**: Auto-deploy on push to main
- **Migrations**: Auto-run on push to `supabase/migrations/`

See [DEPLOYMENT_SETUP.md](../DEPLOYMENT_SETUP.md) for details.
