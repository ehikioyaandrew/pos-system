-- Persist fridge / show / sports on each sale so voids restore the right stock.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.sales_backup
  ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE public.sales_backup
SET location = 'fridge'
WHERE location IS NULL OR trim(location) = '';
