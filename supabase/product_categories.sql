-- Run in Supabase SQL Editor.
-- Model:
--   category  = BAR / KITCHEN / ROOM (module)
--   packaging = Can / Plastic Bottle / Bottle / etc. (within a category)

-- Packaging types per business (Can, Plastic Bottle, Bottle, ...)
CREATE TABLE IF NOT EXISTS product_categories_backup (
  id BIGINT PRIMARY KEY,
  business_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TEXT,
  synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_business
  ON product_categories_backup (business_id);

ALTER TABLE product_categories_backup ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'product_categories_backup'
      AND policyname = 'Allow all for product_categories_backup'
  ) THEN
    CREATE POLICY "Allow all for product_categories_backup"
      ON product_categories_backup
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Product fields used by the web app
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS fridge_stock INTEGER DEFAULT 0;
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS show_stock INTEGER DEFAULT 0;
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS store_stock INTEGER DEFAULT 0;
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE products_backup ADD COLUMN IF NOT EXISTS packaging TEXT;

-- Optional index for filtering drinks by packaging under a category
CREATE INDEX IF NOT EXISTS idx_products_backup_category_packaging
  ON products_backup (business_id, category, packaging);
