-- Finds every je_zo_mappings / work_order_mappings row whose referenced user no
-- longer holds the role the mapping assumes (i.e. was a 'zo'/'je' at assignment
-- time, isn't anymore). This is exactly the class of row that broke migration 040's
-- backfill via trg_validate_je_zo_mapping_roles / trg_validate_work_order_mapping_zonal_consistency.
--
-- NOTE: role changes are not audited anywhere in this schema (admin.controller.js
-- updates authorised_users.role directly, no trigger logs it) - this can only show
-- the *current* mismatch, not when or how many times a role changed.

SELECT 'je_zo_mappings' AS source_table,
       jzm.id,
       jzm.je_user_id,
       jzm.zo_user_id,
       au_je.role AS je_current_role,
       au_zo.role AS zo_current_role,
       jzm.is_active,
       jzm.assigned_at
FROM je_zo_mappings jzm
LEFT JOIN authorised_users au_je ON au_je.mobile_number = jzm.je_user_id
LEFT JOIN authorised_users au_zo ON au_zo.mobile_number = jzm.zo_user_id
WHERE au_je.role IS DISTINCT FROM 'je' OR au_zo.role IS DISTINCT FROM 'zo'

UNION ALL

SELECT 'work_order_mappings' AS source_table,
       wom.id,
       wom.je_user_id,
       NULL AS zo_user_id,
       au_je.role AS je_current_role,
       NULL AS zo_current_role,
       wom.is_active,
       wom.assigned_at
FROM work_order_mappings wom
LEFT JOIN authorised_users au_je ON au_je.mobile_number = wom.je_user_id
WHERE au_je.role IS DISTINCT FROM 'je'

ORDER BY assigned_at DESC;
