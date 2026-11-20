# Supabase Import-Ready Files

This directory contains database-import ready files prepared from official Excel masters and mock seed data:
1. `Material_Master_FINAL_FILE.xlsx` (2,063 unique items)
2. `Sub_Contractor_Master_Final.xlsx` (106 unique subcontract work heads)
3. Mock Beneficiary Directory (30 vendors/subcontractors with verified Indian banks)
4. Debit Bank Balance Master (SNP Canara CC, CA, ESPO accounts)

All files use the designated admin account: `+919883321834`.

---

## File Manifest

| File | Target Table | Description |
|---|---|---|
| `material_master_import_ready.csv` | `public.material_master` | 2,063 unique materials, trimmed, formatted with exact DB column headers. |
| `material_master_all_2081_rows.csv` | `public.material_master` | All 2,081 materials (including 18 exact duplicate rows from source Excel). |
| `subcontract_work_master_import_ready.csv` | `public.subcontract_work_master` | 106 subcontract work items with exact DB column headers. |
| `beneficiary_master.csv` | `public.beneficiary_master` | 30 mock vendors with `account_number, ifsc` for Accounts department. |
| `projects_beneficiary_master.csv` | `public.projects_beneficiary_master` | 30 mock vendors with `beneficiary_ac_no, beneficiary_ifsc` for Projects. |
| `bank_balance_master_import_ready.csv` | `public.bank_balance_master` | Debit bank accounts (`SNP CANARA CC`, `SNP CANARA CA`, `SNP CANARA ESPO`, etc.). |
| `seed_material_master.sql` | `public.material_master` | Idempotent transaction script for Supabase SQL Editor. Safe to run multiple times. |
| `seed_subcontract_work_master.sql` | `public.subcontract_work_master` | Idempotent upsert script for Supabase SQL Editor. Safe to run multiple times. |
| `seed_beneficiaries.sql` | `beneficiary_master` & `projects_beneficiary_master` | Idempotent SQL script seeding both beneficiary tables and resolving bank UUIDs. |
| `seed_debit_banks.sql` | `public.bank_balance_master` | Idempotent upsert script seeding all Canara debit accounts with initial balance. |

---

## How to Import

### Method 1: Supabase SQL Editor (Recommended)
This is the fastest, safest, and 100% idempotent method:
1. Open your Supabase Project Dashboard (Dev or Prod).
2. Click **SQL Editor** in the left sidebar.
3. Run any of the seed scripts:
   - `seed_material_master.sql`
   - `seed_subcontract_work_master.sql`
   - `seed_beneficiaries.sql`
   - `seed_debit_banks.sql`

### Method 2: Supabase Table Editor (CSV Upload)
1. Open your Supabase Project Dashboard.
2. Click **Table Editor** in the left sidebar.
3. Select the desired table (`material_master`, `subcontract_work_master`, `beneficiary_master`, `projects_beneficiary_master`, or `bank_balance_master`).
4. Click **Insert** -> **Import data from CSV** and pick the corresponding CSV file.
5. Column headers match 1:1 with the DB schema so you can proceed directly.
