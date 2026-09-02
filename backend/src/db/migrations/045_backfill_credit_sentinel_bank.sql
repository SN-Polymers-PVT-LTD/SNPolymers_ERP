-- Migration 045: backfill the 'Credit' sentinel bank_balance_master row.
--
-- 042_credit_purchases_and_ledger.sql only seeds this row if an admin user
-- already exists in authorised_users at the moment that migration is
-- applied — on an environment where no admin existed yet at that point
-- (e.g. prod, if migrations ran before the first admin account was created),
-- the seed silently no-ops (RAISE NOTICE, no error) and the 'Credit' debit
-- bank option never appears in the dropdown. Since 042 is already recorded
-- as applied there, it won't re-run on its own — this is the same seed
-- logic, safe to run again anywhere (ON CONFLICT DO NOTHING is a true no-op
-- if the row already exists, e.g. on local/staging where 042 already seeded it).

DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role = 'admin' LIMIT 1;

  IF v_seed_user IS NOT NULL THEN
    INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
    VALUES ('Credit', CURRENT_DATE, 0, true, v_seed_user, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'Credit sentinel bank_balance_master row skipped: still no admin user found in authorised_users.';
  END IF;
END $$;
