# Part 4: Backend Internals & Routing Logic
## S.N. Polymers IDBP Express Service Reference

This document provides details of the backend architecture, controller logic, middleware implementations, and services.

---

## 1. Controllers Reference

### 1.1 `auth.controller.js`
* **`requestOtp`**:
  * Validation: Schema `requestOtpSchema` (E.164 phone validation).
  * Business Logic: Confirms mobile number is whitelisted and active. Generates a 6-digit cryptographic numeric code. Hashes it via bcrypt, stores it in `otp_requests` with a 5-minute expiry, and dispatches it via the Telegram Bot API message request.
* **`verifyOtpCode`**:
  * Validation: Matches `verifyOtpSchema`.
  * Business Logic: Compares OTP code using `bcrypt.compare` against the latest unused OTP request. Updates state `is_used` to true. Creates a new session record inside `sessions` table. Generates access JWT, and writes a cookie to response headers (`httpOnly: true`).
* **`logout`**:
  * Validation: Requires valid JWT.
  * Business Logic: Identifies session by JWT `jti`, closes the session row (`is_active = false`), clears cookie headers, and issues an asynchronous Nodemailer email alert.

### 1.2 `admin.controller.js`
* **`getUsers`**: Queries whitelist users, mapping session statistics (count and last login details) client-side.
* **`addUser`**: Inserts a new user record. Handles database conflicts gracefully.
* **`updateUser`**: Updates names, permissions, and roles. If deactivating a user, terminates all active sessions associated with their UUID.

### 1.3 `reports.controller.js`
* **`createReport`**:
  * Mutability Gate: Checks project status in `projects_master` prior to insertion. Returns `403 Forbidden` if status is `Closed`.
* **`updateReport`**:
  * Mutability Gate: Blocks update if the original project status is `Closed` or if the new project being linked is `Closed`.
* **`deleteReport`**:
  * Mutability Gate: Performs a soft-delete by setting `is_deleted = true`, blocked if project is `Closed`.

---

## 2. Services Reference

### 2.1 `telegram.service.js`
Integrates alerts and login codes directly to Telegram.
* **Background Polling Loop**: Uses standard HTTP long-polling via `/getUpdates`. When an operator messages `@snpolymers_bot`, the bot auto-replies with the operator's chat ID.
* **OTP Codes Delivery (`sendOtp`)**: Sends OTP verification codes directly to linked Telegram Chat IDs.
* **Supervisory Alerts**: Dispatches real-time alerts when Estimates are submitted (to ZO users) or approved (to HO users).

### 2.2 `otp.service.js`
Contains secure validation and hashing algorithms.
* **OTP Retry Limit**: Restricts login verification attempts to 3 per code. Failed attempts increment via the PostgreSQL atomic function `increment_otp_attempts`.

---

## 3. Middlewares Reference

### 3.1 `verifyJwt.js`
Guards protected APIs. 
1. Reads `req.cookies.token`.
2. Verifies the signature of the token against `JWT_SECRET`.
3. Queries the `sessions` table to check if the session `jti` is active.
4. Queries the `authorised_users` table to confirm that the user remains active in the whitelist.

```
Request with Cookie ──> verifyJwt ──> Check JWT Signature ──> Check Live Session Status ──> Check Whitelist Status ──> Controller
```

### 3.2 `rateLimiter.js`
Restricts denial of service or bruteforce attempts.
* `otpRequestLimiter`: Caps OTP generation requests to 5 times per 15 minutes per E.164 phone number.
* `otpVerifyLimiter`: Caps code submissions to 10 attempts per 15 minutes per phone number.
