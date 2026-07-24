-- Optional tables for Settings (web). Local storage works without these.
-- Run in Supabase SQL Editor if you want cloud sync for email / report permissions.

CREATE TABLE IF NOT EXISTS report_permissions_backup (
  business_id BIGINT PRIMARY KEY,
  manager_can_view BOOLEAN DEFAULT TRUE,
  secretary_can_view BOOLEAN DEFAULT FALSE,
  staff_can_view BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_config_backup (
  business_id BIGINT PRIMARY KEY,
  smtp_server TEXT DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER DEFAULT 587,
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  from_name TEXT DEFAULT 'POS System',
  use_tls BOOLEAN DEFAULT TRUE,
  enabled BOOLEAN DEFAULT FALSE,
  notification_roles TEXT DEFAULT 'SuperAdmin,Manager',
  low_stock_enabled BOOLEAN DEFAULT TRUE,
  pending_sales_enabled BOOLEAN DEFAULT TRUE,
  daily_reports_enabled BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE report_permissions_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_config_backup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_report_permissions" ON report_permissions_backup;
CREATE POLICY "anon_all_report_permissions" ON report_permissions_backup
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_email_config" ON email_config_backup;
CREATE POLICY "anon_all_email_config" ON email_config_backup
  FOR ALL USING (true) WITH CHECK (true);
