-- Remove ghost user (admin2) entries from the audit log.
-- Also safe to re-run.

-- Preview
SELECT a.id, a.summary, a.action, a.created_at, u.username, u.is_hidden
FROM public.activity_logs_backup a
LEFT JOIN public.users_backup u ON u.id = a.actor_user_id
WHERE LOWER(COALESCE(u.username, '')) = 'admin2'
   OR COALESCE(u.is_hidden, false) = true
   OR LOWER(COALESCE(a.summary, '')) LIKE '%admin2%'
   OR LOWER(COALESCE(a.after_json, '')) LIKE '%"username":"admin2"%';

-- Delete those rows
DELETE FROM public.activity_logs_backup a
USING public.users_backup u
WHERE u.id = a.actor_user_id
  AND (LOWER(COALESCE(u.username, '')) = 'admin2' OR COALESCE(u.is_hidden, false) = true);

DELETE FROM public.activity_logs_backup
WHERE LOWER(COALESCE(summary, '')) LIKE '%admin2%'
   OR LOWER(COALESCE(after_json, '')) LIKE '%"username":"admin2"%';
