-- Migration 0006: Track registered OAuth providers on public.profiles
-- Prevents logging in with an unlinked OAuth provider sharing the same email
-- and allows linking multiple OAuth providers to a single canonical user_id.

alter table public.profiles
  add column if not exists auth_providers text[] not null default '{}';
