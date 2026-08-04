# S.N. Polymers Pvt. Ltd. — E2E Testing & Data Entry Guide

This guide describes how to manually seed, enter data, and test the **Integrated Digital Business Platform (IDBP)** end-to-end (E2E) in local development. 

---

## 1. Local Setup & Credentials

To test the application locally, start both the backend and frontend servers:
* **Backend:** Runs on `http://localhost:5000` (from `backend/` run `npm run dev`)
* **Frontend:** Runs on `http://localhost:5173` (from `frontend/` run `npm run dev`)

### 🔑 Developer OTP Bypass
Setting up the Telegram Bot OTP is not required in local development. If the backend is running with `NODE_ENV` not set to `production`, you can bypass OTP entry using the development passcode:
* **Development OTP Bypass Code:** `123456`

### ⚠️ The Mobile Number Formatting "Gotcha"
The backend normalizes mobile numbers by stripping the leading `+` prefix during login verification (e.g., `+918000000001` becomes `918000000001`). However, the API JWT middleware queries the database without doing this normalization. 

To ensure the login UI, token signature, and API middleware checks all match seamlessly:
> [!IMPORTANT]
> **Database Seed Rule:** Always store whitelisted mobile numbers in the database **without the `+` prefix** but **with the country code** (e.g. `919000000003` instead of `+919000000003` or `9000000003`).

---

## 2. Database Seeding (One-Click Setup)

Copy and paste the following SQL script directly into the **Supabase SQL Editor** to establish the whitelisted test users, project, mappings, and balances.

```sql
-- 1. Clean up existing test records to avoid conflicts
DELETE FROM public.zo_balances WHERE zo_user_id IN ('919000000002', '919000000005');
DELETE FROM public.je_zo_mappings WHERE je_user_id IN ('919000000003');
DELETE FROM public.work_order_mappings WHERE work_order_no = 'WO-KOL-2026-001';
DELETE FROM public.projects_master WHERE work_order_no = 'WO-KOL-2026-001';
DELETE FROM public.authorised_users WHERE mobile_number IN ('919000000001', '919000000002', '919000000003', '919000000004', '919000000005');

-- 2. Insert whitelisted users (storing mobile numbers without the '+' prefix)
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES 
  ('919000000001', 'admin', true, 'Test System Admin'),
  ('919000000002', 'zo', true, 'Test Zonal Officer (ZO-1)'),
  ('919000000005', 'zo', true, 'Test Zonal Officer (ZO-2)'),
  ('919000000003', 'je', true, 'Test Junior Engineer (JE-1)'),
  ('919000000004', 'ho', true, 'Test Head Office (HO)');

-- 3. Set up the JE-to-ZO hierarchy mapping (Note: IDs are mobile numbers)
INSERT INTO public.je_zo_mappings (je_user_id, zo_user_id, is_active, assigned_by)
VALUES 
  ('919000000003', '919000000002', true, '919000000001');

-- 4. Create the Project Master record
INSERT INTO public.projects_master (
  work_order_no, 
  estimate_no, 
  site_details, 
  state, 
  district, 
  zone, 
  department, 
  status, 
  created_by, 
  edited_by, 
  work_order_value, 
  earnest_money_deposit,
  zo_user_id
) VALUES (
  'WO-KOL-2026-001',
  'EST-KOL-2026-001',
  'Salt Lake Sector V, PWD Site, Kolkata',
  'West Bengal',
  'Kolkata',
  'Kolkata Zone',
  'PWD',
  'Running',
  '919000000001',
  '919000000001',
  500000.00,
  10000.00,
  '919000000002'
);

-- 5. Map the JE to the Work Order
INSERT INTO public.work_order_mappings (
  work_order_no, 
  je_user_id, 
  is_active, 
  assigned_by
) VALUES (
  'WO-KOL-2026-001',
  '919000000003',
  true,
  '919000000001'
);

-- 6. Initialize Zonal Credit balances
INSERT INTO public.zo_balances (zo_user_id, available_balance)
VALUES 
  ('919000000002', 0.00),
  ('919000000005', 0.00);
```

