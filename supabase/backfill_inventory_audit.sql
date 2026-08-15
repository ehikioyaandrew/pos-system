-- Backfill Audit log from history that already exists.
-- Run once in Supabase SQL Editor (safe to run again — skips rows already copied).
--
-- What this CAN restore:
--   • Stock receive / adjust / store→fridge moves, if inventory_transactions_backup exists
--   • Product created dates (who created them was never stored)
--
-- What this CANNOT restore:
--   • Who edited a product or prices (those edits were never logged)
--   • Moves that only lived on a till and were never synced to the cloud
--
-- Sales are still excluded (they belong on the Sales log).

-- 1) Inventory moves / adjustments
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'inventory_transactions_backup'
  ) then
    insert into public.activity_logs_backup (
      id, business_id, actor_user_id, action, entity_type, entity_id,
      summary, before_json, after_json, created_at, synced_at
    )
    select
      500000000000000000 + it.id,
      p.business_id,
      it.user_id,
      case
        when upper(coalesce(it.transaction_type, '')) like 'TRANSFER%' then 'STOCK_MOVE'
        else 'STOCK_ADJUST'
      end,
      'inventory',
      it.product_id::text,
      case
        when upper(coalesce(it.transaction_type, '')) like 'TRANSFER%' then
          coalesce(nullif(u.name, ''), u.username, 'Someone')
          || ' moved ' || it.quantity::text || ' ' || coalesce(p.name, 'item')
          || ' (' || replace(replace(coalesce(it.transaction_type, ''), 'TRANSFER_', ''), '_', ' → ') || ')'
        else
          coalesce(nullif(u.name, ''), u.username, 'Someone')
          || ' adjusted ' || abs(it.quantity)::text || ' ' || coalesce(p.name, 'item')
          || ' (' || lower(replace(coalesce(it.transaction_type, ''), 'STOCK_', '')) || ')'
      end,
      null,
      json_build_object(
        'product', p.name,
        'type', it.transaction_type,
        'quantity', it.quantity,
        'reason', coalesce(it.reason, ''),
        'historic', true
      )::text,
      coalesce(nullif(btrim(it.created_at::text), '')::timestamptz, now()),
      now()
    from public.inventory_transactions_backup it
    join public.products_backup p on p.id = it.product_id
    left join public.users_backup u on u.id = it.user_id
    where p.business_id is not null
      and lower(coalesce(it.reason, '')) not like '%sale%'
      and lower(coalesce(it.reason, '')) not like '%void%'
      and upper(coalesce(it.transaction_type, '')) not like '%SALE%'
    on conflict (id) do nothing;
  end if;
end $$;

-- 2) Product create dates (actor unknown)
insert into public.activity_logs_backup (
  id, business_id, actor_user_id, action, entity_type, entity_id,
  summary, before_json, after_json, created_at, synced_at
)
select
  520000000000000000 + p.id,
  p.business_id,
  null,
  'PRODUCT_CREATED',
  'product',
  p.id::text,
  'Created product ' || coalesce(p.name, 'item') || ' (historic — who created it was not stored)',
  null,
  json_build_object('name', p.name, 'historic', true)::text,
  coalesce(nullif(btrim(p.created_at::text), '')::timestamptz, now()),
  now()
from public.products_backup p
where p.business_id is not null
  and not exists (
    select 1
    from public.activity_logs_backup a
    where a.entity_type = 'product'
      and a.entity_id = p.id::text
      and a.action = 'PRODUCT_CREATED'
  )
on conflict (id) do nothing;

-- Check what landed
select action, count(*) as rows
from public.activity_logs_backup
where action in ('STOCK_MOVE', 'STOCK_ADJUST', 'PRODUCT_CREATED')
group by action
order by action;
