-- Migration 0004: Decouple from Supabase Auth and enhance public.profiles
-- Enables Google OAuth / NextAuth to manage users directly in public.profiles.

-- 1. Add email and updated_at columns to public.profiles
alter table public.profiles
  add column if not exists email text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists profiles_email_idx on public.profiles(email);

-- 2. Drop foreign key constraints pointing to Supabase internal auth.users table
alter table public.profiles
  drop constraint if exists profiles_user_id_fkey;

alter table public.ledgers
  drop constraint if exists ledgers_admin_id_fkey;

alter table public.members
  drop constraint if exists members_user_id_fkey;

alter table public.expenses
  drop constraint if exists expenses_created_by_fkey;

alter table public.budgets
  drop constraint if exists budgets_member_user_id_fkey;

alter table public.invites
  drop constraint if exists invites_created_by_fkey;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_user_id_fkey;

alter table public.savings_goals
  drop constraint if exists savings_goals_user_id_fkey;
