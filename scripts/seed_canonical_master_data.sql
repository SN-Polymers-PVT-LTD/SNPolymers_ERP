-- ============================================================================
-- Seed Canonical Master Data (Banks & Account Sub-Titles)
-- ============================================================================
-- Seeds baseline lookup data for development/staging environments:
--   1. 31 Canonical Indian Banks in indian_bank_master (026 / 051)
--   2. 118 Canonical Account Sub-Titles in account_sub_title_master (021 / 052)
--
-- Safe to run multiple times (uses ON CONFLICT DO UPDATE).
-- Run this if bank or account sub-title dropdowns are empty after a database wipe.
-- ============================================================================

DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  -- Prefer an active admin user with a telegram_chat_id set
  SELECT mobile_number INTO v_seed_user FROM public.authorised_users
  WHERE role = 'admin' AND telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id) <> ''
  LIMIT 1;

  IF v_seed_user IS NULL THEN
    SELECT mobile_number INTO v_seed_user FROM public.authorised_users WHERE role = 'admin' LIMIT 1;
  END IF;

  IF v_seed_user IS NULL THEN
    INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name, telegram_chat_id)
    VALUES ('919000000003', 'admin', true, 'System Admin Test User', '9988776655')
    ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true
    RETURNING mobile_number INTO v_seed_user;
  END IF;

  IF v_seed_user IS NOT NULL THEN
    -- 1. Canonical Indian Banks in indian_bank_master (026 / 051)
    INSERT INTO "public"."indian_bank_master" (bank_name, is_active, created_by) VALUES
      ('State Bank of India', true, v_seed_user),
      ('Punjab National Bank', true, v_seed_user),
      ('Bank of Baroda', true, v_seed_user),
      ('Canara Bank', true, v_seed_user),
      ('Union Bank of India', true, v_seed_user),
      ('Indian Bank', true, v_seed_user),
      ('Bank of India', true, v_seed_user),
      ('Central Bank of India', true, v_seed_user),
      ('Indian Overseas Bank', true, v_seed_user),
      ('UCO Bank', true, v_seed_user),
      ('Bank of Maharashtra', true, v_seed_user),
      ('Punjab & Sind Bank', true, v_seed_user),
      ('HDFC Bank', true, v_seed_user),
      ('ICICI Bank', true, v_seed_user),
      ('Axis Bank', true, v_seed_user),
      ('Kotak Mahindra Bank', true, v_seed_user),
      ('IndusInd Bank', true, v_seed_user),
      ('Yes Bank', true, v_seed_user),
      ('IDFC FIRST Bank', true, v_seed_user),
      ('Federal Bank', true, v_seed_user),
      ('South Indian Bank', true, v_seed_user),
      ('Karnataka Bank', true, v_seed_user),
      ('Karur Vysya Bank', true, v_seed_user),
      ('City Union Bank', true, v_seed_user),
      ('Tamilnad Mercantile Bank', true, v_seed_user),
      ('DCB Bank', true, v_seed_user),
      ('RBL Bank', true, v_seed_user),
      ('CSB Bank', true, v_seed_user),
      ('Bandhan Bank', true, v_seed_user),
      ('Jammu & Kashmir Bank', true, v_seed_user),
      ('Nainital Bank', true, v_seed_user)
    ON CONFLICT (bank_name) DO UPDATE SET created_by = v_seed_user, is_active = true;

    -- 2. Canonical Account Sub-Titles in account_sub_title_master (021 / 052)
    -- Required for Accounts Requisition Sheets and Payment Requisition routing
    INSERT INTO "public"."account_sub_title_master" (title, is_active, created_by) VALUES
      ('Accurate Measurement Charges', true, v_seed_user),
      ('Advertisement Expenses', true, v_seed_user),
      ('AMC Charges', true, v_seed_user),
      ('Audit Fees', true, v_seed_user),
      ('Bank Charges', true, v_seed_user),
      ('BIS License Fees', true, v_seed_user),
      ('Bonus - Casual Workers', true, v_seed_user),
      ('Bonus - Staff', true, v_seed_user),
      ('Calibration Charges', true, v_seed_user),
      ('Car Hire Charges', true, v_seed_user),
      ('Carriage Charges', true, v_seed_user),
      ('Casual Staff Wages (Project)', true, v_seed_user),
      ('Commission Paid', true, v_seed_user),
      ('Compensation Charges', true, v_seed_user),
      ('Computer Accessories', true, v_seed_user),
      ('Consultancy Charges', true, v_seed_user),
      ('Contract Labour Wages', true, v_seed_user),
      ('Contractor Payment', true, v_seed_user),
      ('Convenience Charges', true, v_seed_user),
      ('Courier Charges', true, v_seed_user),
      ('Daily Wages', true, v_seed_user),
      ('Discount Allowed', true, v_seed_user),
      ('Discounting Charges', true, v_seed_user),
      ('Donation & Subscription', true, v_seed_user),
      ('Driver Salary', true, v_seed_user),
      ('Electricity Bill', true, v_seed_user),
      ('EPF Contribution', true, v_seed_user),
      ('Equipment Rental', true, v_seed_user),
      ('Ex-Gratia', true, v_seed_user),
      ('Extra Wages', true, v_seed_user),
      ('Factory Labour Wages', true, v_seed_user),
      ('Factory Staff Wages', true, v_seed_user),
      ('Flat Maintenance', true, v_seed_user),
      ('Food & Accommodation', true, v_seed_user),
      ('Fooding Charges', true, v_seed_user),
      ('Freight Charges', true, v_seed_user),
      ('Fuel Expenses', true, v_seed_user),
      ('General Office Expenses', true, v_seed_user),
      ('Gift & Greetings', true, v_seed_user),
      ('Godown Rent', true, v_seed_user),
      ('GST Paid', true, v_seed_user),
      ('GST Payment', true, v_seed_user),
      ('Guest Entertainment Charges', true, v_seed_user),
      ('Hire Charges', true, v_seed_user),
      ('Hotel Charges', true, v_seed_user),
      ('House Rent', true, v_seed_user),
      ('Housekeeping Charges', true, v_seed_user),
      ('Inspection Fees', true, v_seed_user),
      ('Insurance Charges', true, v_seed_user),
      ('Interest - Bank CC Account', true, v_seed_user),
      ('Interest - EPF', true, v_seed_user),
      ('Interest - GST', true, v_seed_user),
      ('Interest - Term Loan', true, v_seed_user),
      ('Interest - Vehicle Loan', true, v_seed_user),
      ('Interest Paid', true, v_seed_user),
      ('Internet & Telephone Bill', true, v_seed_user),
      ('Internet Charges', true, v_seed_user),
      ('Labour Cess', true, v_seed_user),
      ('Labour Charges', true, v_seed_user),
      ('Labour Payment', true, v_seed_user),
      ('Land Tax', true, v_seed_user),
      ('Late Fee - GST', true, v_seed_user),
      ('LC Inland Charges', true, v_seed_user),
      ('Legal Expenses', true, v_seed_user),
      ('Licence Fees', true, v_seed_user),
      ('Loading & Unloading Charges', true, v_seed_user),
      ('Machinery Hire Charges', true, v_seed_user),
      ('Material Purchase', true, v_seed_user),
      ('Medical Expenses', true, v_seed_user),
      ('Medicine Expenses', true, v_seed_user),
      ('Mess Expenses', true, v_seed_user),
      ('Miscellaneous Expenses', true, v_seed_user),
      ('Miscellaneous Purchase', true, v_seed_user),
      ('NSIC Charges', true, v_seed_user),
      ('Office Expenses', true, v_seed_user),
      ('Office Maintenance', true, v_seed_user),
      ('Office Staff Salary', true, v_seed_user),
      ('Overtime Wages', true, v_seed_user),
      ('Packing Charges', true, v_seed_user),
      ('Parking Fees', true, v_seed_user),
      ('Penalty - EPF', true, v_seed_user),
      ('Postage & Stamp', true, v_seed_user),
      ('Printing & Stationery', true, v_seed_user),
      ('Production Labour Charges', true, v_seed_user),
      ('Professional Fees', true, v_seed_user),
      ('Project Advance', true, v_seed_user),
      ('Project Expense', true, v_seed_user),
      ('Rate Difference', true, v_seed_user),
      ('Repair & Maintenance', true, v_seed_user),
      ('Road Tax', true, v_seed_user),
      ('Room Rent', true, v_seed_user),
      ('Round Off', true, v_seed_user),
      ('Salary/Wages', true, v_seed_user),
      ('Sales Promotion', true, v_seed_user),
      ('Security Deposit', true, v_seed_user),
      ('Security Service Charges', true, v_seed_user),
      ('Security Staff Salary', true, v_seed_user),
      ('Service Charges', true, v_seed_user),
      ('Site Expenses', true, v_seed_user),
      ('Software Renewal', true, v_seed_user),
      ('Staff Fooding Allowance', true, v_seed_user),
      ('Staff Welfare', true, v_seed_user),
      ('TDS Payment', true, v_seed_user),
      ('Telephone Charges', true, v_seed_user),
      ('Tender Dropping Charges', true, v_seed_user),
      ('Tender Fees', true, v_seed_user),
      ('Tender Paper Purchase', true, v_seed_user),
      ('Testing Charges', true, v_seed_user),
      ('Toll Tax', true, v_seed_user),
      ('Trade Licence Fees', true, v_seed_user),
      ('Transport Charges', true, v_seed_user),
      ('Travel & Conveyance', true, v_seed_user),
      ('Travelling & Conveyance', true, v_seed_user),
      ('Travelling Expenses', true, v_seed_user),
      ('Vehicle Repair Charges', true, v_seed_user),
      ('Vendor Payment', true, v_seed_user),
      ('Wages - Casual Workers', true, v_seed_user),
      ('Water Bill', true, v_seed_user)
    ON CONFLICT (title) DO UPDATE SET created_by = v_seed_user, is_active = true;
  ELSE
    RAISE NOTICE 'Master data reseed skipped: no admin user found in authorised_users.';
  END IF;
END $$;
