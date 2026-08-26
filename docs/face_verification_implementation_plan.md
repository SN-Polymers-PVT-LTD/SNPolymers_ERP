# Continuous Face Verification for Accounts-Module Write Access

## Context

The `accounts` role (write access to bank ledgers, beneficiary master, and NEFT export in `acctRequisition.routes.js`) currently relies only on JWT + role checks. Given the sensitivity of this data (bank account numbers, beneficiary payment details, NEFT export), the goal is to add a second factor scoped strictly to **write operations**: the system must continuously confirm the *authorized accounts user* is physically present, not just that a valid session/token exists. Login, navigation, and all read-only access are untouched — this feature must not alter auth/access behavior anywhere else in the app.

This repo has no existing camera/biometric code (verified via exhaustive grep) — this is a greenfield addition, built on infrastructure that already exists: JWT/session auth (`verifyJwt.js`, `session.service.js`), and a working Telegram-OTP flow (`otp.service.js` + `telegram.service.js`, already used for login) that enrollment will reuse rather than invent a new one.

Also note: `accounts` role and `acctRequisition.*` files exist only on the `accounts-dept` branch (26 commits ahead of the merge-base with the current `face-recognition` branch). **Phase 0 merges `accounts-dept` into `face-recognition` first**, so every path below refers to real, existing files post-merge.

**Design**:
- face-api.js (TF.js-based, pure JS, no native/Python deps) computes a 128-d face embedding client-side. Only the embedding is transmitted — never raw frames.
- Verification runs periodically (every 30s) while an Accounts write view is open, not per-frame — keeps CPU/battery usage low.
- **Grace period is scoped to absence only, not to security events**: if a periodic check finds *no face at all* (temporary absence — user leaned back, glanced away), the backend allows `N` consecutive misses (default 2, ~90s) before locking, since this is the one failure mode that's plausibly transient. A **wrong/unrecognized face**, **multiple faces**, or a **camera error/disconnected/access-denied** report locks the session **immediately, on the first occurrence** — these are treated as security-relevant events, not glitches, and get no grace.
- The backend is the sole authority: a new `requireFaceVerified` middleware (parallel to `requireRole`) enforces staleness/lock state and is applied **only to Accounts write routes**. Accounts read routes remain accessible even when face verification is unavailable or locked.
- Enrollment/re-enrollment is authorized via **Telegram OTP** sent to the user's registered `telegram_chat_id` — reusing the exact `generateOtp`/`storeOtp`/`verifyOtp` (`otp.service.js`) and `sendOtp` (`telegram.service.js`) functions the login flow already uses. The verify step reuses the existing `otpVerifyLimiter`; the request step gets its own dedicated limiter (see Phase 2) since the existing `otpRequestLimiter` keys on a request-body field that doesn't exist on an authenticated route.

---

## Phase 0 — Merge prerequisite branch

**Goal**: get the accounts module onto `face-recognition` so later phases have real files to modify.

- Merge `accounts-dept` into `face-recognition` (fast-forward-style; `face-recognition` sits at the merge-base so no conflicts are expected).
- **Verify**: `npm run test:unit && npm run test:contracts` (backend) pass post-merge; `git ls-tree -r HEAD -- backend/src/routes/acctRequisition.routes.js` resolves.

**Acceptance criteria**: `backend/src/routes/acctRequisition.routes.js`, `frontend/src/pages/AcctBeneficiaryMaster.jsx`, and migrations up to `032_accounts_master_index_cleanup.sql` exist on `face-recognition`; existing CI passes.

---

## Phase 1 — Database: descriptor storage + session verification state

**Goal**: persist enrolled face embeddings and track per-session verification freshness and miss-count, following existing migration conventions exactly.

