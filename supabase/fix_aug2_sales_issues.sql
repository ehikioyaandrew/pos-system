-- =============================================================================
-- Fix Aug 2 sales issues for M&P Treasure Hotel
-- Run in Supabase SQL Editor. Preview SELECTs first, then run UPDATE/DELETE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Pending only for DEBT — mark paid methods Completed
-- -----------------------------------------------------------------------------
-- Preview
SELECT id, payment_method, payment_status, total_amount, created_at
FROM public.sales_backup
WHERE UPPER(COALESCE(payment_method, '')) <> 'DEBT'
  AND UPPER(COALESCE(payment_status, '')) = 'PENDING'
ORDER BY created_at DESC;

UPDATE public.sales_backup
SET
  payment_status = 'COMPLETED',
  synced_at = now()
WHERE UPPER(COALESCE(payment_method, '')) <> 'DEBT'
  AND UPPER(COALESCE(payment_status, '')) = 'PENDING';

-- -----------------------------------------------------------------------------
-- 2) Remove duplicate sale #1785658344112 (keep #1785658302198)
--    Restore its items to fridge_stock, then delete sale + items.
-- -----------------------------------------------------------------------------
-- Preview items that will be restored / deleted
SELECT i.id, i.sale_id, i.product_id, p.name, i.quantity, i.unit_price, i.total_price
FROM public.sale_items_backup i
LEFT JOIN public.products_backup p ON p.id = i.product_id
WHERE i.sale_id IN (1785658302198, 1785658344112)
ORDER BY i.sale_id, i.id;

-- Restore fridge stock for the sale we are deleting
UPDATE public.products_backup p
SET
  fridge_stock = COALESCE(p.fridge_stock, 0) + i.qty,
  synced_at = now()
FROM (
  SELECT product_id, SUM(COALESCE(quantity, 0)) AS qty
  FROM public.sale_items_backup
  WHERE sale_id = 1785658344112
  GROUP BY product_id
) i
WHERE p.id = i.product_id;

-- Remove linked debt charge row if any (safe if none)
DELETE FROM public.debt_entries_backup
WHERE sale_id = 1785658344112;

DELETE FROM public.sale_items_backup
WHERE sale_id = 1785658344112;

DELETE FROM public.sales_backup
WHERE id = 1785658344112;

-- -----------------------------------------------------------------------------
-- 3) Bottle water sale #1785659235712
--    Split qty 12 → 9 normal price + 3 staff price, then recalculate total.
-- -----------------------------------------------------------------------------
-- Preview current line + product prices
SELECT
  i.*,
  p.name,
  p.price AS normal_price,
  COALESCE(NULLIF(p.staff_price, 0), p.price) AS staff_price
FROM public.sale_items_backup i
JOIN public.products_backup p ON p.id = i.product_id
WHERE i.sale_id = 1785659235712;

DO $$
DECLARE
  v_item public.sale_items_backup%ROWTYPE;
  v_normal numeric;
  v_staff numeric;
  v_new_id bigint;
BEGIN
  SELECT * INTO v_item
  FROM public.sale_items_backup
  WHERE sale_id = 1785659235712
  ORDER BY id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale items for #1785659235712 not found';
  END IF;

  SELECT
    COALESCE(p.price, 0),
    COALESCE(NULLIF(p.staff_price, 0), p.price, 0)
  INTO v_normal, v_staff
  FROM public.products_backup p
  WHERE p.id = v_item.product_id;

  IF v_normal IS NULL THEN
    RAISE EXCEPTION 'Product for bottle water sale not found';
  END IF;

  -- Keep original row as 9 × normal
  UPDATE public.sale_items_backup
  SET
    quantity = 9,
    unit_price = v_normal,
    total_price = 9 * v_normal,
    synced_at = now()
  WHERE id = v_item.id;

  -- Add staff line: 3 × staff price
  SELECT COALESCE(MAX(id), v_item.sale_id) + 1 INTO v_new_id
  FROM public.sale_items_backup;

  INSERT INTO public.sale_items_backup (
    id, sale_id, product_id, quantity, unit_price, total_price, synced_at
  ) VALUES (
    v_new_id,
    1785659235712,
    v_item.product_id,
    3,
    v_staff,
    3 * v_staff,
    now()
  );

  UPDATE public.sales_backup s
  SET
    total_amount = (
      SELECT SUM(COALESCE(total_price, unit_price * quantity, 0))
      FROM public.sale_items_backup i
      WHERE i.sale_id = s.id
    ),
    payment_status = CASE
      WHEN UPPER(COALESCE(s.payment_method, '')) = 'DEBT' THEN s.payment_status
      ELSE 'COMPLETED'
    END,
    synced_at = now()
  WHERE s.id = 1785659235712;
END $$;

-- Verify bottle water split
SELECT i.quantity, i.unit_price, i.total_price, p.name, p.price, p.staff_price, s.total_amount
FROM public.sale_items_backup i
JOIN public.products_backup p ON p.id = i.product_id
JOIN public.sales_backup s ON s.id = i.sale_id
WHERE i.sale_id = 1785659235712
ORDER BY i.id;

-- -----------------------------------------------------------------------------
-- 4) Double black sale #1785659289945 — unit price 1500 → 1800, recalculate
-- -----------------------------------------------------------------------------
-- Preview
SELECT i.*, s.total_amount
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
  payment_status = CASE
    WHEN UPPER(COALESCE(s.payment_method, '')) = 'DEBT' THEN s.payment_status
    ELSE 'COMPLETED'
  END,
  synced_at = now()
WHERE s.id = 1785659289945;

-- Verify: qty 2 × 1800 = 3600
SELECT i.quantity, i.unit_price, i.total_price, s.total_amount, s.payment_status
FROM public.sale_items_backup i
JOIN public.sales_backup s ON s.id = i.sale_id
WHERE i.sale_id = 1785659289945;
