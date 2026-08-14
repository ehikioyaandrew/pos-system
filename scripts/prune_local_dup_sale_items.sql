-- Run on the shop PC local DB if you already fixed duplicates in Supabase
-- and have NOT installed a desktop build that prunes extras on Sync.
--
-- DB path: %APPDATA%\pos-system\pos.db
-- Tool: DB Browser for SQLite (or sqlite3)
--
-- Close the POS app first. Then run this, then open the app and Sync now.

BEGIN;

-- Extra lines: same sale + same product + same price, keep the lowest item id
DELETE FROM sale_items
WHERE id IN (
  SELECT i.id
  FROM sale_items i
  WHERE i.id NOT IN (
    SELECT MIN(i2.id)
    FROM sale_items i2
    GROUP BY i2.sale_id, i2.product_id, i2.unit_price
  )
);

-- Match sale totals to remaining lines
UPDATE sales
SET total_amount = COALESCE((
  SELECT SUM(COALESCE(si.total_price, si.unit_price * si.quantity, 0))
  FROM sale_items si
  WHERE si.sale_id = sales.id
), 0);

COMMIT;

SELECT 'done' AS status;
