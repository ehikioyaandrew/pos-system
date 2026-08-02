-- Mark today's non-DEBT sales as COMPLETED (Africa/Lagos day).
-- Pending stays only for DEBT.

-- Preview
WITH bounds AS (
  SELECT
    (CURRENT_DATE::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((CURRENT_DATE + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
)
SELECT s.id, s.payment_method, s.payment_status, s.total_amount, s.created_at
FROM public.sales_backup s
CROSS JOIN bounds b
WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
  AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
  AND UPPER(COALESCE(s.payment_method, '')) <> 'DEBT'
  AND UPPER(COALESCE(s.payment_status, '')) = 'PENDING'
ORDER BY s.created_at;

-- Apply
WITH bounds AS (
  SELECT
    (CURRENT_DATE::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((CURRENT_DATE + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
)
UPDATE public.sales_backup s
SET
  payment_status = 'COMPLETED',
  synced_at = now()
FROM bounds b
WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
  AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
  AND UPPER(COALESCE(s.payment_method, '')) <> 'DEBT'
  AND UPPER(COALESCE(s.payment_status, '')) = 'PENDING';
