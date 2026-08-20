-- Daily review: secretary/admin approve sales after push + manual check.
-- Run once in Supabase SQL Editor.

ALTER TABLE public.sales_backup
  ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'PENDING_REVIEW';

UPDATE public.sales_backup
SET review_status = 'PENDING_REVIEW'
WHERE review_status IS NULL OR trim(review_status) = '';
