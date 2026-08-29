-- Migration 040: robustness fixes for work_order_mappings / je_zo_mappings,
-- found in a bug audit of workOrderMappings.controller.js / userMappings.controller.js
-- (see docs/bugs/work-order-and-je-zo-mapping-bugs.md).
--
-- 1. Snapshot columns (je_name/zo_name/assigned_by_name/deactivated_by_name, plus
--    zo_user_id on work_order_mappings). Previously these were resolved via a live
--    join/lookup on every read (resolveDisplayNames() + projects_master!inner join),
--    which means a "Deactivation Info" record silently changes if the related
--    project's ZO or a user's display_name changes after the mapping was deactivated
--    -- an audit trail that isn't actually a point-in-time record. From this
--    migration forward, names are captured once at write time and read back as-is.
--    Existing rows are backfilled below on a best-effort basis using *current*
--    related data -- historical rows before this migration cannot be reconstructed
--    to reflect what was true at their own assignment/deactivation time.
--
-- 2. transfer_je_to_zo_transact: the JE->ZO transfer previously ran as three
--    separate, non-transactional Supabase calls from Node (deactivate old work
--    orders, deactivate old je_zo_mappings row, insert new one). A concurrent
--    transfer for the same JE could lose the race on the unique partial index
--    (idx_je_zo_mappings_active_unique) on the final insert *after* the first two
--    writes already committed, leaving the JE with no active ZO mapping and no
--    active work orders. Moving the whole sequence into one plpgsql function
--    (single transaction, rolls back entirely on any failure) closes that. An
--    advisory lock scoped to the JE serializes concurrent transfers for the same
--    JE, and the pending/hold requisition guard is re-checked inside that lock
--    (closing the previous TOCTOU gap between the Node-side check and the writes).
--    Work orders are deactivated by the JE's own active work_order_mappings rows
--    directly, not derived from the old ZO's *current* project list, which could
--    drift and miss mappings if a project's ZO ownership changed after assignment.
--
-- 3. deactivate_work_order_mapping_transact / deactivate_je_zo_mapping_transact:
--    single-row deactivation RPCs so the deactivated_by_name snapshot is written
--    atomically with the status flip, and so a plain "unmap" action (previously
--    only possible implicitly via transfer) has something to call.
--
-- 4. fn_validate_work_order_mapping_zonal_consistency: this BEFORE INSERT OR UPDATE
--    trigger re-validates JE/project zonal consistency on *every* update to
--    work_order_mappings, including a plain deactivation. That directly blocks the
--    #2 fix above: deactivating a work order mapping whose project has since drifted
--    to a different ZO (exactly the case that needs deactivating) trips the same
--    mismatch check meant for activation. Consistency only needs to hold when a row
--    is being made/kept active - skip the check when NEW.is_active is false.

-- ============================================================================
-- 1. Snapshot columns
-- ============================================================================

ALTER TABLE "public"."work_order_mappings"
    ADD COLUMN IF NOT EXISTS "je_name" character varying,
    ADD COLUMN IF NOT EXISTS "assigned_by_name" character varying,
    ADD COLUMN IF NOT EXISTS "zo_user_id" character varying,
    ADD COLUMN IF NOT EXISTS "zo_name" character varying,
    ADD COLUMN IF NOT EXISTS "deactivated_by_name" character varying;

ALTER TABLE "public"."je_zo_mappings"
    ADD COLUMN IF NOT EXISTS "je_name" character varying,
    ADD COLUMN IF NOT EXISTS "zo_name" character varying,
    ADD COLUMN IF NOT EXISTS "assigned_by_name" character varying,
    ADD COLUMN IF NOT EXISTS "deactivated_by_name" character varying;

