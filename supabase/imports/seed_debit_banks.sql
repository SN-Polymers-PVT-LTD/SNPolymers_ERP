-- ============================================================================
-- Seed Debit Banks / Bank Balance Master (CANARA SNP accounts)
-- Seeding Phone: +919883321834 (Admin)
-- Safe and idempotent: uses ON CONFLICT (bank_name) DO UPDATE.
-- Target: public.bank_balance_master
-- ============================================================================

BEGIN;

-- 1. Ensure admin user exists in authorised_users
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES ('+919883321834', 'admin', true, 'System Admin')
ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true;

-- 2. Insert debit bank accounts into bank_balance_master
INSERT INTO public.bank_balance_master (
    bank_name,
    balance_date,
    available_balance,
    account_number,
    is_virtual,
    created_by,
    updated_by
) VALUES
  ('SNP CANARA CC', CURRENT_DATE, 10000000.00, '120000100001', false, '+919883321834', '+919883321834'),
  ('SNP CANARA CA', CURRENT_DATE, 10000000.00, '120000100002', false, '+919883321834', '+919883321834'),
  ('SNP CANARA ESPO', CURRENT_DATE, 5000000.00, '120000100003', false, '+919883321834', '+919883321834'),
  ('CANARA SNP CA', CURRENT_DATE, 10000000.00, '120000100004', false, '+919883321834', '+919883321834'),
  ('CANARA SNP CC', CURRENT_DATE, 10000000.00, '120000100005', false, '+919883321834', '+919883321834'),
  ('CANARA Esenco Fab CA', CURRENT_DATE, 5000000.00, '120000100006', false, '+919883321834', '+919883321834')
ON CONFLICT (bank_name) DO UPDATE SET
  balance_date = EXCLUDED.balance_date,
  available_balance = EXCLUDED.available_balance,
  account_number = COALESCE(EXCLUDED.account_number, bank_balance_master.account_number),
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

COMMIT;
