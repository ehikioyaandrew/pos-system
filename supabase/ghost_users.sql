-- Ghost / support users: visible for login, hidden from Staff records & seat counts.
-- Run in Supabase SQL Editor.

ALTER TABLE users_backup
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_backup_hidden
  ON users_backup (business_id, is_hidden);

-- Example: create a ghost SuperAdmin for business 1766920491778
-- Username: hoteladmin | Password: password  (hash = base64 of password)
-- Uncomment and adjust before running:

/*
INSERT INTO users_backup (
  id,
  username,
  password_hash,
  role,
  name,
  email,
  business_id,
  is_active,
  is_hidden,
  temporary_password,
  created_at,
  synced_at
) VALUES (
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  'hoteladmin',
  'cGFzc3dvcmQ=',
  'SuperAdmin',
  'Support Admin',
  NULL,
  1766920491778,
  TRUE,
  TRUE,
  '',
  NOW()::TEXT,
  NOW()
)
ON CONFLICT (username) DO UPDATE
SET
  is_hidden = TRUE,
  business_id = EXCLUDED.business_id,
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  is_active = TRUE,
  synced_at = NOW();
*/

-- Hide an existing user (by username):
-- UPDATE users_backup SET is_hidden = TRUE WHERE username = 'admin2';

-- Make a hidden user visible again:
-- UPDATE users_backup SET is_hidden = FALSE WHERE username = 'hoteladmin';
