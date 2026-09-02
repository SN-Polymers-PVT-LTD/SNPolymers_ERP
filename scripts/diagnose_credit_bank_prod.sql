-- Diagnostic script: why doesn't 'Credit' appear in the Debit Bank dropdown
-- in production?
--
-- Run this against prod (Supabase SQL editor, or psql), read top to bottom.
-- Each SELECT is labeled so you can tell me exactly what came back and I
-- can pinpoint the fix without guessing.

-- 1. Did migration 042 (and its follow-ups) actually get applied to this DB?
--    Expect to see 042_credit_purchases_and_ledger.sql, 043_..., and
--    044/045 if you've deployed those too.
SELECT filename, applied_at
FROM public._migration_log
WHERE filename LIKE '04%'
ORDER BY applied_at;

-- 2. Does bank_balance_master even have the is_virtual column? (If this
--    errors with "column is_virtual does not exist", migration 042 never
--    ran here at all — check #1's output for it.)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bank_balance_master'
ORDER BY ordinal_position;

-- 3. Does the 'Credit' row exist at all, virtual or not?
SELECT id, bank_name, is_virtual, available_balance, created_by, created_at
FROM public.bank_balance_master
WHERE bank_name = 'Credit';

-- 4. Every bank_balance_master row, so you can see exactly what the
--    dropdown's data source actually contains right now.
SELECT id, bank_name, is_virtual, available_balance
FROM public.bank_balance_master
ORDER BY bank_name;

-- 5. Does an admin exist? (Confirms your report — should return >= 1 row.)
SELECT mobile_number, role, is_active
FROM public.authorised_users
WHERE role = 'admin';

-- 6. RLS check: is Row Level Security even enabled on this table, and if
--    so, what policies exist? Note: the backend's getBankBalances endpoint
--    queries with SUPABASE_SERVICE_ROLE_KEY (backend/src/db/supabase.js),
--    which bypasses RLS entirely — so this only matters if that env var is
--    somehow misconfigured to an anon/publishable key on your prod
--    deployment. Worth ruling out (#7) before chasing RLS policy content.
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'bank_balance_master' AND relnamespace = 'public'::regnamespace;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'bank_balance_master';

-- 7. NOT a SQL check — do this in your deploy platform, not here: confirm
--    the prod backend's SUPABASE_SERVICE_ROLE_KEY env var is actually the
--    service_role key (not the anon/publishable key). A backend running on
--    the wrong key would still work for most reads (RLS often allows
--    authenticated SELECT) but could silently exclude rows a policy hides
--    from non-service-role callers, which #3 above wouldn't reveal if you
--    ran it as postgres/service_role in the SQL editor (which bypasses RLS
--    the same way) — so if #3 finds the row but the app still doesn't show
--    it, this is the next thing to check.
