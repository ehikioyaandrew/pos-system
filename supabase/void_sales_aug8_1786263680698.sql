-- =============================================================================
-- Void / cancel two sales from 8 Aug 2026 and return stock.
--
-- Sale IDs:
--   1786263409480
--   1786263680698
--
-- Stock location is NOT stored on the sale. This script returns qty to
-- fridge_stock (normal POS). If a sale was from Show, change :loc below
-- or move Fridge → Show after restore.
--
-- Run in Supabase SQL Editor:
--   1) Preview SELECTs first
--   2) Then run the BEGIN…COMMIT block
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) PREVIEW — sales
-- -----------------------------------------------------------------------------
SELECT
  s.id,
  s.user_id,
  u.name AS staff_name,
  s.total_amount,
  s.payment_method,
  s.payment_status,
  s.notes,
  s.created_at
FROM public.sales_backup s
LEFT JOIN public.users_backup u ON u.id = s.user_id
WHERE s.id IN (1786263409480, 1786263680698)
ORDER BY s.id;

-- -----------------------------------------------------------------------------
-- B) PREVIEW — items + where stock will be returned (fridge)
-- -----------------------------------------------------------------------------
SELECT
  i.sale_id,
  i.product_id,
  p.name,
  i.quantity,
  i.unit_price,
  i.total_price,
  p.fridge_stock AS fridge_now,
  p.show_stock AS show_now,
  p.sports_stock AS sports_now,
  COALESCE(p.fridge_stock, 0) + i.quantity AS fridge_after
FROM public.sale_items_backup i
JOIN public.products_backup p ON p.id = i.product_id
WHERE i.sale_id IN (1786263409480, 1786263680698)
ORDER BY i.sale_id, p.name;

-- -----------------------------------------------------------------------------
-- C) PREVIEW — linked debt charges (if any)
-- -----------------------------------------------------------------------------
SELECT *
FROM public.debt_entries_backup
WHERE sale_id IN (1786263409480, 1786263680698);

-- -----------------------------------------------------------------------------
-- D) RESTORE STOCK + DELETE SALES (run after previews look correct)
-- -----------------------------------------------------------------------------
BEGIN;

-- Return sold qty to fridge
UPDATE public.products_backup p
SET
  fridge_stock = COALESCE(p.fridge_stock, 0) + i.qty,
  synced_at = now()
FROM (
  SELECT product_id, SUM(COALESCE(quantity, 0))::int AS qty
  FROM public.sale_items_backup
  WHERE sale_id IN (1786263409480, 1786263680698)
  GROUP BY product_id
) i
WHERE p.id = i.product_id;

-- Drop debt charges for these sales, then rebuild debt totals
DELETE FROM public.debt_entries_backup
WHERE sale_id IN (1786263409480, 1786263680698)
  AND UPPER(COALESCE(entry_type, '')) = 'CHARGE';

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

DELETE FROM public.sale_items_backup
WHERE sale_id IN (1786263409480, 1786263680698);

DELETE FROM public.sales_backup
WHERE id IN (1786263409480, 1786263680698);

COMMIT;

-- -----------------------------------------------------------------------------
-- E) VERIFY — should return 0 rows
-- -----------------------------------------------------------------------------
SELECT id FROM public.sales_backup
WHERE id IN (1786263409480, 1786263680698);
