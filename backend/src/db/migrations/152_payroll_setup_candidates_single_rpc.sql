-- Migration 151 added a defaulted status argument, which creates an overload
-- rather than replacing migration 135/137's seven-argument function.
-- Keep the newer implementation: its trailing default preserves legacy SQL
-- and named PostgREST calls without keeping an ambiguous second overload.
DROP FUNCTION IF EXISTS public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer);

-- Preserve the application's SECURITY DEFINER boundary and service-only access.
REVOKE ALL ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
