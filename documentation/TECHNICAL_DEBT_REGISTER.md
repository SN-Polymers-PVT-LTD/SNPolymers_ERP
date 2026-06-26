# Technical Debt Register — SN Polymers IDBP
### As of Phase 4 (Post-Execution Audit) · June 2026

> This document is a **verified, code-confirmed** registry of all outstanding technical debt.
> Every item was cross-checked against the current source files — not just copied from prior plans.
> Items are marked `✅ FIXED`, `⚠️ PARTIAL`, or `❌ OPEN` based on actual code state.

---

## Summary Scoreboard

| Severity | Total Issues | Fixed | Partial | Still Open |
|---|:---:|:---:|:---:|:---:|
| **CRITICAL** | 1 | 1 | 0 | 0 |
| **HIGH** | 5 | 3 | 1 | 1 |
| **MEDIUM** | 8 | 4 | 1 | 3 |
| **LOW / INFO** | 8 | 3 | 1 | 4 |
| **TOTAL** | **22** | **11** | **3** | **8** |

> **8 issues remain open. 3 are partially resolved.**

---

## ❌ OPEN Issues (Action Required)

---

### TD-01 — Stack traces lost in older controllers' catch blocks
- **Severity:** LOW → cumulative HIGH impact in production debugging
- **Origin:** Phase 2 (identified as CQ-12 in Phase 3 plan)
- **Status:** ❌ OPEN — **partially migrated**
- **Verified location:** Multiple files
- **What's fixed:** `auth.controller.js` and `reports.controller.js` use the new `logError()` utility (which logs the full stack in dev, message-only in production).
- **What's still broken:**
  - `estimates.core.controller.js` — L82, L172, L274, L306 — raw `console.error(... error.message)` (stack trace dropped)
  - `estimates.workflow.controller.js` — L140, L266, L374, L531, L600, L731 — raw `console.error(... error.message)` (stack trace dropped)
  - `admin.controller.js` — L18, L73, L123, L206, L293 — raw `console.error(... error.message)`
  - `fundRequests.controller.js` — L88, L172, L225, L323, L388 — raw `console.error(... error.message)`
  - `materials.controller.js`, `purchaseData.controller.js`, `masterData.controller.js`, `projects.controller.js` — all use raw `console.error`
  - `telegram.service.js` — notification errors log only message, no stack
- **Fix:** Replace all `console.error(\`${fn} failed: ${error.message}\`)` calls with `logError(fn, error)` from `utils/logger.js`. Logger already exists and is correct — it just hasn't been adopted everywhere.

---

### TD-02 — OTP attempt counter is non-atomic (concurrent bypass risk)
- **Severity:** MEDIUM
- **Origin:** Phase 1 (identified as CQ-9 in Phase 3 plan)
- **Status:** ⚠️ PARTIAL — optimistic lock added but not a true atomic fix
- **Verified location:** `backend/src/services/otp.service.js` L90–95
- **Current code:**
  ```javascript
  await supabase
    .from('otp_requests')
    .update({ attempts: otpRequest.attempts + 1 })
    .eq('id', otpRequest.id)
    .eq('attempts', otpRequest.attempts)  // Optimistic lock
  ```
- **Issue:** An optimistic lock is an improvement over a bare read-modify-write, but it silently swallows the conflict — if two concurrent requests race, one will silently fail to increment. The check `attemptsLeft: 2 - otpRequest.attempts` can also return a stale value to the client.
- **Proper fix:** Use a PostgreSQL atomic increment via an RPC:
  ```sql
  UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts;
  ```
  This guarantees the count is always accurate regardless of concurrency.

---

### TD-03 — `admin.controller.js` removeUser does not check `daily_progress_reports` FK
- **Severity:** MEDIUM
- **Origin:** Phase 5 (new — `daily_progress_reports.created_by` references `authorised_users.mobile_number`)
- **Status:** ❌ OPEN — will arise when Phase 5 migration is applied
- **Verified location:** `backend/src/controllers/admin.controller.js` L132–209
- **What's done:** Phase 4 added checks for `project_cost_estimates`, `fund_requests`, and `requisitions`. ✅
- **What's missing:** When migration `21_create_daily_progress_reports` is applied, the `created_by` and `approved_user_id` columns will reference `authorised_users(mobile_number)`. Hard-deleting a user who has submitted daily progress reports will either fail with a FK constraint violation from the DB, or succeed and orphan authority remark records. Either is bad.
- **Fix:** Add a check in `removeUser` for `daily_progress_reports` (by `created_by`) before allowing hard delete.

---

