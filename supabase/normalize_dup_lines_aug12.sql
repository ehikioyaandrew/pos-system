-- =============================================================================
-- 12 Aug 2026 — same product listed twice on one sale (staff switched
-- Normal/Staff and tapped again). Keep the first line, delete extras,
-- return extra qty to fridge, recalculate sale total (and debt charge).
--
-- Example: Bottle water 1 + 1 at ₦200 → keep qty 1, fridge +1, sale −₦200
--
-- Run in Supabase SQL Editor:
--   1) Preview SELECTs first
--   2) Then run the BEGIN…COMMIT block
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) PREVIEW — duplicate lines on 12 Aug (Africa/Lagos)
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
day_sales AS (
  SELECT s.id, s.total_amount, s.payment_method, s.created_at, s.notes
  FROM public.sales_backup s
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
),
dups AS (
  SELECT
    i.sale_id,
    i.product_id,
    i.unit_price,
    COUNT(*) AS line_count,
    SUM(i.quantity)::int AS qty_all,
    MIN(i.id) AS keep_item_id
  FROM public.sale_items_backup i
  JOIN day_sales d ON d.id = i.sale_id
  GROUP BY i.sale_id, i.product_id, i.unit_price
  HAVING COUNT(*) > 1
)
SELECT
  x.sale_id,
  d.created_at,
  d.payment_method,
  d.total_amount AS sale_total_now,
  p.name,
  x.product_id,
  x.unit_price,
  x.line_count,
  x.qty_all,
  x.keep_item_id,
  (x.qty_all - k.quantity)::int AS qty_to_return_to_fridge,
  d.total_amount
    - (x.qty_all - k.quantity) * x.unit_price AS sale_total_after
FROM dups x
JOIN day_sales d ON d.id = x.sale_id
JOIN public.products_backup p ON p.id = x.product_id
JOIN public.sale_items_backup k ON k.id = x.keep_item_id
ORDER BY d.created_at, p.name;

-- Extra rows that will be deleted
WITH bounds AS (
  SELECT
    (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
keep AS (
  SELECT MIN(i.id) AS keep_item_id
  FROM public.sale_items_backup i
  JOIN public.sales_backup s ON s.id = i.sale_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
  GROUP BY i.sale_id, i.product_id, i.unit_price
  HAVING COUNT(*) > 1
)
SELECT i.id, i.sale_id, i.product_id, p.name, i.quantity, i.unit_price, i.total_price
FROM public.sale_items_backup i
JOIN keep k ON true
JOIN public.products_backup p ON p.id = i.product_id
WHERE i.sale_id IN (
    SELECT i2.sale_id
    FROM public.sale_items_backup i2
    JOIN public.sales_backup s2 ON s2.id = i2.sale_id
    CROSS JOIN bounds b2
    WHERE (NULLIF(TRIM(s2.created_at::text), ''))::timestamptz >= b2.start_at
      AND (NULLIF(TRIM(s2.created_at::text), ''))::timestamptz < b2.end_at
    GROUP BY i2.sale_id, i2.product_id, i2.unit_price
    HAVING COUNT(*) > 1
  )
  AND i.id NOT IN (SELECT keep_item_id FROM keep)
  AND EXISTS (
    SELECT 1
    FROM public.sale_items_backup i3
    WHERE i3.sale_id = i.sale_id
      AND i3.product_id = i.product_id
      AND i3.unit_price = i.unit_price
      AND i3.id IN (SELECT keep_item_id FROM keep)
  )
ORDER BY i.sale_id, i.id;

-- -----------------------------------------------------------------------------
-- B) APPLY — run after preview looks correct
-- -----------------------------------------------------------------------------
BEGIN;

WITH bounds AS (
  SELECT
    (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
dups AS (
  SELECT
    i.sale_id,
    i.product_id,
    i.unit_price,
    MIN(i.id) AS keep_item_id,
    SUM(i.quantity)::int AS qty_all
  FROM public.sale_items_backup i
  JOIN public.sales_backup s ON s.id = i.sale_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
  GROUP BY i.sale_id, i.product_id, i.unit_price
  HAVING COUNT(*) > 1
),
extra AS (
  SELECT
    i.product_id,
    SUM(i.quantity)::int AS qty
  FROM public.sale_items_backup i
  JOIN dups x
    ON i.sale_id = x.sale_id
   AND i.product_id = x.product_id
   AND i.unit_price = x.unit_price
   AND i.id <> x.keep_item_id
  GROUP BY i.product_id
)
UPDATE public.products_backup p
SET
  fridge_stock = COALESCE(p.fridge_stock, 0) + e.qty,
  synced_at = now()
FROM extra e
WHERE p.id = e.product_id;

WITH bounds AS (
  SELECT
    (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
dups AS (
  SELECT
    i.sale_id,
    i.product_id,
    i.unit_price,
    MIN(i.id) AS keep_item_id
  FROM public.sale_items_backup i
  JOIN public.sales_backup s ON s.id = i.sale_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
  GROUP BY i.sale_id, i.product_id, i.unit_price
  HAVING COUNT(*) > 1
)
DELETE FROM public.sale_items_backup i
USING dups x
WHERE i.sale_id = x.sale_id
  AND i.product_id = x.product_id
  AND i.unit_price = x.unit_price
  AND i.id <> x.keep_item_id;

WITH bounds AS (
  SELECT
    (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos') AS start_at,
    ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos') AS end_at
),
touched AS (
  SELECT DISTINCT i.sale_id
  FROM public.sale_items_backup i
  JOIN public.sales_backup s ON s.id = i.sale_id
  CROSS JOIN bounds b
  WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz >= b.start_at
    AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz < b.end_at
)
UPDATE public.sales_backup s
SET
  total_amount = COALESCE((
    SELECT SUM(COALESCE(si.total_price, si.unit_price * si.quantity, 0))
    FROM public.sale_items_backup si
    WHERE si.sale_id = s.id
  ), 0),
  synced_at = now()
FROM touched t
WHERE s.id = t.sale_id;

-- Match debt CHARGE rows to the new sale total
UPDATE public.debt_entries_backup e
SET
  amount = s.total_amount,
  synced_at = now()
FROM public.sales_backup s
WHERE e.sale_id = s.id
  AND UPPER(COALESCE(e.entry_type, '')) = 'CHARGE'
  AND s.id IN (
    SELECT s2.id
    FROM public.sales_backup s2
    WHERE (NULLIF(TRIM(s2.created_at::text), ''))::timestamptz
            >= (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos')
      AND (NULLIF(TRIM(s2.created_at::text), ''))::timestamptz
            < ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
  );

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

COMMIT;

-- -----------------------------------------------------------------------------
-- C) VERIFY — duplicate groups on 12 Aug should be 0
-- -----------------------------------------------------------------------------
SELECT
  i.sale_id,
  i.product_id,
  i.unit_price,
  COUNT(*) AS line_count
FROM public.sale_items_backup i
JOIN public.sales_backup s ON s.id = i.sale_id
WHERE (NULLIF(TRIM(s.created_at::text), ''))::timestamptz
        >= (DATE '2026-08-12'::timestamp AT TIME ZONE 'Africa/Lagos')
  AND (NULLIF(TRIM(s.created_at::text), ''))::timestamptz
        < ((DATE '2026-08-12' + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
GROUP BY i.sale_id, i.product_id, i.unit_price
HAVING COUNT(*) > 1;