---

## 3. Step-by-Step E2E Test Workflow

### Scenario 1: Cost Estimation & Technical Audit (JE ➔ ZO ➔ HO)
*Goal: Create a cost estimate, approve it at the zonal level, and finalize it at the head office to set the project's material budgets.*

1. **Log in as Junior Engineer (JE):**
   * Mobile: `9000000003` (strips to `919000000003` during form entry).
   * OTP: `123456`
2. **Draft the Estimate:**
   * Go to **Projects** ➔ **Cost Estimates** ➔ Click **New Sheet**.
   * Select Work Order: `WO-KOL-2026-001`. Notice that the geographic fields (West Bengal, Kolkata, PWD) auto-populate.
   * Write JE Remarks: *Initial estimate for pipe-laying work.*
   * Add line items:
     * **Item 1:** Material ➔ PVC ➔ Standard PVC Pipe (Pipes) | Qty: `500` | Rate: `400` | Ref: *CSR 2026 Pg. 14* | Amount: `₹2,00,000.00`
     * **Item 2:** Material ➔ PPC ➔ Standard PPC Cement (Cement) | Qty: `200` | Rate: `450` | Ref: *CSR 2026 Pg. 2* | Amount: `₹90,000.00`
     * **Item 3:** Material ➔ Fine ➔ Fine River Sand (Sand) | Qty: `150` | Rate: `60` | Ref: *Local rate* | Amount: `₹9,000.00`
     * **Total Draft Amount:** `₹2,99,000.00`
   * Click **Submit Estimate**.
3. **Log in as Zonal Officer (ZO):**
   * Mobile: `9000000002` ➔ OTP: `123456`.
   * Go to **Projects** ➔ **Cost Estimates**.
   * Locate the estimate labeled **Under ZO Review**. Click **Verify/Review**.
   * Check all 3 rows. Select **Approve** and add a remark for each row (e.g., *Approved as per CSR*).
   * Click **Submit ZO Review** at the bottom of the page.
4. **Log in as Head Office (HO):**
   * Mobile: `9000000004` ➔ OTP: `123456`.
   * Go to **Projects** ➔ **Cost Estimates**.
   * Locate the estimate labeled **Under HO Review**. Click **Verify/Review**.
   * Approve all 3 rows.
   * Write HO Remarks: *Technical audit complete. Approved for construction.*
   * Click **Submit HO Review**.
   * **Verification:** The estimate status changes to **Final Approved** (Green). The project now has an authorized material budget of `₹2,99,000.00`.

---

### Scenario 2: Fund Allocation & Zonal Credit Control (ZO ➔ HO)
*Goal: ZO requests capital allocation for the project, and HO approves and releases the funds to the Zonal Balance.*

1. **Log in as Zonal Officer (ZO):**
   * Mobile: `9000000002` ➔ OTP: `123456`.
   * Go to **Finance** ➔ **Fund Requests** ➔ Click **New Request**.
   * Select Work Order: `WO-KOL-2026-001`.
   * Request Number: `FR-KOL-001`
   * Requested Amount: `150000` (₹1,50,000.00)
   * ZO Remarks: *Funding required for advance supplier payments.*
   * Click **Submit Request**.
2. **Log in as Head Office (HO):**
   * Mobile: `9000000004` ➔ OTP: `123456`.
   * Go to **Finance** ➔ **Fund Requests** ➔ Select the pending request `FR-KOL-001`.
   * Select Funding Account: **CC** (Credit Control).
   * Approved Amount: `150000`
   * HO Remarks: *Approved from CC account.*
   * Click **Approve**.
3. **Verify Zonal Balance:**
   * Log back in as Zonal Officer (ZO) `9000000002`.
   * Navigate to **Finance** ➔ **Zonal Balances** (`/zonal-balances`).
   * **Verification:** The available balance card displays `₹1,50,000.00`, and the Zonal Fund Ledger shows a credit allocation of `₹1,50,000.00` from the CC account.

