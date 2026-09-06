-- Secretary product edit toggles + ensure report permissions table is ready.
-- Run in Supabase SQL Editor once.

ALTER TABLE public.report_permissions_backup
  ADD COLUMN IF NOT EXISTS secretary_can_edit_prices BOOLEAN DEFAULT FALSE;

ALTER TABLE public.report_permissions_backup
  ADD COLUMN IF NOT EXISTS secretary_can_edit_stock BOOLEAN DEFAULT FALSE;
