-- Activity / audit log for business actions (sale edits, debt payments, etc.)
-- Run in Supabase SQL Editor once, then edit a sale or record a debt payment to see entries.
-- Audit log does NOT backfill old history — only actions after this table exists.

create table if not exists public.activity_logs_backup (
  id bigint primary key,
  business_id bigint not null,
  actor_user_id bigint,
  action text not null,
  entity_type text,
  entity_id text,
  summary text,
  before_json text,
  after_json text,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create index if not exists activity_logs_backup_business_created_idx
  on public.activity_logs_backup (business_id, created_at desc);

create index if not exists activity_logs_backup_action_idx
  on public.activity_logs_backup (business_id, action);

-- Allow the web app (anon key) to read/write logs, same pattern as other backup tables
alter table public.activity_logs_backup enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_logs_backup'
      and policyname = 'activity_logs_all'
  ) then
    create policy activity_logs_all
      on public.activity_logs_backup
      for all
      using (true)
      with check (true);
  end if;
end $$;

-- Optional: confirm table is ready
-- select count(*) from public.activity_logs_backup;
