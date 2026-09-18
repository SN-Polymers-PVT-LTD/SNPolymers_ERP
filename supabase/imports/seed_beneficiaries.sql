-- ============================================================================
-- Seed Mock Beneficiaries (30 Vendors / Subcontractors / Suppliers)
-- Seeding Phone: +919883321834 (Admin)
-- Safe and idempotent: can be run repeatedly without duplicating rows.
-- Populates both Accounts (beneficiary_master) and Projects (projects_beneficiary_master).
-- Automatically links canonical beneficiary_bank_id from indian_bank_master.
-- ============================================================================

BEGIN;

-- 1. Ensure admin user exists in authorised_users
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES ('+919883321834', 'admin', true, 'System Admin')
ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true;

-- 2. Temporary staging table
CREATE TEMP TABLE tmp_mock_beneficiaries (
    beneficiary_name varchar NOT NULL,
    account_number varchar NOT NULL,
    ifsc varchar NOT NULL,
    bank_name varchar NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_mock_beneficiaries (beneficiary_name, account_number, ifsc, bank_name) VALUES
  ('M/S Maa Tara Enterprise', '30124567890', 'SBIN0001234', 'State Bank of India'),
  ('Biswakarma Engineering Works', '0123002100045678', 'PUNB0012300', 'Punjab National Bank'),
  ('Sharma Roadways & Transport', '50200012345678', 'HDFC0000123', 'HDFC Bank'),
  ('Ghosh & Sons Construction', '001105001234', 'ICIC0000011', 'ICICI Bank'),
  ('Roy Electricals & Electronics', '912020034567891', 'UTIB0000456', 'Axis Bank'),
  ('Bhowmick Enterprise', '20450110023456', 'BARB0KOLKAT', 'Bank of Baroda'),
  ('Swastik Steel Traders', '03561010004567', 'CNRB0000356', 'Canara Bank'),
  ('Dutta & Co. Earthmovers', '520101234567890', 'UBIN0552011', 'Union Bank of India'),
  ('Paul Plumbing Solutions', '60123456789', 'IDIB000C123', 'Indian Bank'),
  ('M/S Annapurna Agency', '40120100001234', 'BKID0004012', 'Bank of India'),
  ('National Hardware Mart', '10230110005678', 'CBIN0281023', 'Central Bank of India'),
  ('Banerjee Earthmovers', '01560100002345', 'IOBA0000156', 'Indian Overseas Bank'),
  ('Das Power Systems & DG Rental', '01980200001234', 'UCBA0000198', 'UCO Bank'),
  ('Krishna Logistics Fleet', '60012345678', 'MAHB0000600', 'Bank of Maharashtra'),
  ('Chakraborty Buildcon Pvt Ltd', '05670100001234', 'PSIB0000567', 'Punjab & Sind Bank'),
  ('Sen Survey & Soil Investigation', '2512345678', 'KKBK0000251', 'Kotak Mahindra Bank'),
  ('Maji Welding & Fabrication', '100023456789', 'INDB0000012', 'IndusInd Bank'),
  ('Haldar Brothers Masonry', '00019010001234', 'YESB0000001', 'Yes Bank'),
  ('New Bharat Transport Agency', '10012345678', 'IDFB0040101', 'IDFC FIRST Bank'),
  ('Tarafdar HDPE Pipeline Works', '12340100005678', 'FDRL0001234', 'Federal Bank'),
  ('Mukherjee Industrial Valves & Fitting', '0456053000012345', 'SIBL0000456', 'South Indian Bank'),
  ('Mandal Manpower & Labour Supply', '12000100003456', 'KARB0000120', 'Karnataka Bank'),
  ('Apex Polytech Traders', '1156135000001234', 'KVBL0001156', 'Karur Vysya Bank'),
  ('Modern Borewell Services', '00100100004567', 'CIUB0000001', 'City Union Bank'),
  ('Kolkata Sanitary & Fitting Mart', '01230100005678', 'TMBL0000012', 'Tamilnad Mercantile Bank'),
  ('Eastern Heavy Crane Rental', '00120100002345', 'DCBL0000001', 'DCB Bank'),
  ('Jain Pipe Fitting Agency', '409000123456', 'RATN0000123', 'RBL Bank'),
  ('S.K. Masonry & Plastering Works', '00150100001234', 'CSBK0000015', 'CSB Bank'),
  ('Saha Brother Logistics', '10120000234567', 'BDBL0001012', 'Bandhan Bank'),
  ('Universal Valve & Pipe Fitting Mart', '0123040100001234', 'JAKA0CALCUT', 'Jammu & Kashmir Bank');

-- 3. Insert into Accounts beneficiary_master
INSERT INTO public.beneficiary_master (
    beneficiary_name,
    account_number,
    ifsc,
    beneficiary_bank_name,
    beneficiary_bank_id,
    created_by
)
SELECT
    t.beneficiary_name,
    t.account_number,
    t.ifsc,
    t.bank_name,
    b.id AS beneficiary_bank_id,
    '+919883321834'
FROM tmp_mock_beneficiaries t
LEFT JOIN public.indian_bank_master b ON lower(trim(b.bank_name)) = lower(trim(t.bank_name))
ON CONFLICT (account_number, ifsc) DO UPDATE SET
    beneficiary_name = EXCLUDED.beneficiary_name,
    beneficiary_bank_name = EXCLUDED.beneficiary_bank_name,
    beneficiary_bank_id = COALESCE(EXCLUDED.beneficiary_bank_id, beneficiary_master.beneficiary_bank_id),
    updated_by = EXCLUDED.created_by,
    updated_at = now();

-- 4. Insert into Projects projects_beneficiary_master
INSERT INTO public.projects_beneficiary_master (
    beneficiary_name,
    beneficiary_ac_no,
    beneficiary_ifsc,
    beneficiary_bank_name,
    beneficiary_bank_id,
    created_by
)
SELECT
    t.beneficiary_name,
    t.account_number,
    t.ifsc,
    t.bank_name,
    b.id AS beneficiary_bank_id,
    '+919883321834'
FROM tmp_mock_beneficiaries t
LEFT JOIN public.indian_bank_master b ON lower(trim(b.bank_name)) = lower(trim(t.bank_name))
ON CONFLICT (beneficiary_ac_no, beneficiary_ifsc) DO UPDATE SET
    beneficiary_name = EXCLUDED.beneficiary_name,
    beneficiary_bank_name = EXCLUDED.beneficiary_bank_name,
    beneficiary_bank_id = COALESCE(EXCLUDED.beneficiary_bank_id, projects_beneficiary_master.beneficiary_bank_id),
    updated_by = EXCLUDED.created_by,
    updated_at = now();

COMMIT;