---

### Scenario 3: Procurement & Requisitions (JE ➔ ZO)
*Goal: Submit a vendor payment invoice as JE, and approve it as ZO, verifying the automatic deduction from the Zonal Balance.*

1. **Log in as Junior Engineer (JE):**
   * Mobile: `9000000003` ➔ OTP: `123456`.
   * Navigate to **Finance** ➔ **Payment Requisitions** ➔ Select project `WO-KOL-2026-001`.
   * Click **Create Requisition** to open the 3-Step Wizard:
     * **Step 1:** Confirm User details. Click **Next**.
     * **Step 2:** Select Work Order `WO-KOL-2026-001`. Review the active budget limits. Click **Next**.
     * **Step 3:** Fill in invoice details:
       * Requisition No: `REQ-KOL-PVC-01` (No spaces allowed).
       * Material Main Head: `Pipes` (Matches the approved estimate category).
       * Requisition Amount: `80000` (₹80,000.00).
       * GST Included: **No**
       * Upload Invoice: Select a **genuine PDF file** (e.g., a dummy PDF. Re-naming a `.txt` or `.png` to `.pdf` will trigger a server-side MIME type check error).
       * Bank Details: *HDFC Bank, Sector V, A/c: 501002345618, IFSC: HDFC0001203*
       * Remarks: *PVC Pipe supplier invoice.*
     * Click **Submit Requisition**.
2. **Log in as Zonal Officer (ZO):**
   * Mobile: `9000000002` ➔ OTP: `123456`.
   * Go to **Finance** ➔ **Payment Requisitions** ➔ Select the project folder.
   * Click on the pending requisition `REQ-KOL-PVC-01` to open the Action Panel.
   * Write ZO Remarks: *Invoice verified against site delivery.*
   * Click **Approve**.
3. **Verify Zonal Balance Deduction:**
   * Go to **Finance** ➔ **Zonal Balances** (`/zonal-balances`).
   * **Verification:** The available zonal balance has decreased from `₹1,50,000.00` to `₹70,000.00` (₹1,50,000 - ₹80,000). The ledger registers a debit entry of `₹80,000.00` mapped to `REQ-KOL-PVC-01`.

---

### Scenario 4: Daily Site Progress & Streaks (JE ➔ ZO)
*Goal: Log site completion percentage with photo proof, test back-dated restrictions, and increment the JE streak.*

1. **Log Site Progress (JE):**
   * Log in as JE `9000000003` ➔ OTP: `123456`.
   * Navigate to **Projects** ➔ **Daily Progress** ➔ Select project `WO-KOL-2026-001`.
   * Click **Log Progress Entry**.
   * site_visit_date: Select today's date.
   * Physical Work Progress (%): `15` (15.00%).
   * Progress Details: *Excavated trench and laid the initial 75 meters of PVC pipes.*
   * Upload Photo: Attach a `.jpg`, `.jpeg`, or `.png` site photo (must be under 10 MB).
   * Click **Log Progress**.
2. **Test Back-Dated Restriction (JE):**
   * Click **Log Progress Entry** again.
   * site_visit_date: Select yesterday's date.
   * Leave the **Remarks** field empty.
   * Click **Log Progress**.
   * **Verification:** The system blocks submission, displaying a validation error: *Remarks are required for back-dated daily progress reports.*
3. **Approve Progress & Verify Streak (ZO ➔ JE):**
   * Log in as ZO `9000000002` ➔ OTP: `123456`.
   * Navigate to **Projects** ➔ **Daily Progress**.
   * Locate the JE entry. Select **Approve** and write: *Site work verified. Progress matches layout.*
   * Log back in as JE `9000000003` and visit **Overview** ➔ **Profile** (or the **JE Leaderboard**).
   * **Verification:** The JE's active reporting streak has incremented to `1`.

