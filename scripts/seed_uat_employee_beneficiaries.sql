-- UAT/dev only: synthetic account numbers and IFSCs, canonical Indian banks.
-- Run this entire file in the UAT Supabase SQL editor (database-owner session).
-- Fills missing employee links only; includes inactive/exited employees too.
-- Excludes Local Daily-Wage Workers in both factories. Existing links stay intact.
BEGIN;

CREATE TEMP TABLE uat_employee_beneficiary_seed ON COMMIT DROP AS
SELECT e.id AS employee_id, e.employee_code,
       e.employee_name || ' [UAT TEST]' AS beneficiary_name,
       -- 18-digit TEXT, deterministically derived from employee UUID.
       '990' || lpad((('x' || substr(replace(e.id::text, '-', ''), 1, 12))::bit(48)::bigint)::text, 15, '0') AS account_number,
       bank.bank_name, bank.ifsc_prefix || '0UAT001' AS ifsc,
       NULL::uuid AS bank_id
FROM public.hr_employees e
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    (0, 'State Bank of India', 'SBIN'),
    (1, 'HDFC Bank', 'HDFC'),
    (2, 'ICICI Bank', 'ICIC'),
    (3, 'Axis Bank', 'UTIB')
  ) AS banks(slot, bank_name, ifsc_prefix)
  WHERE banks.slot = mod(('x' || substr(replace(e.id::text, '-', ''), 1, 2))::bit(8)::integer, 4)
) bank
WHERE e.beneficiary_id IS NULL
  AND e.employee_category <> 'Local Daily-Wage Workers';

DO $$
DECLARE actor_id uuid; actor_mobile varchar;
BEGIN
  SELECT id, mobile_number INTO actor_id, actor_mobile
  FROM public.authorised_users
  WHERE role = 'admin' AND is_active
  ORDER BY id LIMIT 1;
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'An active Admin is required for employee beneficiary audit attribution';
  END IF;

  -- Reuse the canonical master; do not invent or rename banks or activate them.
  UPDATE uat_employee_beneficiary_seed s SET bank_id = b.id
  FROM public.indian_bank_master b
  WHERE b.bank_name = s.bank_name AND b.is_active;
  IF EXISTS (SELECT 1 FROM uat_employee_beneficiary_seed WHERE bank_id IS NULL) THEN
    RAISE EXCEPTION 'Required active bank missing: check State Bank of India, HDFC Bank, ICICI Bank and Axis Bank in the Indian bank master';
  END IF;
  IF EXISTS (SELECT 1 FROM uat_employee_beneficiary_seed GROUP BY account_number, ifsc HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Synthetic account collision: no employee links were changed';
  END IF;

  INSERT INTO public.beneficiary_master
    (beneficiary_name, account_number, ifsc, beneficiary_bank_name, beneficiary_bank_id, created_by, updated_by)
  SELECT beneficiary_name, account_number, ifsc, bank_name, bank_id, actor_mobile, actor_mobile
  FROM uat_employee_beneficiary_seed
  ON CONFLICT (account_number, ifsc) DO NOTHING;

  -- Reruns can reuse our own exact record, never an unrelated account holder.
  IF EXISTS (
    SELECT 1 FROM uat_employee_beneficiary_seed s
    JOIN public.beneficiary_master b USING (account_number, ifsc)
    WHERE b.beneficiary_name IS DISTINCT FROM s.beneficiary_name
       OR b.beneficiary_bank_id IS DISTINCT FROM s.bank_id
       OR b.beneficiary_bank_name IS DISTINCT FROM s.bank_name
  ) THEN
    RAISE EXCEPTION 'Existing beneficiary conflicts with synthetic seed; transaction cancelled';
  END IF;

  UPDATE public.hr_employees e
  SET beneficiary_id = b.id, updated_by = actor_id
  FROM uat_employee_beneficiary_seed s
  JOIN public.beneficiary_master b USING (account_number, ifsc)
  WHERE e.id = s.employee_id AND e.beneficiary_id IS NULL
    AND e.employee_category <> 'Local Daily-Wage Workers';
  -- Existing HR and payroll source-fence/audit triggers remain enabled.
END $$;

SELECT e.employee_code, e.employee_name, e.employee_category, e.department,
       b.beneficiary_name, b.account_number, b.ifsc, b.beneficiary_bank_name
FROM uat_employee_beneficiary_seed s
JOIN public.hr_employees e ON e.id = s.employee_id
JOIN public.beneficiary_master b ON b.id = e.beneficiary_id
ORDER BY e.employee_code;

SELECT employee_category, department,
       count(*) AS employee_count,
       count(beneficiary_id) AS linked_count,
       count(*) FILTER (WHERE beneficiary_id IS NULL) AS unlinked_count
FROM public.hr_employees
GROUP BY employee_category, department ORDER BY department, employee_category;
COMMIT;
