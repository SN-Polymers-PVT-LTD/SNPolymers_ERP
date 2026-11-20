-- Pause new bonus and arrears activity without rewriting ledger or payslip history.
CREATE FUNCTION public.payroll_guard_paused_adjustments() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='payroll_adjustment_applications' THEN
  IF EXISTS (
   SELECT 1 FROM public.payroll_adjustments
   WHERE id=NEW.adjustment_id AND kind IN ('BONUS','SALARY_ARREARS')
  ) THEN
   RAISE EXCEPTION 'Bonus and salary arrears processing is temporarily disabled' USING ERRCODE='PY409';
  END IF;
 ELSIF NEW.kind IN ('BONUS','SALARY_ARREARS') THEN
  IF TG_OP='INSERT' OR NEW.status='APPROVED' THEN
   RAISE EXCEPTION 'Bonus and salary arrears processing is temporarily disabled' USING ERRCODE='PY409';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_block_paused_adjustments
 BEFORE INSERT OR UPDATE ON public.payroll_adjustments
 FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_paused_adjustments();

CREATE TRIGGER payroll_block_paused_adjustment_applications
 BEFORE INSERT ON public.payroll_adjustment_applications
 FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_paused_adjustments();

REVOKE ALL ON FUNCTION public.payroll_guard_paused_adjustments() FROM PUBLIC,anon,authenticated,service_role;
