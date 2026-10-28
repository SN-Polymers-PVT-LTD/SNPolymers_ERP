-- Migration 089: Self-healing beneficiary_bank_id synchronization trigger
-- Ensures any insert or update into projects_beneficiary_master or beneficiary_master
-- with a recognized bank_name automatically sets the canonical beneficiary_bank_id UUID,
-- and vice-versa.

-- 1. Create self-healing trigger function
CREATE OR REPLACE FUNCTION public.sync_beneficiary_bank_id()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- If bank_id is null but bank_name is provided, auto-resolve canonical bank_id
  IF NEW.beneficiary_bank_id IS NULL AND NEW.beneficiary_bank_name IS NOT NULL AND TRIM(NEW.beneficiary_bank_name) <> '' THEN
    SELECT id INTO NEW.beneficiary_bank_id
    FROM public.indian_bank_master
    WHERE lower(trim(bank_name)) = lower(trim(NEW.beneficiary_bank_name))
    LIMIT 1;
  -- If bank_id is provided but bank_name is missing, auto-populate bank_name snapshot
  ELSIF NEW.beneficiary_bank_id IS NOT NULL AND (NEW.beneficiary_bank_name IS NULL OR TRIM(NEW.beneficiary_bank_name) = '') THEN
    SELECT bank_name INTO NEW.beneficiary_bank_name
    FROM public.indian_bank_master
    WHERE id = NEW.beneficiary_bank_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Attach BEFORE INSERT OR UPDATE triggers
DROP TRIGGER IF EXISTS trg_sync_pbm_beneficiary_bank ON public.projects_beneficiary_master;
CREATE TRIGGER trg_sync_pbm_beneficiary_bank
BEFORE INSERT OR UPDATE ON public.projects_beneficiary_master
FOR EACH ROW
EXECUTE FUNCTION public.sync_beneficiary_bank_id();

DROP TRIGGER IF EXISTS trg_sync_bm_beneficiary_bank ON public.beneficiary_master;
CREATE TRIGGER trg_sync_bm_beneficiary_bank
BEFORE INSERT OR UPDATE ON public.beneficiary_master
FOR EACH ROW
EXECUTE FUNCTION public.sync_beneficiary_bank_id();

-- 3. Backfill beneficiary_master as well if any unlinked bank names exist
UPDATE public.beneficiary_master bm
SET beneficiary_bank_id = ibm.id
FROM public.indian_bank_master ibm
WHERE bm.beneficiary_bank_id IS NULL
  AND bm.beneficiary_bank_name IS NOT NULL
  AND lower(trim(bm.beneficiary_bank_name)) = lower(trim(ibm.bank_name));
