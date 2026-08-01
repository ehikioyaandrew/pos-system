-- Sports / recreation (services) + optional sports_stock
-- Run in Supabase SQL editor.

ALTER TABLE products_backup
  ADD COLUMN IF NOT EXISTS sports_stock INTEGER DEFAULT 0;

-- Service duration for Sports amenities (used at sale time)
-- Swimming → hours; Table Tennis / Pool / Snooker / Shisha → days
ALTER TABLE products_backup
  ADD COLUMN IF NOT EXISTS duration_value NUMERIC DEFAULT NULL;

ALTER TABLE products_backup
  ADD COLUMN IF NOT EXISTS duration_unit TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_products_backup_sports_stock
  ON products_backup (business_id, sports_stock);

ALTER TABLE product_categories_backup
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'packaging';

UPDATE product_categories_backup
SET kind = 'packaging'
WHERE kind IS NULL OR kind = '';
