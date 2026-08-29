-- Migration 039B: fn_validate_je_zo_mapping_roles re-validates that je_user_id/
-- zo_user_id still hold the 'je'/'zo' roles on *every* update to je_zo_mappings,
-- including a plain deactivation. A person's role is not frozen at assignment
-- time - if they're promoted/reassigned after having a mapping, any later UPDATE
-- to that row (deactivating it, or 040's backfill just after this one) re-checks
-- their *current* role and fails, even though the row isn't being reactivated.
--
-- Found when 040_mapping_snapshots_and_transact_fns.sql's backfill hit this
-- exact wall in production against a je_zo_mappings row whose zo_user_id had
-- since been reassigned away from 'zo' during an unrelated testing incident.
-- 040 was separately patched to disable this trigger for the duration of its
-- own backfill as a self-contained safety net, but that's a one-time workaround
-- for that one statement - the underlying trigger design flaw would keep
-- tripping up ordinary deactivate/transfer operations (e.g.
-- deactivate_je_zo_mapping_transact, transfer_je_to_zo_transact, both defined
-- in 040) any time a mapped user's role changes after the fact. This is the
-- permanent fix. Numbered to sort and apply *before* 040 (rather than 041,
-- discovered after but logically a prerequisite) so 040's RPCs are created on
-- top of already-correct trigger behavior from the start, with no window where
-- a fresh environment has the RPCs but not yet this fix.
--
-- Same fix as fn_validate_work_order_mapping_zonal_consistency (also in 040):
-- only enforce role validity when a row is being made/kept active.

CREATE OR REPLACE FUNCTION "public"."fn_validate_je_zo_mapping_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_je_role VARCHAR;
    v_zo_role VARCHAR;
BEGIN
    -- Only activating (or keeping active) a mapping needs the referenced users to
    -- currently hold the je/zo roles; deactivating a row must always be allowed,
    -- even if the person's role changed after the mapping was originally made.
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    SELECT role INTO v_je_role FROM public.authorised_users WHERE mobile_number = NEW.je_user_id;
    SELECT role INTO v_zo_role FROM public.authorised_users WHERE mobile_number = NEW.zo_user_id;

    IF v_je_role != 'je' THEN
        RAISE EXCEPTION 'Target user (%) is not a Junior Engineer.', NEW.je_user_id;
    END IF;

    IF v_zo_role != 'zo' THEN
        RAISE EXCEPTION 'Target user (%) is not a Zonal Office user.', NEW.zo_user_id;
    END IF;

    RETURN NEW;
END;
$$;