-- Best-effort backfill using current related data (see header note above).
-- Disabled for the duration: these UPDATEs only ever write the new snapshot
-- columns and touch every historical row unconditionally, so they must not be
-- able to fail on unrelated role/zonal-consistency checks against rows whose
-- referenced user's role or project's ZO has since changed (this is what broke
-- the first attempt to run this migration - see 041 for the permanent fix to
-- the role-validation trigger itself).
ALTER TABLE "public"."work_order_mappings" DISABLE TRIGGER "trg_validate_work_order_mapping_zonal_consistency";
ALTER TABLE "public"."je_zo_mappings" DISABLE TRIGGER "trg_validate_je_zo_mapping_roles";

UPDATE "public"."work_order_mappings" wom
SET "je_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = wom.je_user_id),
    "assigned_by_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = wom.assigned_by),
    "zo_user_id" = (SELECT zo_user_id FROM projects_master WHERE work_order_no = wom.work_order_no),
    "zo_name" = (
        SELECT au.display_name
        FROM projects_master pm
        JOIN authorised_users au ON au.mobile_number = pm.zo_user_id
        WHERE pm.work_order_no = wom.work_order_no
    ),
    "deactivated_by_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = wom.deactivated_by);

UPDATE "public"."je_zo_mappings" jzm
SET "je_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = jzm.je_user_id),
    "zo_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = jzm.zo_user_id),
    "assigned_by_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = jzm.assigned_by),
    "deactivated_by_name" = (SELECT display_name FROM authorised_users WHERE mobile_number = jzm.deactivated_by);

ALTER TABLE "public"."work_order_mappings" ENABLE TRIGGER "trg_validate_work_order_mapping_zonal_consistency";
ALTER TABLE "public"."je_zo_mappings" ENABLE TRIGGER "trg_validate_je_zo_mapping_roles";

-- ============================================================================
-- 2. RPC: transfer_je_to_zo_transact
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."transfer_je_to_zo_transact"(
    p_je    character varying,
    p_zo    character varying,
    p_actor character varying
) RETURNS je_zo_mappings LANGUAGE plpgsql AS $$
DECLARE
    v_old_mapping je_zo_mappings;
    v_pending     integer;
    v_je_name     character varying;
    v_zo_name     character varying;
    v_actor_name  character varying;
    v_new_mapping je_zo_mappings;
BEGIN
    -- Serialize concurrent transfers for the same JE so the requisition guard,
    -- the old-mapping lookup, and the deactivate/insert below can't interleave
    -- with another transfer request for this JE.
    PERFORM pg_advisory_xact_lock(hashtext('je_zo_transfer_' || p_je));

    SELECT COUNT(*) INTO v_pending
    FROM requisitions
    WHERE requester_user_id = p_je
      AND requisition_status IN ('Pending', 'Hold');

    IF v_pending > 0 THEN
        RAISE EXCEPTION 'Cannot transfer JE. Uncompleted requisitions remain.' USING ERRCODE = 'REQ01';
    END IF;

    SELECT display_name INTO v_je_name FROM authorised_users WHERE mobile_number = p_je;
    SELECT display_name INTO v_zo_name FROM authorised_users WHERE mobile_number = p_zo;
    SELECT display_name INTO v_actor_name FROM authorised_users WHERE mobile_number = p_actor;

    SELECT * INTO v_old_mapping
    FROM je_zo_mappings
    WHERE je_user_id = p_je AND is_active = true
    FOR UPDATE;

    -- Deactivate the JE's own active work-order mappings directly, rather than
    -- re-deriving the set from the old ZO's current project list (which can drift
    -- if a project's ZO ownership changed after the work order was assigned).
    UPDATE work_order_mappings
    SET is_active = false,
        reason = 'Transferred',
        deactivated_at = now(),
        deactivated_by = p_actor,
        deactivated_by_name = v_actor_name
    WHERE je_user_id = p_je AND is_active = true;

    IF v_old_mapping.id IS NOT NULL THEN
        UPDATE je_zo_mappings
        SET is_active = false,
            deactivated_at = now(),
            deactivated_by = p_actor,
            deactivated_by_name = v_actor_name
        WHERE id = v_old_mapping.id;
    END IF;

    INSERT INTO je_zo_mappings (
        je_user_id, zo_user_id, is_active, assigned_by,
        je_name, zo_name, assigned_by_name
    ) VALUES (
        p_je, p_zo, true, p_actor,
        v_je_name, v_zo_name, v_actor_name
    )
    RETURNING * INTO v_new_mapping;

    RETURN v_new_mapping;