**Changes** — new migration `backend/src/db/migrations/033_add_face_verification.sql` (next number after `032_...`), following the `021_work_order_activity_breaks.sql` style (numbered comment banners, `CREATE TABLE IF NOT EXISTS`, rationale comments):
- `face_descriptors` table: `id uuid PK default gen_random_uuid()`, `user_id uuid NOT NULL UNIQUE REFERENCES authorised_users(id) ON DELETE CASCADE`, `descriptor float8[] NOT NULL` (128 elements), `enrolled_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`, `consented_at timestamptz NOT NULL`. One row per user — re-enrollment overwrites (upsert), does not append.
- Alter `sessions`: add `last_face_verified_at timestamptz`, `face_locked boolean DEFAULT false`, `face_verification_misses smallint DEFAULT 0`.
- No RLS (project convention — service-role key only; enforcement lives in Express middleware).
- Run via existing runner: `npm run migrate:dev` against local Supabase (`backend/scripts/apply-migrations.js`, idempotent via `_migration_log`).

**Tests** (`backend/tests/vitest/regression/faceVerificationSchema.test.js`, following `acctIndexMigrations.test.js` pattern): table/columns exist; unique constraint on `face_descriptors.user_id` enforced; FK cascade delete on user removal.

**Acceptance criteria**: migration applies cleanly on a fresh local Supabase instance and is a no-op on re-run (`_migration_log` guard).

---

## Phase 2 — Backend: OTP-gated enrollment

**Goal**: let an `accounts`/`admin` user register (or re-register) their face embedding, authorized by a Telegram OTP tied to their own account — reusing the existing OTP machinery wholesale, not reimplementing it.

**Changes**:
- `backend/src/validation/faceVerification.schema.js` — zod schemas: `enrollFaceSchema` (`{ descriptor: z.array(z.number().finite()).length(128, 'Descriptor must be exactly 128 numbers'), otp: z.string() }`). No schema for `request-otp` — see routing note below, it has no body to validate.
- `backend/src/middleware/rateLimiter.js` — add a **new**, dedicated `enrollOtpRequestLimiter` (do not touch the existing `otpRequestLimiter`/`otpVerifyLimiter`, which key on `req.body.mobileNumber || req.ip` for the *public* login route — `req.body` is empty on an authenticated bodyless enroll route, which would silently degrade that limiter to IP-only keying and break office-NAT scenarios):
  ```js
  const enrollOtpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100 : 7,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.mobile_number || req.ip,
    handler: logOtpRequestLimitExceeded
  });
  ```
  Export it alongside the existing limiters. `otpVerifyLimiter` (already keyed defensively) is reused as-is for `/enroll`.
- `backend/src/services/faceVerification.service.js`:
  - `enrollDescriptor(userId, descriptor, consentedAt)` — upsert into `face_descriptors` by `user_id`.
  - `getDescriptor(userId)`, `euclideanDistance(a, b)` (used in Phase 3).
- `backend/src/controllers/faceVerification.controller.js`:
  - `requestEnrollOtp(req, res)` — `verifyJwt` attaches `req.user` but its `authorised_users` select is `'is_active, display_name'` only (confirmed in `verifyJwt.js`) — it does **not** carry `telegram_chat_id`. Fetch it explicitly and minimally:
    ```js
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('telegram_chat_id, mobile_number, is_active')
      .eq('id', req.user.id)
      .maybeSingle();
    ```
    Then `generateOtp()` → `hashOtp()` → `storeOtp(user.mobile_number, hash)` → `sendOtp(user.telegram_chat_id, rawOtp)`, mirroring `requestOtp` in `auth.controller.js:71`. Returns `{ success: true, message: 'OTP sent' }`.
  - `enrollFace(req, res)` — calls `verifyOtp(req.user.mobile_number, req.body.otp)`; on failure returns `400 { success: false, code: 'INVALID_OTP', message }` (reuse existing failure shape/`attemptsLeft`); on success calls `enrollDescriptor(req.user.id, req.body.descriptor, new Date())`. Never trusts a client-supplied user id — identity is always `req.user.id`.
- `backend/src/routes/faceVerification.routes.js` (add `'use strict'` header, matching `activityBreaks.routes.js`'s convention rather than `auth.routes.js`'s):
  ```js
  router.use(verifyJwt);
  router.post('/enroll/request-otp', requireRole(['accounts','admin']), enrollOtpRequestLimiter, requestEnrollOtp);
  router.post('/enroll', requireRole(['accounts','admin']), otpVerifyLimiter, validateRequest(enrollFaceSchema), enrollFace);
  ```
  `request-otp` has no body, so — matching the established convention (`/refresh`, `/logout` in `auth.routes.js` are both bodyless POSTs and neither uses `validateRequest`) — no schema is wired to it.
