-- Migration 089: Phase 4B final hardening.
--
-- This is forward-only because 088 is already part of the migration history.
-- The checks below make both the installed function rewrite and the revision-0
-- authoring invariant fail closed if an upstream function body drifts.

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old text := $needle$
    IF NOT v_base_authoring AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited after the initial Draft generation' USING ERRCODE = 'P4B47';
    END IF;$needle$;
  v_replacement text := $replacement$
    IF v_base_authoring AND v_kind <> 'BASE' THEN
      RAISE EXCEPTION 'Only BASE contributions are allowed before the first Final Approval' USING ERRCODE = 'P4B52';
    END IF;
    IF NOT v_base_authoring AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited after the initial Draft generation' USING ERRCODE = 'P4B47';
    END IF;$replacement$;
  v_occurrences integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'reconcile_subcontract_estimate_lines'
    AND p.pronargs = 4
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B reconciliation function was not found.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_occurrences := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Phase 4B reconciliation function drifted: expected exactly one revision-0 guard anchor, found %', v_occurrences;
  END IF;

  v_new := replace(v_def, v_old, v_replacement);
  EXECUTE v_new;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'reconcile_subcontract_estimate_lines'
    AND p.pronargs = 4
  ORDER BY p.oid DESC
  LIMIT 1;
  IF (length(v_def) - length(replace(v_def, 'P4B52', ''))) / length('P4B52') <> 1 THEN
    RAISE EXCEPTION 'Phase 4B revision-0 BASE-only guard was not installed exactly once.';
  END IF;
END $$;

-- 088 already performed the legacy workflow-body rewrite on a fresh install.
-- Validate its result strictly, while also repairing a database where 088 was
-- applied before the replacement anchor was present. Any ambiguous body shape
-- aborts this migration instead of silently accepting changed semantics.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old_pattern text := 'AND settlement_status IN (''RESERVED'', ''SETTLED'')';
  v_new_pattern text := 'AND settlement_status = ''RESERVED''';
  v_old_count integer;
  v_new_count integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B unlocked workflow function was not found.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_old_count := (length(v_def) - length(replace(v_def, v_old_pattern, ''))) / length(v_old_pattern);
  v_new_count := (length(v_def) - length(replace(v_def, v_new_pattern, ''))) / length(v_new_pattern);

  IF v_old_count > 1 OR v_new_count < 1 OR (v_old_count = 1 AND v_new_count <> 0) THEN
    RAISE EXCEPTION 'Phase 4B Finance consumption rewrite is ambiguous: old=% new=%', v_old_count, v_new_count;
  END IF;
  IF v_old_count = 1 AND v_new_count = 0 THEN
    v_new := replace(v_def, v_old_pattern, v_new_pattern);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Phase 4B Finance consumption rewrite did not change the function body.';
    END IF;
    EXECUTE v_new;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC
  LIMIT 1;
  v_old_count := (length(v_def) - length(replace(v_def, v_old_pattern, ''))) / length(v_old_pattern);
  v_new_count := (length(v_def) - length(replace(v_def, v_new_pattern, ''))) / length(v_new_pattern);
  IF v_old_count <> 0 OR v_new_count < 1 THEN
    RAISE EXCEPTION 'Phase 4B Finance consumption rewrite verification failed: old=% new=%', v_old_count, v_new_count;
  END IF;
END $$;
