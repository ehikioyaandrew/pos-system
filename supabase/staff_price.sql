-- Normal price = products_backup.price
-- Staff price  = products_backup.staff_price
-- Run in Supabase SQL editor.

ALTER TABLE products_backup
  ADD COLUMN IF NOT EXISTS staff_price NUMERIC DEFAULT NULL;

COMMENT ON COLUMN products_backup.price IS 'Normal selling price';
COMMENT ON COLUMN products_backup.staff_price IS 'Staff selling price';
