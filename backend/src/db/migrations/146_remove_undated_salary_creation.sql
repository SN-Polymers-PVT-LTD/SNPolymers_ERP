-- The dated save operation is the only application salary creation entry point.
-- Keep the existing implementation as a private helper for the security-definer
-- dated operation and owner-controlled historical test fixtures; no public or
-- service caller can create a salary without its payroll applicability anymore.
REVOKE ALL ON FUNCTION public.create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
