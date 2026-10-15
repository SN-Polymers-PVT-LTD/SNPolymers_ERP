-- Employee-scoped source discovery must not scan other employees' history or
-- payroll rows while holding a finalization fence. These also support the
-- existing monthly source resolver; no salary or workflow semantics change.
CREATE INDEX payroll_assignment_employee_scope_idx
 ON public.payroll_employee_assignments(employee_id,group_code,employee_category);
CREATE INDEX payroll_run_employee_source_period_idx
 ON public.payroll_run_employees(employee_id,period_from,period_to,run_id);
