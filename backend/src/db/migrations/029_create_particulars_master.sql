-- Migration 029: Particulars master data
-- Mirrors account_sub_title_master (021_create_accounts_ho_approval.sql) exactly —
-- same shape, same soft-delete convention, same shared hard-delete-prevention trigger.

CREATE TABLE IF NOT EXISTS "public"."particulars_master" (
    "id"         uuid    DEFAULT gen_random_uuid() NOT NULL,
    "title"      varchar NOT NULL,
    "is_active"  boolean NOT NULL DEFAULT true,
    "created_by" varchar NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_by" varchar,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "particulars_master_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_particulars_title"    UNIQUE (title),
    CONSTRAINT "fk_pm_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_pm_updated_by" FOREIGN KEY (updated_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

CREATE INDEX "idx_pm_title_lower" ON particulars_master (lower(title));

ALTER TABLE "public"."particulars_master" ENABLE ROW LEVEL SECURITY;

-- Kept alongside the existing free-text `particulars` column (the resolved
-- display value) — same id/text pairing as account_sub_title_id /
-- account_sub_title_text. Nullable so legacy rows with no linked master row
-- are unaffected.
ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN "particulars_id" uuid REFERENCES particulars_master(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "public"."set_particulars_master_updated_at"()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE TRIGGER "trg_particulars_master_updated_at"
    BEFORE UPDATE ON particulars_master FOR EACH ROW EXECUTE FUNCTION set_particulars_master_updated_at();

-- Reuses the existing shared function (021_create_accounts_ho_approval.sql),
-- already used by account_sub_title_master/bank_balance_master/beneficiary_master.
CREATE OR REPLACE TRIGGER "trg_prevent_particulars_hard_delete"
    BEFORE DELETE ON particulars_master FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();

GRANT ALL ON TABLE "public"."particulars_master" TO anon, authenticated, service_role;
