# Part 7: Authentication & Security Controls
## S.N. Polymers IDBP Security Hardening Manual

This document details threat mitigations, cryptographic standards, session management policies, and rate limits.

---

## 1. Authentication Lifecycle

### Cryptographic OTP Hashing
OTP verification codes are generated using cryptographically secure random integers (`crypto.randomInt`).
* Plaint text codes are hashed immediately using `bcrypt` (10 salt rounds) before insertion into `otp_requests`.
* Unused, plaintext codes are never logged to files or databases.

### Session Cookies Strategy
Upon successful login, a JWT is generated.
* The JWT contains a unique Session JTI (`jwt_jti`) referencing a specific row in the `sessions` audit table.
* The token is returned as a cookie using the following production configuration:
  - `httpOnly: true`: Prevents access from client-side JavaScript, mitigating Cross-Site Scripting (XSS) risks.
  - `secure: true`: Restricts cookie transmission to HTTPS protocols only.
  - `sameSite: 'none'`: Required to support cross-origin requests between the Vercel frontend and the Render API.

```
+-------------------------------------------------------------+
| JWT Cookie Header:                                          |
| Set-Cookie: token=...; HttpOnly; Secure; SameSite=None      |
+-------------------------------------------------------------+
```

---

## 2. Threat & Vulnerability Mitigations

### 1. Project Mutability Gates (Closed Project Lockouts)
* **Threat**: Deactivated or completed projects receiving modified accounting entries after final books are closed.
* **Control**: Controllers enforce a strict gate checking the `status` of target projects in `projects_master` on all write actions (`POST`, `PUT`, `DELETE`, `PATCH`). If the status is `Closed`, actions are blocked at the server level, returning `403 Forbidden`.

### 2. Token Invalidation
* **Threat**: Replay attacks using stolen tokens.
* **Control**: The backend runs verification checks against the active database session status (`is_active = true`) on every protected request. When an administrator revokes access or a user logs out, the backend sets the session status to `false`, immediately invalidating any copies of the token in circulation.

### 3. Rate Limiting Throttling
* **Threat**: Automated brute-forcing of OTP codes.
* **Control**: `express-rate-limit` limities requests per phone number rather than IP address alone.
  - Generates request keys using E.164 phone numbers. This prevents denial-of-service triggers from blocking other users on shared networks.
  - Locks verification pathways for 15 minutes if limits are breached.