- Mount in `backend/src/app.js` at **`/api/v1/auth/face-verification`** — every existing route in `app.js` (confirmed by reading it end to end: `authRoutes`, `acctRequisitionRoutes`, `activityBreaksRoutes`, etc.) mounts under `/api/v1/auth/...` with zero exceptions. No alias at a different path — that would break the "everything auth'd lives under one prefix" convention and create an easy-to-miss audit gap.

**Tests** (`backend/tests/vitest/unit/faceVerification.service.test.js`, `backend/tests/vitest/contracts/faceVerification.contract.test.js`):
- Unit: `euclideanDistance` correctness; `enrollDescriptor` upserts (not duplicates).
- Contract: `/enroll/request-otp` sends via `sendOtp` (mocked) only for `accounts`/`admin` roles (403 otherwise); `/enroll` rejects wrong/expired/reused OTP (400 `INVALID_OTP`, matching `verifyOtp`'s existing attempts/expiry rules) and malformed descriptors (400); succeeds end-to-end with a valid OTP and persists to `face_descriptors`.
- **This new contract test file must be added explicitly to the `test:contracts:db` script in `package.json`** — that script is a hardcoded file list (`vitest run tests/vitest/contracts/schemaContract.test.js tests/vitest/contracts/rpcSignature.test.js ...`), not a directory glob, so a new file is silently skipped in CI unless added.
- Add `enrollOtpSuccessSchema`/`enrollFaceSuccessSchema` entries to `tests/helpers/responseSchemas.js` for contract-shape validation, following its existing pattern.
- Test fixtures need a seeded `accounts`-role user **with `telegram_chat_id` set** — neither `setupUsers.js` nor `acctRequisitionFixture.js` currently sets it (confirmed by reading both). Extend `setupUsers` to accept an optional `telegram_chat_id`, or add a small dedicated fixture helper for this suite.
- Test teardown must use `deleteAuthTestUser` from `tests/helpers/authFlow.js`, not a raw `authorised_users` delete — `deleteAuthTestUser` explicitly cleans `sessions`, `otp_requests`, and `authorised_users`; `otp_requests` is keyed by `mobile_number` text (not an FK), so it will **not** be cleaned by cascade once these tests start generating real OTP rows.
- Add RBAC coverage in `tests/helpers/rbacMatrix.js` for the two new routes: `je`/`zo`/`ho` → `expectAllowed: false`, `accounts`/`admin` → `expectAllowed: true`, following the existing declarative entry shape (see the `fund_requests.*` entries for the pattern).

**Acceptance criteria**: enrollment is impossible without a valid Telegram OTP delivered to the account's own `telegram_chat_id`; re-enrollment (e.g. after appearance change) follows the identical OTP flow and overwrites the prior descriptor (row count stays 1 per user); the new contract test actually runs in CI (verified by checking `test:contracts:db`'s output lists it); RBAC matrix denies `je`/`zo`/`ho` on both new routes.

---

## Phase 3 — Backend: verification endpoint + scoped grace-period enforcement middleware

**Goal**: verify a submitted embedding, apply the grace period only to plain absence, lock immediately on anything security-relevant, and enforce on Accounts **write** routes only — the actual backend-authority requirement.

