-- Migration 088: Backfill beneficiary_bank_id in projects_beneficiary_master
-- Ensures all existing and seeded records with a recognizable bank name have the canonical UUID foreign key linked.

UPDATE public.projects_beneficiary_master pbm
SET beneficiary_bank_id = ibm.id
FROM public.indian_bank_master ibm
WHERE pbm.beneficiary_bank_id IS NULL
  AND pbm.beneficiary_bank_name IS NOT NULL
  AND lower(trim(pbm.beneficiary_bank_name)) = lower(trim(ibm.bank_name));
