-- Migration 0005: Drop savings_goals_user_id_fkey constraint.
-- Commit 919e321 appended this drop to 0004_auth_google_profiles.sql after 0004
-- had already been applied, so `supabase db push` skipped it on existing databases.
alter table public.savings_goals
  drop constraint if exists savings_goals_user_id_fkey;
