ALTER TABLE public.payroll_policy_master_revisions
  DROP CONSTRAINT payroll_policy_publication,
  ADD CONSTRAINT payroll_policy_publication CHECK (
    (status = 'DRAFT' AND published_by IS NULL AND published_at IS NULL
      AND revision_number IS NULL AND approval_reference IS NULL AND published_effective_to IS NULL)
    OR (status = 'PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL
      AND revision_number IS NOT NULL AND revision_number > 0
      AND (approval_reference IS NULL OR length(btrim(approval_reference)) BETWEEN 1 AND 2000)
      AND (published_effective_to IS NULL OR
        (isfinite(published_effective_to) AND effective_to IS NOT NULL AND published_effective_to >= effective_to)))
  );

DO $$
DECLARE
  definition text;
  old_guard constant text := 'IF nullif(btrim(p_approval_reference),'''') IS NULL OR length(p_approval_reference)>2000 THEN';
BEGIN
  SELECT pg_get_functiondef('public.publish_payroll_master(text,uuid,integer,text,text,uuid)'::regprocedure) INTO definition;
  IF strpos(definition, old_guard) = 0 THEN
    RAISE EXCEPTION 'Expected approval-reference guard was not found';
  END IF;
  definition := replace(definition, old_guard,
    'p_approval_reference := nullif(btrim(p_approval_reference),'''');
     IF (p_kind <> ''policies'' AND p_approval_reference IS NULL) OR length(p_approval_reference)>2000 THEN');
  EXECUTE definition;
END $$;