### TD-04 — `estimates.core.controller.js` & `estimates.workflow.controller.js` do not use `logError`
- **Severity:** LOW
- **Origin:** Phase 2 (identified as CQ-12)
- **Status:** ❌ OPEN
- **Note:** This is the same root issue as TD-01 but specifically called out for the two estimate controllers because they have the highest code volume and the most complex error scenarios — making stack trace loss most costly here.
- **Files:** `estimates.core.controller.js`, `estimates.workflow.controller.js`

---

### TD-05 — `refreshTokens` function duplicates JWT_SECRET resolution
- **Severity:** MEDIUM
- **Origin:** Phase 1 refactoring (new — not in any prior plan)
- **Status:** ❌ OPEN
- **Verified location:** `backend/src/controllers/auth.controller.js` L252
  ```javascript
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
  ```
- **Issue:** `JWT_SECRET` is resolved at module load time in `session.service.js` (L6–9, correctly with a production guard that throws). But inside `refreshTokens` in `auth.controller.js`, it is re-resolved inline without the production safety check — meaning in production, if `JWT_SECRET` is missing, this function will silently fall back to the dev string instead of throwing.
- **Fix:** Remove the inline `JWT_SECRET` constant in `refreshTokens` and import it from `session.service.js`, or export it from a shared config module.

---

### TD-06 — `linkTelegram` endpoint uses `otpRequestLimiter` (mobile-keyed) but chatId is not validated as a real Telegram ID
- **Severity:** MEDIUM
- **Origin:** Phase 1 (new observation — not in any prior plan)
- **Status:** ❌ OPEN
- **Verified location:** `backend/src/routes/auth.routes.js` L12, `backend/src/controllers/auth.controller.js` L79–118
- **Issue 1:** `linkTelegram` allows any string to be stored as `telegram_chat_id`. A numeric range check (Telegram chat IDs are large positive integers, e.g. `123456789`) is missing. A user could link a garbage string, breaking OTP delivery silently.
- **Issue 2:** There is no verification that the supplied `chatId` actually belongs to the supplied `mobileNumber` on Telegram's side — any user knowing another user's mobile number could potentially overwrite their `telegram_chat_id`. The only safeguard is the whitelist check (must be an active whitelisted number). For an internal ERP with known users this is acceptable, but should be documented as a known accepted risk.
- **Fix for Issue 1:** Validate `chatId` is a positive integer string (e.g. `/^\d+$/`) in the Zod schema.

---

### TD-07 — `verifyJwt.js` JWT_SECRET fallback has no production guard at point of use
- **Severity:** MEDIUM
- **Origin:** Phase 1 (CQ-3 from Phase 3 plan — partially fixed)
- **Status:** ⚠️ PARTIAL
- **Verified location:** `backend/src/middleware/verifyJwt.js` L4
  ```javascript
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
  ```
- **What's fixed:** `session.service.js` now has the correct production guard (throws if missing in prod).
- **What's still open:** `verifyJwt.js` itself has its own separate JWT_SECRET resolution at L4 — without a production guard. If `JWT_SECRET` is missing in production, `verifyJwt` silently falls back to the dev key. The `app.js` startup guard (L9–11) would catch this at boot — but only if `NODE_ENV=production` is set correctly. If it's not set (e.g. misconfigured deployment), both guards are bypassed.
- **Fix:** Remove the inline resolution in `verifyJwt.js` and import from `session.service.js` or a shared config module.

---

### TD-08 — Console log of Chat ID linkage leaks PII in server logs
- **Severity:** LOW
- **Origin:** Phase 1 (new observation)
- **Status:** ❌ OPEN
- **Verified location:** `backend/src/controllers/auth.controller.js` L108
  ```javascript
  console.log(`[TELEGRAM] Chat ID ${chatIdStr} linked to ${mobileNumber}`);
  ```
- **Issue:** Both the Telegram Chat ID and the mobile number are logged to stdout in plaintext. In a production environment with log aggregation (e.g. Render logs, Datadog), this creates a PII exposure risk.
- **Fix:** Replace with `logError`-style conditional logging, or remove the mobile number from the log message and keep only a redacted identifier.

---

## ✅ FIXED Issues (Resolved in Prior Phases)

