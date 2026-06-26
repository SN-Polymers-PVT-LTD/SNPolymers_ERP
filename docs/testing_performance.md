# Part 9: Testing & Performance Optimization
## S.N. Polymers IDBP System Auditing & Performance Tuning

This document outlines validation test scripts, execution commands, indexing strategies, and query performance optimizations.

---

## 1. Testing Framework & Execution

### Validation Testing (Milestones P1 to P5)
A suite of 22 automated tests is located under `backend/tests/milestones/` to validate database logic, OTP verifications, mutability constraints, and workflows.

* **Requisitions test suite**: `test_milestone_p4_m2_m3.js` & `test_milestone_p4_m4.js`
* **Progress reports test suite**: `test_milestone_p5_m1_m2_m3.js` & `test_milestone_p5_m4.js`

### Execution Commands
Run the validation tests from the backend root using the following commands:
```bash
# Run all Phase 5 validation tests
npm run test:p5:all

# Run individual milestone scripts
node tests/milestones/test_milestone_p5_m4.js
```

---

## 2. Performance & Query Optimization

To maintain sub-second page rendering times as transaction tables scale, the database utilizes custom indexes and client-side aggregation.

### 2.1 Database Indexing Strategy
The following indexes are built in the database to speed up query execution:

1. **Composite index on OTP Verification**:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_otp_requests_lookup
     ON otp_requests(mobile_number, is_used)
     INCLUDE (otp_hash, expires_at, attempts);
   ```
   * *Impact*: Avoids full-table scans during OTP verification by covering key index lookups directly.

2. **Partial index on active Fund Requests**:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_fund_requests_status
     ON fund_requests(request_status)
     WHERE request_status = 'Pending';
   ```
   * *Impact*: Accelerates supervisor overview loads by filtering out completed or cancelled requests.

3. **B-tree indexes on Foreign Keys**:
   * B-tree indexes are built on foreign key links (`work_order_no` and `estimate_id`) to optimize database join operations when generating project ledgers.

### 2.2 Client-Side Aggregation
* Rather than calling database aggregation routines (`COUNT`, `SUM`) on the server side on every render, the frontend page pulls raw datasets and performs calculations client-side (e.g., computing total disbursed amounts and counting active projects).
* This minimizes database CPU spikes and reduces response latency.
