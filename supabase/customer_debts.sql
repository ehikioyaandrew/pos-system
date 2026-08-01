-- Customer debt ledger (one row per customer per business)
-- Run in Supabase SQL editor for multi-device sync.

create table if not exists public.customer_debts_backup (
  id bigint primary key,
  business_id bigint not null,
  customer_name text not null,
  customer_key text not null,
  total_charged numeric not null default 0,
  total_paid numeric not null default 0,
  debt_date timestamptz,
  notes text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz
);

create unique index if not exists customer_debts_backup_business_key_uidx
  on public.customer_debts_backup (business_id, customer_key);

create index if not exists customer_debts_backup_business_status_idx
  on public.customer_debts_backup (business_id, status);

-- Charge / payment history
create table if not exists public.debt_entries_backup (
  id bigint primary key,
  debt_id bigint not null references public.customer_debts_backup (id) on delete cascade,
  business_id bigint not null,
  entry_type text not null, -- CHARGE | PAYMENT | MANUAL
  amount numeric not null,
  sale_id bigint,
  note text,
  entry_date timestamptz not null default now(),
  staff_id bigint,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create index if not exists debt_entries_backup_debt_idx
  on public.debt_entries_backup (debt_id, created_at desc);

create index if not exists debt_entries_backup_sale_idx
  on public.debt_entries_backup (sale_id);

alter table public.customer_debts_backup enable row level security;
alter table public.debt_entries_backup enable row level security;

-- Permissive policies for anon key POS apps (tighten later if needed)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'customer_debts_backup' and policyname = 'customer_debts_all'
  ) then
    create policy customer_debts_all on public.customer_debts_backup for all using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'debt_entries_backup' and policyname = 'debt_entries_all'
  ) then
    create policy debt_entries_all on public.debt_entries_backup for all using (true) with check (true);
  end if;
end $$;
