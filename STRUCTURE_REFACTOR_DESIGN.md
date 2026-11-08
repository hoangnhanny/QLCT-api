# Repository Structure Refactor Design

**Status:** Approved in chat on 2026-11-08

## Intent

Remove the duplicated `src/src` layout and make each repository a self-contained application rooted at its Git root. Keep the API and web as separate deployable repositories; do not turn them into one combined monorepo.

## Proposed Layout

```text
QLCT-api/
  .github/
  src/                 # NestJS runtime code, including src/supabase service
  test/                # Unit, e2e, and database tests
  supabase/            # Supabase CLI config and migrations
  package.json         # API package, no workspace wrapper
  nest-cli.json
  tsconfig*.json
  ...

QLCT-web/
  .github/
  src/                 # Next.js app, components, libraries, and types
  public/
  test/
  e2e/
  package.json         # Web package, no workspace wrapper
  next.config.ts
  vercel.json
  ...
```

## Goals

- Eliminate the duplicate `src/src` levels and the unused workspace scripts that refer to the other repository's app.
- Keep runtime Supabase integration code under API `src/supabase`; put the Supabase CLI project (`config.toml`, migrations, CLI ignore file) at API repository root, its conventional workdir.
- Keep local environment files in the new app root without displaying or changing their values.
- Update package scripts, test/config paths, GitHub Actions, README instructions, and Vercel configuration to match the new roots.
- Remove only obsolete boilerplate and generated artifacts left in the old package roots; preserve root `node_modules`, lockfiles, tracked migrations, and user-authored files.

## Deployment Constraints

- Vercel's documented Root Directory is currently `src` and must change to `.` after the web move. Confirm whether Render is similarly configured and update it to `.` if so. This workspace cannot update hosted settings; deploys must not be triggered as part of this task.
- Keep production migration/deploy gating intact. Update migration detection to `supabase/migrations/**` and use the repository root as the Supabase CLI workdir.
- Keep the existing API worktree edits to `package.json`, `.gitignore`, README, and workflow, incorporating rather than replacing them.

## Non-Goals

- No application behavior, API contract, database schema, migration contents, dependencies, or hosting providers change.
- No production migration or remote deployment is run.
- No secrets or environment values are printed or rewritten.

## Verification

- API: frozen-lockfile install, type check, lint, unit tests, build, and Supabase CLI config discovery from repository root.
- Web: frozen-lockfile install, type check, lint, Vitest suite, and Next.js production build from repository root.
- Both: verify CI paths and deployment commands, inspect `git diff --check`, and ensure generated/cache folders are not mistaken for source files.

## Rollout Order

Restructure and validate API first, then web. The code changes can be prepared independently, but production deployments should wait until the corresponding Render/Vercel Root Directory setting is updated.
