-- Re-seeds rows that TRUNCATE wipes but the app assumes always exist.
-- Safe to run any number of times (ON CONFLICT DO NOTHING everywhere).
-- Run this after any dev-DB nuke/truncate script, or whenever the
-- 'Credit' debit bank option disappears from a dev/staging environment.
--
-- FOR DEVELOPMENT/STAGING DB ONLY.

DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  -- Prefer an admin with telegram_chat_id set — see dev_nuke_and_reseed.sql's
  -- note on why (bank_balance_master's created_by/updated_by FKs are
  -- ON DELETE RESTRICT, which can otherwise block a later user-cleanup delete).
  SELECT mobile_number INTO v_seed_user FROM authorised_users
  WHERE role = 'admin' AND telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id) <> ''
  LIMIT 1;

  IF v_seed_user IS NULL THEN
    SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role = 'admin' LIMIT 1;
  END IF;

  IF v_seed_user IS NOT NULL THEN
    -- 'Credit' sentinel in bank_balance_master — lets the Credit Ledger
    -- feature's Debit Bank Type = 'Credit' be selected (042_credit_purchases_and_ledger.sql).
    INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
    VALUES ('Credit', CURRENT_DATE, 0, true, v_seed_user, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;

    -- Canonical Indian Banks in indian_bank_master (026 / 051)
    INSERT INTO "public"."indian_bank_master" (bank_name, is_active, created_by) VALUES
      ('State Bank of India', true, v_seed_user),
      ('Punjab National Bank', true, v_seed_user),
      ('Bank of Baroda', true, v_seed_user),
      ('Canara Bank', true, v_seed_user),
      ('Union Bank of India', true, v_seed_user),
      ('Indian Bank', true, v_seed_user),
      ('Bank of India', true, v_seed_user),
      ('Central Bank of India', true, v_seed_user),
      ('Indian Overseas Bank', true, v_seed_user),
      ('UCO Bank', true, v_seed_user),
      ('Bank of Maharashtra', true, v_seed_user),
      ('Punjab & Sind Bank', true, v_seed_user),
      ('HDFC Bank', true, v_seed_user),
      ('ICICI Bank', true, v_seed_user),
      ('Axis Bank', true, v_seed_user),
      ('Kotak Mahindra Bank', true, v_seed_user),
      ('IndusInd Bank', true, v_seed_user),
      ('Yes Bank', true, v_seed_user),
      ('IDFC FIRST Bank', true, v_seed_user),
      ('Federal Bank', true, v_seed_user),
      ('South Indian Bank', true, v_seed_user),
      ('Karnataka Bank', true, v_seed_user),
      ('Karur Vysya Bank', true, v_seed_user),
      ('City Union Bank', true, v_seed_user),
      ('Tamilnad Mercantile Bank', true, v_seed_user),
      ('DCB Bank', true, v_seed_user),
      ('RBL Bank', true, v_seed_user),
      ('CSB Bank', true, v_seed_user),
      ('Bandhan Bank', true, v_seed_user),
      ('Jammu & Kashmir Bank', true, v_seed_user),
      ('Nainital Bank', true, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'Sentinel reseed skipped: no admin user found in authorised_users. Create an admin first, then re-run this script.';
  END IF;
END $$;
