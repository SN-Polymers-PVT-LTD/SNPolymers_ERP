-- Migration 063: permit reuse of requisition numbers after cancellation.
-- Cancelled rows remain immutable history; only active rows participate in
-- number uniqueness.

DO $$
BEGIN
  IF EXISTS (
    SELECT requisition_no
    FROM public.requisitions
    WHERE requisition_status IS DISTINCT FROM 'Cancelled'::public.requisition_status_enum
    GROUP BY requisition_no
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create active requisition-number index: duplicate active requisition numbers exist.';
  END IF;
END $$;

ALTER TABLE public.requisitions
  DROP CONSTRAINT IF EXISTS requisitions_requisition_no_key;

-- A cancelled requisition must retain its database row but no longer point at
-- deleted storage. The original schema made this URL mandatory, which caused
-- cancellation to fail with 23502 before storage cleanup could run.
ALTER TABLE public.requisitions
  ALTER COLUMN requisition_pdf_url DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_requisitions_active_requisition_no
  ON public.requisitions(requisition_no)
  WHERE requisition_status IS DISTINCT FROM 'Cancelled'::public.requisition_status_enum;

CREATE INDEX IF NOT EXISTS idx_requisitions_requisition_no_status
  ON public.requisitions(requisition_no, requisition_status);

-- 056 may already be recorded as applied on an existing database. Rewrite the
-- installed 31-argument function in-place so upgrades receive the same rule as
-- fresh installs without duplicating its lengthy established business logic.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_requisition_secure'
    AND p.pronargs = 31
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'create_requisition_secure 31-argument RPC was not found.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(
    v_def,
    'SELECT 1 FROM public.requisitions WHERE requisition_no = TRIM(p_requisition_no)',
    'SELECT 1 FROM public.requisitions WHERE requisition_no = TRIM(p_requisition_no) AND requisition_status IS DISTINCT FROM ''Cancelled''::public.requisition_status_enum'
  );

  IF v_new = v_def THEN
    IF v_def NOT LIKE '%requisition_status IS DISTINCT FROM%Cancelled%' THEN
      RAISE EXCEPTION 'Unable to update create_requisition_secure duplicate check.';
    END IF;
  ELSE
    EXECUTE v_new;
  END IF;
END $$;