| ID | Issue | Fixed In | Evidence |
|---|---|---|---|
| CQ-1 | Hardcoded `legitMobiles` PII array in estimates controller | Phase 4 M5 | `grep legitMobiles` returns no results ✅ |
| CQ-2 | IP detection used full `x-forwarded-for` chain | Phase 4 M5 | `auth.controller.js` L154: `(req.headers['x-forwarded-for'] \|\| '').split(',')[0].trim()` ✅ |
| CQ-3 | JWT_SECRET plaintext fallback in `session.service.js` with no prod guard | Phase 4 M5 | `session.service.js` L6–9: production guard throws correctly ✅ |
| CQ-5 | `reports.controller.js` amount validated only for `undefined` | Phase 4 M5 | `reports.controller.js` L240–246: full `isNaN`, `isFinite`, `>= 0` check ✅ |
| CQ-6 | `je` with `global=true` bypassed own-record filter in estimates | Phase 4 M5 | `grep "global === 'true'"` returns no results ✅ |
| CQ-7 | `updateUser` persisted any role string without enum validation | Phase 4 M5 | `admin.controller.js` L86–92: `ALLOWED_ROLES` array check on both `addUser` and `updateUser` ✅ |
| CQ-8 | `globalLimiter` 1000 req/min had no explanatory comment | Phase 4 M5 | `rateLimiter.js` L80–86: full intentionality comment added ✅ |
| CQ-9 | OTP attempts counter was bare read-modify-write (no concurrency guard) | Phase 4 M5 | Optimistic lock added (`eq('attempts', otpRequest.attempts)`) — ⚠️ still non-atomic, see TD-02 |
| SEC-1 | `materialsRoutes` mounted on unauthenticated `/api/materials` path | Phase 4 M5 | `app.js`: only one mount at `/api/v1/auth/materials` ✅ |
| SEC-3 | `user_agent` stored without length truncation | Phase 4 M5 | `session.service.js` L53: `String(userAgent).substring(0, 500)` ✅ |
| SEC-4 | `TokenExpiredError` path did not clear the expired cookie | Phase 4 M5 | `verifyJwt.js` L74–76: `res.clearCookie('accessToken', ...)` on token expiry ✅ |
| SEC-5 | `removeUser` hard-deleted without checking FK references | Phase 4 M5 | `admin.controller.js` L143–186: checks estimates, fund_requests, and requisitions ✅ |

---

## ⚠️ PARTIAL Fixes (Resolved in Spirit, Not Completely)

| ID | Issue | Partial Fix | What's Still Missing |
|---|---|---|---|
| TD-02 | Non-atomic OTP attempt counter | Optimistic lock added | True DB-level atomic increment via RPC not implemented |
| TD-07 | JWT_SECRET fallback without prod guard in `verifyJwt.js` | `session.service.js` and `app.js` both have guards | `verifyJwt.js` still has its own inline resolution without a guard |
| CQ-12 | Stack traces lost in catch blocks | `logError()` utility created; adopted in `auth.controller.js` and `reports.controller.js` | Not yet adopted in estimates, admin, fund requests, materials, projects, or telegram service controllers |

---

## New Debt Introduced in Phase 4 (Not Previously Tracked)

| ID | Issue | File | Severity |
|---|---|---|---|
| TD-05 | `refreshTokens` duplicates JWT_SECRET inline without production guard | `auth.controller.js` L252 | MEDIUM |
| TD-06 | `linkTelegram` chatId not validated as a numeric Telegram ID | `auth.controller.js` / `auth.schema.js` | MEDIUM |
| TD-08 | Console.log leaks Telegram Chat ID + mobile number as PII in plaintext | `auth.controller.js` L108 | LOW |

---

## Future Debt to Track for Phase 5

When Phase 5 is executed, these new items will open:

| ID | Issue | File | Severity | Trigger |
|---|---|---|---|---|
| TD-P5-A | `removeUser` does not check `daily_progress_reports.created_by` FK | `admin.controller.js` | MEDIUM | Applied when migration 21 is live |
| TD-P5-B | `daily_progress_reports` `approved_user_id` FK also not checked in `removeUser` | `admin.controller.js` | LOW | Applied when migration 21 is live |

---

## Recommended Resolution Order

| Priority | Item | Why |
|---|---|---|
| 🔴 **Now** | **TD-05** — `refreshTokens` JWT_SECRET inline without prod guard | Silent security bypass in production if misconfigured |
| 🔴 **Now** | **TD-03** — `removeUser` missing `daily_progress_reports` check | Will break or silently corrupt data the moment Phase 5 migration is applied |
| 🟠 **Soon** | **TD-02** — OTP non-atomic increment | Low probability concurrency bug, but auth bypass is catastrophic if it fires |
| 🟠 **Soon** | **TD-07** — `verifyJwt.js` standalone JWT_SECRET | Defence-in-depth gap in the most critical middleware |
| 🟡 **Next sprint** | **TD-06** — `linkTelegram` chatId not validated as integer | Prevents silent OTP delivery failures from garbage chatId values |
| 🟡 **Next sprint** | **TD-01 / TD-04** — Stack traces dropped in 6+ controllers | Production debugging blindness |
| 🟢 **Cleanup** | **TD-08** — PII in console.log | Low risk in internal ERP, but good hygiene |
