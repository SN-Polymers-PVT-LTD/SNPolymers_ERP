-- The existing category and numeric constraints still validate the multiplier.
ALTER TABLE public.hr_factory_pay_rule_revisions
  DROP CONSTRAINT local_double_duty_twice;
