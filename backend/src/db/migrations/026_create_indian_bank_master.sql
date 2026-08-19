-- Migration 026: indian_bank_master table
--
-- Previously the "recognized bank" list used to validate beneficiary_bank_name
-- (acctRequisition.schema.js's INDIAN_BANKS_SET) was a static JSON file
-- (constants/indianBanks.json), edited only by a code change + redeploy. This
-- promotes it to a real table so it can be managed from a master-data page,
-- same shape/conventions as account_sub_title_master (021_create_accounts_ho_approval.sql).
--
-- Seeded from the existing indianBanks.json list below so behavior is
-- unchanged immediately after this migration runs — the app-layer
-- INDIAN_BANKS_SET switches from JSON-sourced to DB-sourced (loaded at
-- server boot, refreshed in-place on each upsert) in the same change.

CREATE TABLE IF NOT EXISTS "public"."indian_bank_master" (
    "id"         uuid    DEFAULT gen_random_uuid() NOT NULL,
    "bank_name"  varchar NOT NULL,
    "is_active"  boolean NOT NULL DEFAULT true,
    "created_by" varchar NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_by" varchar,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "indian_bank_master_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_indian_bank_name"     UNIQUE (bank_name),
    CONSTRAINT "fk_ibm_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_ibm_updated_by" FOREIGN KEY (updated_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- Seed from constants/indianBanks.json. created_by has an FK to
-- authorised_users (like every other *_by column in this migration family),
-- so rather than hardcoding a placeholder mobile number that may not exist
-- on a given environment, this picks any existing admin at migration time.
-- If no admin exists yet (e.g. a brand-new environment seeded in a different
-- order), the seed is skipped — indian_bank_master ends up empty, and can be
-- populated later via the PUT /acct-requisitions/indian-banks endpoint once
-- an admin account exists.
DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role = 'admin' LIMIT 1;

  IF v_seed_user IS NOT NULL THEN
    INSERT INTO "public"."indian_bank_master" (bank_name, created_by) VALUES
      ('State Bank of India', v_seed_user),
      ('Punjab National Bank', v_seed_user),
      ('Bank of Baroda', v_seed_user),
      ('Canara Bank', v_seed_user),
      ('Union Bank of India', v_seed_user),
      ('Indian Bank', v_seed_user),
      ('Bank of India', v_seed_user),
      ('Central Bank of India', v_seed_user),
      ('Indian Overseas Bank', v_seed_user),
      ('UCO Bank', v_seed_user),
      ('Bank of Maharashtra', v_seed_user),
      ('Punjab & Sind Bank', v_seed_user),
      ('HDFC Bank', v_seed_user),
      ('ICICI Bank', v_seed_user),
      ('Axis Bank', v_seed_user),
      ('Kotak Mahindra Bank', v_seed_user),
      ('IndusInd Bank', v_seed_user),
      ('Yes Bank', v_seed_user),
      ('IDFC FIRST Bank', v_seed_user),
      ('Federal Bank', v_seed_user),
      ('South Indian Bank', v_seed_user),
      ('Karnataka Bank', v_seed_user),
      ('Karur Vysya Bank', v_seed_user),
      ('City Union Bank', v_seed_user),
      ('Tamilnad Mercantile Bank', v_seed_user),
      ('DCB Bank', v_seed_user),
      ('RBL Bank', v_seed_user),
      ('CSB Bank', v_seed_user),
      ('Bandhan Bank', v_seed_user),
      ('Jammu & Kashmir Bank', v_seed_user),
      ('Nainital Bank', v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'indian_bank_master seed skipped: no admin user found in authorised_users.';
  END IF;
END $$;
