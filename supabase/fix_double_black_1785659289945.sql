-- Fix Double black on sale #1785659289945: 1500 → 1800, then recalculate sale total.
-- (Previous script used the wrong sale id.)

-- Preview
SELECT i.id, i.sale_id, i.product_id, i.quantity, i.unit_price, i.total_price, s.total_amount
FROM public.sale_items_backup i
JOIN public.sales_backup s ON s.id = i.sale_id
WHERE i.sale_id = 1785659289945;

UPDATE public.sale_items_backup
SET
  unit_price = 1800,
  total_price = COALESCE(quantity, 0) * 1800,
  synced_at = now()
WHERE sale_id = 1785659289945;

UPDATE public.sales_backup s
SET
  total_amount = (
    SELECT SUM(COALESCE(total_price, unit_price * quantity, 0))
    FROM public.sale_items_backup i
    WHERE i.sale_id = s.id
  ),
  synced_at = now()
WHERE s.id = 1785659289945;

-- Verify: qty 2 × 1800 = 3600
SELECT i.quantity, i.unit_price, i.total_price, s.total_amount
FROM public.sale_items_backup i
JOIN public.sales_backup s ON s.id = i.sale_id
WHERE i.sale_id = 1785659289945;
