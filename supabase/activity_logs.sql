-- Activity / audit log for business actions (sale edits, debt payments, etc.)
-- Run in Supabase SQL Editor once.

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
