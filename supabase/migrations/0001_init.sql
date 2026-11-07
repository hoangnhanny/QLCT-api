-- QLCT family expense tracker: initial schema.
-- All app tables use a uuid primary key `id` (default gen_random_uuid())
-- and a `created_at timestamptz default now()` column, except `profiles`
-- whose primary key is `user_id` (1:1 with `auth.users`).

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('family', 'business')),
  name text not null,
  admin_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  status text not null check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (ledger_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  name text not null,
  icon text,
  sort int,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  amount bigint not null check (amount > 0),
  content text not null,
  category_id uuid references public.categories (id) on delete set null,
  image_path text,
  spent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  -- null member_user_id = ledger-level budget
  member_user_id uuid references auth.users (id),
  -- null category_id = total (all categories) budget
  category_id uuid references public.categories (id) on delete cascade,
  -- first day of month, UTC+7
  month date not null,
  amount bigint not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (ledger_id, member_user_id, category_id, month)
);

create table public.budget_alerts (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets (id) on delete cascade,
  threshold int not null check (threshold in (80, 100)),
  month date not null,
  created_at timestamptz not null default now(),
  unique (budget_id, threshold, month)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Enable RLS on all app tables. No policies are defined: only the API's
-- service role (which bypasses RLS) accesses these tables.
alter table public.profiles enable row level security;
alter table public.ledgers enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_alerts enable row level security;
alter table public.invites enable row level security;
alter table public.push_subscriptions enable row level security;

-- Private storage bucket for receipt images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
