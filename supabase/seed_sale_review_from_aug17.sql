-- Sales review starts 17 Aug 2026:
-- - before 17th → already APPROVED (no backlog)
-- - 17th through today → PENDING_REVIEW (secretary/admin can approve)
-- Run in Supabase SQL Editor.
-- Note: created_at is TEXT on sales_backup — cast before comparing.

ALTER TABLE public.sales_backup
  ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'PENDING_REVIEW';

-- Older sales: treat as already reviewed
UPDATE public.sales_backup
SET review_status = 'APPROVED'
WHERE (created_at::timestamptz) < TIMESTAMPTZ '2026-08-17 00:00:00+01'
  AND UPPER(COALESCE(payment_status, '')) != 'CANCELLED'
  AND (
    review_status IS NULL
    OR trim(review_status) = ''
    OR UPPER(review_status) = 'PENDING_REVIEW'
  );

-- From 17 Aug through end of today (Africa/Lagos +01): pending for approve
UPDATE public.sales_backup
SET review_status = 'PENDING_REVIEW'
WHERE (created_at::timestamptz) >= TIMESTAMPTZ '2026-08-17 00:00:00+01'
  AND (created_at::timestamptz) < ((CURRENT_DATE + INTERVAL '1 day')::timestamptz)
  AND UPPER(COALESCE(payment_status, '')) != 'CANCELLED'
  AND (
    review_status IS NULL
    OR trim(review_status) = ''
    OR UPPER(review_status) NOT IN ('APPROVED', 'PENDING_REVIEW')
  );

-- Optional check
-- SELECT date((created_at::timestamptz) AT TIME ZONE 'Africa/Lagos') AS day,
--        review_status,
--        COUNT(*)
-- FROM public.sales_backup
-- WHERE (created_at::timestamptz) >= TIMESTAMPTZ '2026-08-16 00:00:00+01'
--   AND UPPER(COALESCE(payment_status, '')) != 'CANCELLED'
-- GROUP BY 1, 2
-- ORDER BY 1, 2;
