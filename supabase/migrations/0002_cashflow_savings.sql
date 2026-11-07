alter table public.expenses
  add column type text not null default 'expense'
  check (type in ('expense', 'income'));

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target bigint not null check (target > 0),
  balance bigint not null default 0 check (balance >= 0),
  due_date date,
  created_at timestamptz not null default now()
);

create table public.savings_entries (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal')),
  amount bigint not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);

create index savings_goals_user_idx on public.savings_goals(user_id);
create index savings_entries_goal_idx on public.savings_entries(goal_id, created_at);
alter table public.savings_goals enable row level security;
alter table public.savings_entries enable row level security;