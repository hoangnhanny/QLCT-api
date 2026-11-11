alter table public.expenses
  add column if not exists payment_method text not null default 'cash'
  check (payment_method in ('cash', 'transfer'));
