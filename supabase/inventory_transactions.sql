-- Stock moves (store → fridge/show) so day summary "new stock" and audit work online.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.inventory_transactions_backup (
  id BIGINT PRIMARY KEY,
  product_id BIGINT,
  transaction_type TEXT,
  quantity INTEGER,
  reason TEXT,
  user_id BIGINT,
  created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ
);

ALTER TABLE public.activity_logs_backup ADD COLUMN IF NOT EXISTS after_json TEXT;
ALTER TABLE public.activity_logs_backup ADD COLUMN IF NOT EXISTS before_json TEXT;