---

### Scenario 5: Running Account (RA) Billing & Immutability (ZO)
*Goal: Enter a contractor bill, complete the live-match validation, and verify database constraints.*

1. **Log in as Zonal Officer (ZO):**
   * Mobile: `9000000002` ➔ OTP: `123456`.
   * Navigate to **Finance** ➔ **RA Bills** ➔ Select project `WO-KOL-2026-001` ➔ Click **Create Bill**.
2. **Test Live-Match Validation:**
   * Select Payment Type: `RA Bill 1`.
   * Bill Date: Select today's date.
   * Bill No: `BILL-KOL-RA-01`
   * Gross Bill Amount: `120000` (₹1,20,000.00).
   * Enter the following breakdown fields:
     * Agency Payment: `96000`
     * Security Deposit Amount: `6000`
     * IT TDS: `2400`
     * SGST: `7200`
     * CGST: `7200`
     * SD: `1200`
     * Leave *Special Security Amount* and *Other Retention* as `0`.
   * **Verification:** Observe the validation banner at the bottom. Since `96000 + 6000 + 2400 + 7200 + 7200 + 1200 = 120000`, the banner glows **Green (Matched)**, enabling the submission button.
   * Upload Bill Copy: Attach a scanned PDF or image copy.
   * Click **Submit Bill**.
3. **Test Sequential Billing Constraint:**
   * Click **Create Bill** again.
   * Select Payment Type: `RA Bill 3`.
   * Fill out the fields and attempt to submit.
   * **Verification:** The system blocks submission and displays: *RA Bill 2 must be entered before RA Bill 3 can be accepted.*
4. **Test Billing Immutability:**
   * Try to edit or delete the submitted `RA Bill 1` from the Database/API.
   * **Verification:** The database triggers block any updates or deletes, throwing a database constraint error. Bills are permanently locked for compliance.

---

### Scenario 6: Excess Fund Return (HO ➔ ZO)
*Goal: Recall excess funds back to HO, and process the return breakdown at the zonal level.*

1. **Request Return (HO):**
   * Log in as HO `9000000004` ➔ OTP: `123456`.
   * Navigate to **Finance** ➔ **Excess Fund Returns** ➔ Click **Request Excess Return**.
   * Target ZO: `Test Zonal Officer (ZO-1)` (`919000000002`)
   * Requested Return Amount: `30000` (₹30,000.00).
   * HO Remarks: *Recalling surplus project balances.*
   * Click **Send Return Request**. The status becomes `Requested`.
2. **Process Return (ZO):**
   * Log in as ZO `9000000002` ➔ OTP: `123456`.
   * Go to **Finance** ➔ **Excess Fund Returns** ➔ Select the pending request.
   * Click **Action / Process Return** in the drawer.
   * **Work Order Breakdown:** Add row: Select `WO-KOL-2026-001` and enter amount `30000`.
   * Click **Accept Return**.
3. **Verify Zonal Balance Deduction:**
   * Go to **Finance** ➔ **Zonal Balances** (`/zonal-balances`).
   * **Verification:** The available zonal balance has decreased from `₹70,000.00` to `₹40,000.00` (₹70,000 - ₹30,000). The return has been logged in the audit ledger.

---

## 4. Troubleshooting & Manual Refresh

### 🔄 Updating Dashboard Analytics Instantly
The project dashboards, charts (such as S-curves), and KPI metrics rely on PostgreSQL Materialized Views (`project_health_mv`, `approval_sla_mv`, etc.). In local development, if you notice dashboard numbers or charts are out-of-sync after entering new progress reports or estimates, you can trigger a manual view refresh:

* **Trigger via UI:** Navigate to **Finance ➔ Zonal Balances** and click the **Refresh & Sync Balances** button in the upper right.
* **Trigger via Database RPC:** Run the following SQL query in the Supabase SQL editor:
  ```sql
  SELECT refresh_analytics_views();
  ```
