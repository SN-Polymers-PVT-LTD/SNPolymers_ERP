-- Migration 086: repair legacy canonical-bank seed attribution
--
-- Older test/seed flows reused +918000000001 as a ZO after an earlier
-- canonical-bank seed had attributed rows to that identity.  The current
-- contract requires canonical seeded bank rows to remain attributed to an
-- admin.  Repair only that known seed collision; do not rewrite legitimate
-- bank-master changes made by other roles.

DO $$
DECLARE
  v_admin_user varchar;
BEGIN
  SELECT mobile_number
    INTO v_admin_user
    FROM public.authorised_users
   WHERE role ILIKE 'admin'
     AND is_active = true
   ORDER BY CASE WHEN mobile_number = '+918276071523' THEN 0 ELSE 1 END,
            mobile_number
   LIMIT 1;

  IF v_admin_user IS NULL THEN
    RAISE NOTICE 'Legacy bank attribution repair skipped: no active admin user found.';
    RETURN;
  END IF;

  UPDATE public.indian_bank_master
     SET created_by = v_admin_user,
         updated_by = COALESCE(updated_by, v_admin_user),
         updated_at = now()
   WHERE created_by = '+918000000001';
END $$;
