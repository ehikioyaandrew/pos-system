-- Freeze fridge/store counts per product per report day so later stock edits
-- do not rewrite old Email Preview / daily email tables.
-- Run once in Supabase SQL Editor.

create table if not exists public.stock_daily_snapshots_backup (
  business_id bigint not null,
  product_id bigint not null,
  report_date date not null,
  fridge_stock integer not null default 0,
  show_stock integer not null default 0,
  store_stock integer not null default 0,
  synced_at timestamptz,
  primary key (business_id, product_id, report_date)
);

alter table public.stock_daily_snapshots_backup enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'stock_daily_snapshots_backup'
      and policyname = 'stock_daily_snapshots_all'
  ) then
    create policy stock_daily_snapshots_all
      on public.stock_daily_snapshots_backup
      for all
      using (true)
      with check (true);
  end if;
end $$;