END; $$;

-- ============================================================================
-- 3. RPC: deactivate_work_order_mapping_transact
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."deactivate_work_order_mapping_transact"(
    p_id     uuid,
    p_reason character varying,
    p_actor  character varying
) RETURNS work_order_mappings LANGUAGE plpgsql AS $$
DECLARE
    v_mapping    work_order_mappings;
    v_actor_name character varying;
BEGIN
    SELECT * INTO v_mapping FROM work_order_mappings WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work Order assignment not found.' USING ERRCODE = 'NF001';
    END IF;
    IF NOT v_mapping.is_active THEN
        RAISE EXCEPTION 'Mapping already inactive.' USING ERRCODE = 'STA01';
    END IF;

    SELECT display_name INTO v_actor_name FROM authorised_users WHERE mobile_number = p_actor;

    UPDATE work_order_mappings
    SET is_active = false,
        reason = p_reason,
        deactivated_at = now(),
        deactivated_by = p_actor,
        deactivated_by_name = v_actor_name
    WHERE id = p_id
    RETURNING * INTO v_mapping;

    RETURN v_mapping;
END; $$;

-- ============================================================================
-- 4. RPC: deactivate_je_zo_mapping_transact
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."deactivate_je_zo_mapping_transact"(
    p_id    uuid,
    p_actor character varying
) RETURNS je_zo_mappings LANGUAGE plpgsql AS $$
DECLARE
    v_mapping    je_zo_mappings;
    v_actor_name character varying;
BEGIN
    SELECT * INTO v_mapping FROM je_zo_mappings WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'JE-ZO mapping not found.' USING ERRCODE = 'NF001';
    END IF;
    IF NOT v_mapping.is_active THEN
        RAISE EXCEPTION 'Mapping already inactive.' USING ERRCODE = 'STA01';
    END IF;

    SELECT display_name INTO v_actor_name FROM authorised_users WHERE mobile_number = p_actor;

    UPDATE je_zo_mappings
    SET is_active = false,
        deactivated_at = now(),
        deactivated_by = p_actor,
        deactivated_by_name = v_actor_name
    WHERE id = p_id
    RETURNING * INTO v_mapping;

    RETURN v_mapping;
END; $$;

-- ============================================================================
-- 5. Fix: skip zonal consistency validation on deactivation
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_je_zo   VARCHAR;
    v_wo_zo   VARCHAR;
BEGIN
    -- Only activating (or keeping active) a mapping needs zonal consistency;
    -- deactivating an already-inconsistent mapping must always be allowed.
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    SELECT zo_user_id INTO v_je_zo
      FROM public.je_zo_mappings
     WHERE je_user_id = NEW.je_user_id AND is_active = true;

    IF v_je_zo IS NULL THEN
        RAISE EXCEPTION 'Junior Engineer % is not assigned to any active Zonal Office.', NEW.je_user_id;
    END IF;

    SELECT zo_user_id INTO v_wo_zo
      FROM public.projects_master
     WHERE work_order_no = NEW.work_order_no;

    IF v_wo_zo IS NULL THEN
        RAISE EXCEPTION 'Work Order % has no assigned owning Zonal Office.', NEW.work_order_no;
    END IF;

    IF v_wo_zo != v_je_zo THEN
        RAISE EXCEPTION 'Mismatched ZO assignment. Junior Engineer belongs to ZO %, but Work Order belongs to ZO %.',
            v_je_zo, v_wo_zo;
    END IF;

    RETURN NEW;
END;
$$;