**Changes**:
- `faceVerification.schema.js` — add `verifyFaceSchema` (`{ descriptor: z.array(z.number().finite()).length(128) }`, same shape as `enrollFaceSchema`'s descriptor field) and `detectionFailureSchema` (`{ reason: z.enum(['no-face', 'multiple-faces', 'camera-error']) }`), used by the two new routes below.
- `faceVerification.service.js` — add `verifyDescriptor(userId, submittedDescriptor, threshold=0.6)` → `{ match, distance }` (0.6 is face-api.js's documented default threshold; tune in Phase 6 smoke testing).
- `session.service.js` — add, following the existing fetch-then-update `closeSession` pattern:
  - `getSession(sessionId)` — plain fetch-by-id (`select('*').eq('id', sessionId).single()`); does not exist yet in this file (confirmed — current exports are only `generateTokens`, `createSession`, `closeSession`, `formatDuration`) and is needed by `requireFaceVerified` below.
  - `recordFaceSuccess(sessionId)` — sets `last_face_verified_at = now()`, `face_verification_misses = 0`, `face_locked = false`.
  - `recordFaceAbsenceMiss(sessionId, maxMisses)` — **absence-only grace path**: increments `face_verification_misses`; if the new count `>= maxMisses`, sets `face_locked = true`. Used only when the client reports *no face detected at all*.
  - `lockSessionImmediately(sessionId, reason)` — **no-grace path**: sets `face_locked = true` directly on the first occurrence, regardless of the current miss count. Used for a wrong/unrecognized face (mismatch), multiple faces detected, and camera error/disconnected/access-denied.
- `faceVerification.controller.js`:
  - `verifyFace(req, res)` — calls `verifyDescriptor`. On match → `recordFaceSuccess`, `200 { success: true, match: true }`. On no-match (a face *was* detected but didn't match) → `lockSessionImmediately(sessionId, 'mismatch')`, `200 { success: false, code: 'FACE_MISMATCH', locked: true }` — no grace, no miss counting.
  - `reportDetectionFailure(req, res)` — client calls this when detection itself failed; body carries `reason: 'no-face' | 'multiple-faces' | 'camera-error'`. `'no-face'` → `recordFaceAbsenceMiss` (grace applies, response includes `locked` + `missesRemaining`). `'multiple-faces'` and `'camera-error'` → `lockSessionImmediately` (locks on first occurrence).
- `faceVerification.routes.js` — add:
  ```js
  router.post('/verify', requireRole(['accounts','admin']), validateRequest(verifyFaceSchema), verifyFace);
  router.post('/detection-failure', requireRole(['accounts','admin']), validateRequest(detectionFailureSchema), reportDetectionFailure);
  ```
- **New middleware** `backend/src/middleware/requireFaceVerified.js`, modeled on `verifyJwt.js`'s session-staleness check:
  ```js
  const STALE_MS = 60_000; // grace beyond the 30s client interval before treating as stale
  module.exports = async function requireFaceVerified(req, res, next) {
    if (process.env.FACE_VERIFICATION_ENABLED === 'false') return next();
    const session = await getSession(req.sessionId);
    if (session.face_locked) {
      return res.status(403).json({ success: false, code: 'FACE_LOCKED', message: 'Face verification lock active. Please re-verify.' });
    }
    if (!session.last_face_verified_at || Date.now() - new Date(session.last_face_verified_at).getTime() > STALE_MS) {
      return res.status(401).json({ success: false, code: 'FACE_VERIFICATION_STALE', message: 'Face verification required.' });
    }
    next();
  };
  ```
- Wire into `backend/src/routes/acctRequisition.routes.js`: insert `requireFaceVerified` after `requireRole(accountsRoles)` on **write** endpoints only — `PUT /bank-balances`, `PUT /account-sub-titles`, `PUT /particulars`, `PUT /beneficiary`, `PUT /indian-banks`, `POST/DELETE /sheets*`, `PATCH/DELETE /sheets/:sheetId/items/:itemId`, `POST /sheets/:sheetId/export-neft`, `POST /items/:itemId/resubmit`. All `readerRoles` GETs stay ungated — reads work even when face verification is locked/unavailable, per requirement. `hoRoles` HO-approval actions are out of scope (separate role/workflow).

**Tests**:
- Unit: `verifyDescriptor` match/no-match distance cases; `recordFaceAbsenceMiss` grace-period boundary (miss 1 → not locked, miss 2 → locked, given default `maxMisses=2`); `recordFaceSuccess` resets miss counter; `lockSessionImmediately` locks on a single call regardless of prior miss count.
- Contract (`requireFaceVerified.contract.test.js`): unverified session on a gated write route → 401 `FACE_VERIFICATION_STALE`; after `/verify` success → subsequent write within 60s succeeds; after 60s (mocked clock) → 401 again; a single **no-face** detection-failure does *not* lock (grace), a second consecutive one *does*; a single **mismatch**, a single **multiple-faces** report, and a single **camera-error** report each lock immediately on the first occurrence (no grace) → 403 `FACE_LOCKED` on further writes until `/verify` succeeds; **a GET to a reader-role endpoint succeeds throughout, even while locked**.
- Regression: extend `acctRequisitionLifecycle.test.js` to confirm gated write endpoints require face verification through a full sheet lifecycle, unaffected reads do not.

**Acceptance criteria**: absence-only grace (miss 1 = warn, not lock) and immediate-lock-on-first-occurrence for mismatch/multiple-faces/camera-error are both verified by test, not just described; all gated write endpoints correctly enforce 401/403 with documented codes; reads are provably unaffected.

---

## Phase 4 — Frontend: camera, periodic checks, scoped grace UX, manual re-verify, OTP-gated enrollment

**Goal**: run detection+embedding locally, call the backend on the cadence the middleware expects, surface absence-only grace visibly without hard-blocking, lock immediately (no grace) on mismatch/multiple-faces/camera-error, require an explicit user action to recover from a lock, and drive enrollment through the Telegram OTP step.

**Changes**:
- `frontend/package.json` — add `@vladmandic/face-api` (maintained face-api.js fork). Model weights as static assets in `frontend/public/models/` (`tiny_face_detector`, `face_recognition_model`), with a short note on which files are required.
- `frontend/src/api/faceVerificationApi.js` — `requestEnrollOtp()`, `enrollFace(descriptor, otp)`, `verifyFace(descriptor)`, `reportDetectionFailure(reason)`, following the existing axios-instance pattern in `authApi.js`.
- `frontend/src/utils/faceDetection.js` — `loadModels()` (cached, loads once), `captureDescriptor(videoEl)` → returns `{ descriptor }` on exactly one face, or `{ failureReason: 'no-face' | 'multiple-faces' }` otherwise (drives which API call the context makes below).
- `frontend/src/components/FaceVerificationContext.jsx` (sibling to `AuthContext.jsx`): owns the `MediaStream`, hidden `<video>`, and the 30s check loop. On each tick: capture, then branch —
  - one face found → `verifyFace(descriptor)`; match → `status='verified'`; mismatch → `status='locked'` immediately (no grace).
  - `failureReason: 'no-face'` → `reportDetectionFailure('no-face')`; response not yet locked → `status='warning'`; response locked (2nd consecutive miss) → `status='locked'`.
  - `failureReason: 'multiple-faces'`, or a `getUserMedia`/stream error → `reportDetectionFailure('multiple-faces' | 'camera-error')` → `status='locked'` immediately (no grace), matching the backend's no-grace path for these cases.
  - A shared axios response interceptor also watches for `FACE_LOCKED`/`FACE_VERIFICATION_STALE` on *any* API call and syncs `status` accordingly, so a locked backend state is always reflected even if the local loop is out of sync.
- `frontend/src/components/FaceGuard.jsx` — wraps a write view; renders children normally for `verified` (with a small non-blocking banner during `warning`), renders a full-screen lock modal for `locked`/`no-camera`. Per the diagram, this modal does **not** auto-retry — it shows a **"Verify Again"** button that the user clicks to re-open the camera and attempt one fresh verification (calling `retryVerification()` on the context, which runs the same capture→verify branch as the periodic tick, on demand). Reuse an existing modal component from `frontend/src/components/` rather than building new.
- Wrap `frontend/src/pages/AcctBeneficiaryMaster.jsx` and write-capable components under `frontend/src/components/acctRequisition/` (`BankLedgerPanel.jsx`, `BeneficiaryAutofill.jsx`, `BankBalanceEditor.jsx`) with `FaceGuard`. Read-only views stay unwrapped, matching backend gating scope.
- Enrollment flow in `frontend/src/pages/Profile.jsx` (block shown only for `role === 'accounts' || role === 'admin'`): "Enroll Face" → capture 2–3 stable consecutive detections → "Send OTP" (calls `requestEnrollOtp`) → OTP input → `enrollFace(descriptor, otp)`. This is a two-step UI (capture, then OTP) mirroring the existing login OTP UX already in the app (check `Login.jsx` for the OTP-entry component to reuse).

**Tests** (colocated `.test.jsx`, Vitest + Testing Library, mocking `faceVerificationApi`/`getUserMedia`, following `Login.test.jsx`'s mocking pattern):
- `FaceGuard.test.jsx` — renders children (with banner) on `warning`; renders blocking modal with a "Verify Again" button (not an auto-retry) on `locked`/`no-camera`; clicking it calls `retryVerification()`.
- `FaceVerificationContext.test.jsx` — fake-timer-driven interval cadence; first `no-face` tick → `warning` not `locked`, second consecutive `no-face` tick → `locked`; a single `mismatch` or `multiple-faces` tick → `locked` immediately with no prior warning state; interceptor flips `status` on a `FACE_LOCKED` response from an unrelated call.
- `Profile.test.jsx` (extend or add) — enrollment block hidden for non-accounts roles; full request-OTP → enter-OTP → submit flow works for accounts/admin roles; wrong OTP shows the existing invalid-OTP error state.

**Acceptance criteria**: `npm test` passes; manual smoke (Phase 6) confirms a single no-face frame shows a warning banner without blocking, a second consecutive no-face locks the UI, a single mismatch/multiple-faces/camera-error locks immediately with no warning stage, recovery from a lock requires an explicit "Verify Again" click (not automatic), and enrollment cannot complete without the correct Telegram OTP.

---

## Phase 5 — Config and privacy

**Goal**: make thresholds configurable, document biometric data handling, and provide a rollout kill switch.

**Changes**:
- `backend/.env.example` — add commented block: `FACE_VERIFICATION_ENABLED`, `FACE_VERIFICATION_INTERVAL_MS` (default 30000), `FACE_VERIFICATION_STALE_MS` (default 60000), `FACE_MATCH_THRESHOLD` (default 0.6), `FACE_VERIFICATION_MAX_MISSES` (default 2) — mirroring existing feature-flag documentation style (e.g. `IDBP_FILTER_TEST_DATA`).
- `FACE_VERIFICATION_ENABLED` is checked in `requireFaceVerified` (no-op when `false`) and in `FaceGuard` — an instant kill switch with no code change if the feature misbehaves in production.
- `docs/face_verification_privacy.md` (matching the existing `docs/accounts_ho_approval_technical_design_v5.md` precedent): what's stored (128-float embedding only, never images), retention (deleted on user deactivation via FK cascade, already in Phase 1's schema), consent capture (`consented_at` logged at enrollment, shown as an explicit notice before the camera opens).
- **Flag explicitly**: biometric data capture likely has legal/compliance implications (GDPR Art. 9-style regulations) — recommend a compliance sign-off outside this technical plan before production rollout.

**Acceptance criteria**: toggling `FACE_VERIFICATION_ENABLED=false` disables enforcement with zero code changes, verified by a contract test.

---

## Phase 6 — End-to-end verification

- Run full suite: `npm run test:unit && npm run test:contracts && npm run test:contracts:db && npm run test:integration` (backend), `npm test && npm run build` (frontend) — matching `.github/workflows/ci.yml`.
- Manual smoke test against local Supabase (`npm run test:local`): log in as a seeded `accounts` test user, enroll via `/profile` (real Telegram OTP or the dev bypass `123456` per `otp.service.js`'s non-production shortcut), open `AcctBeneficiaryMaster`, confirm writes work; cover the camera once → confirm warning banner, not a lock; cover it through a second consecutive check → confirm lock; confirm a direct API call with a valid-but-locked session cookie is rejected with `FACE_LOCKED` — proving server-side enforcement.
- Confirm reads (e.g. `GET /bank-balances`) succeed throughout, including while locked.
- Test with a second person's face in front of the camera to confirm a **mismatch locks immediately on the first occurrence** (no warning stage, unlike absence). Repeat with two people simultaneously in frame to confirm `multiple-faces` also locks immediately.
- Confirm recovery requires clicking "Verify Again" — that the UI does not silently auto-unlock on its own next periodic tick while in the `locked` state.

**Acceptance criteria**: all automated suites green; manual smoke confirms absence-only grace, immediate-lock-on-first-occurrence for mismatch/multiple-faces/camera-error, manual (not automatic) recovery from a lock, read/write separation, and OTP-gated enrollment — all enforced at the API layer independent of the frontend.
