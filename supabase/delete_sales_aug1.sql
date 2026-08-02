-- =============================================================================
-- Delete sales for ONE calendar day (default: 1 Aug 2026, Africa/Lagos)
-- and optionally restore product stock so staff can re-enter those sales.
--
-- IMPORTANT
-- 1) Deleting sales alone does NOT return stock. Stock was reduced when the
--    sale was created. You must run the stock restore step (or fix stock by hand).
-- 2) Sale location (fridge/show) is NOT stored on sales, so restore adds qty
--    back to fridge_stock (the usual POS location). If some sales were from
--    Show, move stock Fridge → Show after restore if needed.
-- 3) Run preview SELECTs first. Then run the BEGIN…COMMIT block.
-- 4) created_at is TEXT in this DB — cast to timestamptz in all filters.
-- 5) Uncomment business_id filter if you only want one client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) PREVIEW — sales that will be deleted
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.*
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
SELECT
  id,
  user_id,
  total_amount,
  payment_method,
  payment_status,
  notes,
  created_at
FROM target_sales
ORDER BY created_at;

-- Count / money summary
WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id, s.total_amount
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
SELECT
  COUNT(*) AS sales_count,
  COALESCE(SUM(total_amount), 0) AS sales_total
FROM target_sales;

-- -----------------------------------------------------------------------------
-- B) PREVIEW — stock that would be returned (sum of items sold that day)
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
SELECT
  p.id AS product_id,
  p.name,
  p.fridge_stock AS fridge_now,
  p.show_stock AS show_now,
  SUM(i.quantity)::int AS qty_to_return_to_fridge
FROM public.sale_items_backup i
JOIN target_sales t ON t.id = i.sale_id
JOIN public.products_backup p ON p.id = i.product_id
GROUP BY p.id, p.name, p.fridge_stock, p.show_stock
ORDER BY p.name;

-- -----------------------------------------------------------------------------
-- C–E) RESTORE STOCK + DELETE (run after previews look correct)
-- -----------------------------------------------------------------------------
BEGIN;

WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
),
sold AS (
  SELECT i.product_id, SUM(i.quantity)::int AS qty
  FROM public.sale_items_backup i
  JOIN target_sales t ON t.id = i.sale_id
  GROUP BY i.product_id
)
UPDATE public.products_backup p
SET
  fridge_stock = COALESCE(p.fridge_stock, 0) + s.qty,
  synced_at = now()
FROM sold s
WHERE p.id = s.product_id;

WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
DELETE FROM public.debt_entries_backup d
USING target_sales t
WHERE d.sale_id = t.id
  AND UPPER(d.entry_type) = 'CHARGE';

UPDATE public.customer_debts_backup d
SET
  total_charged = COALESCE(x.charged, 0),
  total_paid = COALESCE(x.paid, 0),
  status = CASE
    WHEN COALESCE(x.charged, 0) - COALESCE(x.paid, 0) <= 0.0001 THEN 'SETTLED'
    ELSE 'OPEN'
  END,
  updated_at = now(),
  synced_at = now()
FROM (
  SELECT
    d2.id AS debt_id,
    COALESCE(SUM(
      CASE WHEN e.id IS NOT NULL AND UPPER(e.entry_type) IN ('CHARGE', 'MANUAL')
        THEN e.amount ELSE 0 END
    ), 0) AS charged,
    COALESCE(SUM(
      CASE WHEN e.id IS NOT NULL AND UPPER(e.entry_type) = 'PAYMENT'
        THEN e.amount ELSE 0 END
    ), 0) AS paid
  FROM public.customer_debts_backup d2
  LEFT JOIN public.debt_entries_backup e ON e.debt_id = d2.id
  GROUP BY d2.id
) x
WHERE d.id = x.debt_id;

WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
DELETE FROM public.sale_items_backup i
USING target_sales t
WHERE i.sale_id = t.id;

WITH bounds AS (
  SELECT
    (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
target_sales AS (
  SELECT s.id
  FROM public.sales_backup s
  JOIN public.users_backup u ON u.id = s.user_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
    -- AND u.business_id = 1
)
DELETE FROM public.sales_backup s
USING target_sales t
WHERE s.id = t.id;

COMMIT;

-- -----------------------------------------------------------------------------
-- F) VERIFY — should return 0 sales for Aug 1
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS remaining_aug1_sales
FROM public.sales_backup s
JOIN public.users_backup u ON u.id = s.user_id
WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz
        >= (DATE '2026-08-01'::timestamp AT TIME ZONE 'Africa/Lagos')
  AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz
        < ((DATE '2026-08-01' + 1)::timestamp AT TIME ZONE 'Africa/Lagos');
  -- AND u.business_id = 1;
