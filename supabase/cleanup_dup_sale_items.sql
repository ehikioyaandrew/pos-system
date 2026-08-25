-- Remove duplicate sale lines created when a date edit re-inserted items with new IDs.
-- Keeps the oldest row per sale + product + unit price.
-- Run in Supabase SQL Editor.

DELETE FROM public.sale_items_backup
WHERE id NOT IN (
  SELECT MIN(id)
  FROM public.sale_items_backup
  GROUP BY sale_id, product_id, unit_price
);

UPDATE public.sales_backup s
SET total_amount = COALESCE((
  SELECT SUM(COALESCE(si.total_price, si.unit_price * si.quantity, 0))
  FROM public.sale_items_backup si
  WHERE si.sale_id = s.id
), s.total_amount)
WHERE EXISTS (
  SELECT 1 FROM public.sale_items_backup si WHERE si.sale_id = s.id
);
