-- Migration 0009: Email + password credentials for form-based sign-in.
-- Password hashes live in their own table so they never leak into profile/member queries.

create table if not exists public.user_credentials (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));
