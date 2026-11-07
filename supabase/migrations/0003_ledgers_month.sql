alter table public.ledgers
  add column month date not null default date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date;

-- Backfill existing ledgers using created_at in Asia/Ho_Chi_Minh timezone
update public.ledgers
  set month = date_trunc('month', created_at at time zone 'Asia/Ho_Chi_Minh')::date;

create index ledgers_month_idx on public.ledgers(month);
