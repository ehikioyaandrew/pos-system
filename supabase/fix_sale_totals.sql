-- Recalculate sale line totals and sale total_amount from unit_price × quantity.
-- Run in Supabase SQL Editor if sale totals are stale after a manual price edit.

-- 1) Fix line item totals
UPDATE public.sale_items_backup
SET
  total_price = COALESCE(unit_price, 0) * COALESCE(quantity, 0),
  synced_at = now()
WHERE ABS(
  COALESCE(total_price, 0) - (COALESCE(unit_price, 0) * COALESCE(quantity, 0))
) > 0.001;

-- 2) Fix sale headers from their line items
UPDATE public.sales_backup s
SET
  total_amount = COALESCE(x.line_total, 0),
  synced_at = now()
FROM (
  SELECT
    sale_id,
    SUM(COALESCE(total_price, unit_price * quantity, 0)) AS line_total
  FROM public.sale_items_backup
  GROUP BY sale_id
) x
WHERE s.id = x.sale_id
  AND ABS(COALESCE(s.total_amount, 0) - COALESCE(x.line_total, 0)) > 0.001;

-- Optional: fix one sale only (example)
-- UPDATE public.sale_items_backup
-- SET total_price = unit_price * quantity, synced_at = now()
-- WHERE sale_id = 1785609826810;
--
-- UPDATE public.sales_backup s
-- SET total_amount = (
--   SELECT SUM(COALESCE(total_price, unit_price * quantity, 0))
--   FROM public.sale_items_backup i
--   WHERE i.sale_id = s.id
-- ), synced_at = now()
-- WHERE s.id = 1785609826810;
