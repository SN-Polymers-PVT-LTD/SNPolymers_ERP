-- Migration 084: Subcontractor Capability Atomic Transaction RPCs
-- Provides transactional, atomic creation, update, and capability reconciliation
-- for subcontractor_master and subcontractor_work_capabilities.
-- Prevents silent data loss, wipes on invalid work IDs, and concurrency hazards.

CREATE OR REPLACE FUNCTION public.save_subcontractor_transact(
  p_subcontractor_id uuid,
  p_subcontractor_name text,
  p_is_active boolean,
  p_work_ids uuid[],
  p_update_work_ids boolean,
  p_actor varchar
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.authorised_users%ROWTYPE;
  v_subcontractor_id uuid;
  v_unique_work_ids uuid[] := ARRAY[]::uuid[];
  v_valid_work_count integer;
  v_existing public.subcontractor_master%ROWTYPE;
BEGIN
  -- 1. Validate actor
  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active authorised user required' USING ERRCODE = 'P4B03';
  END IF;

  -- 2. Validate work-ID set if capabilities are requested to be updated
  IF p_update_work_ids IS TRUE AND p_work_ids IS NOT NULL AND array_length(p_work_ids, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT wid), ARRAY[]::uuid[]) INTO v_unique_work_ids
    FROM unnest(p_work_ids) AS wid
    WHERE wid IS NOT NULL;

    IF v_unique_work_ids IS NOT NULL AND array_length(v_unique_work_ids, 1) > 0 THEN
      SELECT count(*) INTO v_valid_work_count
      FROM public.subcontract_work_master
      WHERE id = ANY(v_unique_work_ids);

      IF v_valid_work_count <> array_length(v_unique_work_ids, 1) THEN
        RAISE EXCEPTION 'One or more subcontract work IDs do not exist' USING ERRCODE = 'P4B01';
      END IF;
    END IF;
  ELSE
    v_unique_work_ids := ARRAY[]::uuid[];
  END IF;

  -- 3. Branch: Create vs Update
  IF p_subcontractor_id IS NULL THEN
    -- CREATE FLOW
    IF p_subcontractor_name IS NULL OR btrim(p_subcontractor_name) = '' THEN
      RAISE EXCEPTION 'Subcontractor name cannot be blank' USING ERRCODE = 'P4B02';
    END IF;

    INSERT INTO public.subcontractor_master (
      subcontractor_name,
      is_active,
      created_by,
      updated_by
    ) VALUES (
      btrim(p_subcontractor_name),
      COALESCE(p_is_active, true),
      p_actor,
      p_actor
    ) RETURNING id INTO v_subcontractor_id;

    IF p_update_work_ids IS TRUE AND v_unique_work_ids IS NOT NULL AND array_length(v_unique_work_ids, 1) > 0 THEN
      INSERT INTO public.subcontractor_work_capabilities (
        subcontractor_id,
        subcontract_work_id,
        created_by
      )
      SELECT
        v_subcontractor_id,
        wid,
        p_actor
      FROM unnest(v_unique_work_ids) AS wid;
    END IF;

  ELSE
    -- UPDATE FLOW
    -- Acquire exclusive row lock to prevent race conditions during concurrent updates
    SELECT * INTO v_existing
    FROM public.subcontractor_master
    WHERE id = p_subcontractor_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Subcontractor not found' USING ERRCODE = 'P4B04';
    END IF;

    UPDATE public.subcontractor_master
    SET
      subcontractor_name = CASE
        WHEN p_subcontractor_name IS NOT NULL AND btrim(p_subcontractor_name) <> '' THEN btrim(p_subcontractor_name)
        ELSE subcontractor_name
      END,
      is_active = CASE
        WHEN p_is_active IS NOT NULL THEN p_is_active
        ELSE is_active
      END,
      updated_by = p_actor,
      updated_at = now()
    WHERE id = p_subcontractor_id;

    v_subcontractor_id := p_subcontractor_id;

    -- Reconcile capabilities if requested
    IF p_update_work_ids IS TRUE THEN
      IF v_unique_work_ids IS NULL OR array_length(v_unique_work_ids, 1) IS NULL OR array_length(v_unique_work_ids, 1) = 0 THEN
        DELETE FROM public.subcontractor_work_capabilities
        WHERE subcontractor_id = v_subcontractor_id;
      ELSE
        DELETE FROM public.subcontractor_work_capabilities
        WHERE subcontractor_id = v_subcontractor_id
          AND subcontract_work_id <> ALL(v_unique_work_ids);

        INSERT INTO public.subcontractor_work_capabilities (
          subcontractor_id,
          subcontract_work_id,
          created_by
        )
        SELECT
          v_subcontractor_id,
          wid,
          p_actor
        FROM unnest(v_unique_work_ids) AS wid
        ON CONFLICT (subcontractor_id, subcontract_work_id) DO NOTHING;
      END IF;
    END IF;

  END IF;

  RETURN v_subcontractor_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_subcontractor_transact(uuid, text, boolean, uuid[], boolean, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_subcontractor_transact(uuid, text, boolean, uuid[], boolean, varchar) TO service_role;

-- Convenience wrapper for creating subcontractor with initial capabilities
CREATE OR REPLACE FUNCTION public.create_subcontractor_transact(
  p_subcontractor_name text,
  p_work_ids uuid[],
  p_actor varchar
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.save_subcontractor_transact(
    p_subcontractor_id => NULL,
    p_subcontractor_name => p_subcontractor_name,
    p_is_active => true,
    p_work_ids => p_work_ids,
    p_update_work_ids => (p_work_ids IS NOT NULL),
    p_actor => p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_subcontractor_transact(text, uuid[], varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_subcontractor_transact(text, uuid[], varchar) TO service_role;

-- Convenience wrapper for updating subcontractor and reconciling capabilities
CREATE OR REPLACE FUNCTION public.update_subcontractor_transact(
  p_subcontractor_id uuid,
  p_subcontractor_name text,
  p_is_active boolean,
  p_work_ids uuid[],
  p_update_work_ids boolean,
  p_actor varchar
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.save_subcontractor_transact(
    p_subcontractor_id => p_subcontractor_id,
    p_subcontractor_name => p_subcontractor_name,
    p_is_active => p_is_active,
    p_work_ids => p_work_ids,
    p_update_work_ids => p_update_work_ids,
    p_actor => p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_subcontractor_transact(uuid, text, boolean, uuid[], boolean, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_subcontractor_transact(uuid, text, boolean, uuid[], boolean, varchar) TO service_role;
