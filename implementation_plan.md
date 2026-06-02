# IDBP Phase 1 — Authentication & Access Control

## Overview

This plan implements the **Integrated Digital Business Platform (IDBP) Phase 1** for S.N Polymers — a secure, OTP-based authentication and access control system that serves as the foundational security layer for the full future ERP platform.

The system will restrict internal dashboard access to **whitelisted mobile numbers only**, deliver OTPs via **WhatsApp (Twilio WABA)**, manage **JWT sessions**, and automatically **notify the Administrator** on every login/logout event.

---

## Open Questions

> [!IMPORTANT]
> The following items from the spec are **required before or during development** and will directly affect implementation:

| # | Item | Detail |
|---|------|---------|
| 1 | **WhatsApp Business Account** | Do you have an active Twilio + WABA setup? If not, fallback to SMS OTP (Twilio SMS) during development? |
| 2 | **Admin contact details** | Mobile number and email address of the Administrator for notifications |
| 3 | **Notification email** | Which Gmail account will send automated alerts? (e.g. `noreply@snpolymers.com`) |
| 4 | **OTP expiry** | Default is 5 minutes. Keep as-is or adjust? |
| 5 | **Session duration** | Default JWT expiry is 24 hours. Keep or shorten? |
| 6 | **Admin panel placement** | Separate `/admin` route within the same app, or a separate subdomain? |
| 7 | **Hosting domain** | What domain will the platform run on? (needed for CORS + cookie config) |
| 8 | **Initial user whitelist** | Mobile numbers to pre-load for testing |

> [!WARNING]
> Without Twilio credentials and a verified WABA, WhatsApp OTP cannot be tested in production. Development will use **console-logged OTPs** as a placeholder until credentials are provided.

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React + Vite | Login portal, OTP screen, Admin dashboard |
| Styling | Tailwind CSS | Mobile-first, responsive |
| Backend | Node.js + Express | REST API, auth logic, middleware |
| Database | Supabase (PostgreSQL) | Whitelist, sessions, audit trail |
| Auth Tokens | JWT (`jsonwebtoken`) | HS256, httpOnly cookies |
| WhatsApp OTP | Twilio WABA API | 6-digit OTP delivery |
| Email Alerts | Nodemailer + Gmail SMTP | Admin login/logout notifications |
| Frontend Hosting | Vercel | Free tier |
| Backend Hosting | Railway / Render | Free tier |

---

## Proposed Project Structure

```
SNPolymers/
├── frontend/               # React + Vite app
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx          # Public home page with "Office Use" button
│   │   │   ├── Login.jsx         # Mobile number entry screen
│   │   │   ├── OtpVerify.jsx     # OTP entry screen
│   │   │   ├── Dashboard.jsx     # Internal dashboard (protected)
│   │   │   └── admin/
│   │   │       ├── AdminPanel.jsx     # Admin user management
│   │   │       └── AuditLog.jsx       # Session history view
│   │   ├── components/
│   │   │   ├── ProtectedRoute.jsx     # JWT auth guard
│   │   │   └── AdminRoute.jsx         # Admin-only guard
│   │   ├── api/
│   │   │   └── authApi.js             # Axios API calls
│   │   └── App.jsx
│   ├── tailwind.config.js
│   └── vite.config.js
│
└── backend/                # Node.js + Express API
    ├── src/
    │   ├── routes/
    │   │   ├── auth.routes.js         # /api/v1/auth/*
    │   │   └── admin.routes.js        # /api/v1/auth/admin/*
    │   ├── controllers/
    │   │   ├── auth.controller.js
    │   │   └── admin.controller.js
    │   ├── middleware/
    │   │   ├── verifyJwt.js           # JWT validation on every protected route
    │   │   ├── requireAdmin.js        # Admin role guard
    │   │   └── rateLimiter.js         # OTP rate limiting
    │   ├── services/
    │   │   ├── otp.service.js         # OTP generate, hash, store, verify
    │   │   ├── whatsapp.service.js    # Twilio WABA integration
    │   │   ├── email.service.js       # Nodemailer notifications
    │   │   └── session.service.js     # JWT issue, session create/close
    │   ├── db/
    │   │   └── supabase.js            # Supabase client init
    │   └── app.js                     # Express app setup
    ├── .env.example
    └── package.json
```

---

## Proposed Changes

### Day 1 — Project Setup, Supabase Schema, Environment Config

#### [NEW] `backend/` — Express API scaffold
- Initialise with `npm init`, install: `express`, `@supabase/supabase-js`, `jsonwebtoken`, `bcrypt`, `cors`, `cookie-parser`, `dotenv`, `express-rate-limit`, `twilio`, `nodemailer`
- Set up `app.js` with CORS (allow Vercel frontend URL), cookie-parser, JSON body parser
- Create `.env.example` with all required keys

#### [NEW] `frontend/` — Vite + React scaffold
- Initialise with `npm create vite@latest frontend -- --template react`
- Install: `tailwindcss`, `react-router-dom`, `axios`
- Set up Tailwind config, global styles

#### [NEW] Supabase Database Schema — 3 tables

**`authorised_users`**
```sql
CREATE TABLE authorised_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number varchar(15) UNIQUE NOT NULL,
  display_name  varchar(100),
  role          varchar(50) DEFAULT 'staff',
  permissions   jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  is_active     boolean DEFAULT true
);
```

**`otp_requests`**
```sql
CREATE TABLE otp_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile_number varchar(15) NOT NULL,
  otp_hash      text NOT NULL,
  expires_at    timestamptz NOT NULL,
  is_used       boolean DEFAULT false,
  attempts      int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
```

**`sessions`**
```sql
CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES authorised_users(id),
  login_at        timestamptz DEFAULT now(),
  logout_at       timestamptz,
  duration_seconds int,
  ip_address      inet,
  user_agent      text,
  module          varchar(50) DEFAULT 'office',
  jwt_jti         varchar(100) UNIQUE,
  is_active       boolean DEFAULT true
);
```

- Enable **Row Level Security** on all tables
- Create RLS policies: users read only their own sessions; admin reads all

---

### Day 2 — WhatsApp OTP Integration & Admin User Management

#### [NEW] `backend/src/services/otp.service.js`
- `generateOtp()` — 6-digit using `crypto.randomInt`
- `hashOtp(otp)` — bcrypt hash, never store plaintext
- `storeOtp(mobile, hash, expiresAt)` — insert into `otp_requests`
- `verifyOtp(mobile, code)` — fetch latest unused OTP, compare hash, check expiry and attempts

#### [NEW] `backend/src/services/whatsapp.service.js`
- Twilio client initialised from env vars
- `sendOtp(mobile, otp)` — send WhatsApp template message via WABA
- **Dev fallback**: if `NODE_ENV=development`, log OTP to console instead of sending

#### [NEW] `backend/src/routes/auth.routes.js` — endpoints:
- `POST /api/v1/auth/request-otp` — whitelist check → generate OTP → WhatsApp send
- `POST /api/v1/auth/verify-otp` — verify OTP → create session → issue JWT → set httpOnly cookie

#### [NEW] `backend/src/middleware/rateLimiter.js`
- Max **3 OTP requests per mobile per 15 minutes** using `express-rate-limit`
- Max **3 verify attempts per OTP** (tracked in DB `attempts` column)

#### [NEW] `backend/src/routes/admin.routes.js` — endpoints:
- `GET /api/v1/auth/admin/users` — list all users
- `POST /api/v1/auth/admin/users` — add user to whitelist
- `PATCH /api/v1/auth/admin/users/:id` — update user or deactivate
- `DELETE /api/v1/auth/admin/users/:id` — hard delete + invalidate sessions

---

### Day 3 — Session Management, JWT, Login/Logout Logic

#### [NEW] `backend/src/services/session.service.js`
- `createSession(userId, jti, ip, userAgent)` — insert sessions row
- `closeSession(jti)` — update `logout_at`, `is_active=false`, `duration_seconds`
- `invalidateAllSessions(userId)` — used when admin deletes a user

#### [NEW] `backend/src/middleware/verifyJwt.js`
- Extract JWT from `httpOnly` cookie
- Verify signature + expiry
- Check `jti` against DB sessions table (blacklist check)
- Attach `req.user` (user_id, mobile, role, permissions)

#### [NEW] `backend/src/middleware/requireAdmin.js`
- Check `req.user.role === 'admin'`
- Return 403 if not

#### [MODIFY] `backend/src/routes/auth.routes.js`
- Add `POST /api/v1/auth/logout` — close session + notify admin
- Add `GET /api/v1/auth/me` — return current user profile

#### [NEW] `frontend/src/components/ProtectedRoute.jsx`
- On mount, call `GET /api/v1/auth/me`
- If 401 → redirect to `/login`

#### [NEW] `frontend/src/components/AdminRoute.jsx`
- Check `user.role === 'admin'` after /me check
- If not admin → redirect to `/dashboard`

---

### Day 4 — Email Notifications, Admin Dashboard UI, Audit Log

#### [NEW] `backend/src/services/email.service.js`
- Nodemailer transport using Gmail SMTP (app password from env)
- `sendLoginAlert(adminEmail, {mobile, loginTime, ip})` — login notification
- `sendLogoutAlert(adminEmail, {mobile, logoutTime, duration})` — logout notification
- Both run as **async background jobs** — never block the login/logout response

#### [NEW] `frontend/src/pages/Login.jsx`
- Mobile number input with `+91` prefix selector
- Client-side validation (10 digits)
- Submit → `POST /request-otp` → navigate to OTP screen

#### [NEW] `frontend/src/pages/OtpVerify.jsx`
- 6-box OTP input (auto-advance on digit entry)
- 5-minute countdown timer
- Resend OTP button (active after 30s)
- Submit → `POST /verify-otp` → navigate to `/dashboard`

#### [NEW] `frontend/src/pages/admin/AdminPanel.jsx`
- Table of all authorised users (name, mobile, status, last login)
- "Add User" modal form
- Deactivate / Delete actions per row
- Uses `GET /admin/users`, `POST /admin/users`, `PATCH`, `DELETE`

#### [NEW] `frontend/src/pages/admin/AuditLog.jsx`
- Paginated session history table
- Filters: by user, date range, session duration
- Uses `GET /admin/sessions`

---

### Day 5 — Testing, Deployment, Documentation

#### Testing Checklist
- [ ] Whitelist check rejects unlisted mobile numbers
- [ ] OTP expires after 5 minutes
- [ ] Max 3 incorrect OTP attempts locks the code
- [ ] Rate limit blocks >3 OTP requests per 15 min
- [ ] JWT stored in httpOnly cookie (not accessible via JS)
- [ ] Logout invalidates JWT and rejects future requests with same token
- [ ] Admin receives login/logout email notifications
- [ ] Admin panel CRUD operations work correctly
- [ ] Non-admin users cannot access `/admin/*` routes (403 returned)
- [ ] Session duration tracked correctly in audit log

#### Deployment
- Frontend → **Vercel** (connect GitHub repo, set `VITE_API_URL` env var)
- Backend → **Railway** or **Render** (set all env vars from `.env.example`)
- Supabase → production project with RLS enabled

#### [NEW] `.env.example` (backend)
```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# JWT
JWT_SECRET=                  # minimum 256-bit random string
JWT_EXPIRY=24h

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=        # e.g. whatsapp:+14155238886

# Email Notifications
GMAIL_USER=
GMAIL_APP_PASSWORD=
ADMIN_EMAIL=                 # administrator's email

# App
PORT=5000
FRONTEND_URL=                # deployed Vercel URL
NODE_ENV=development
```

---

## API Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/request-otp` | None | Whitelist check → send WhatsApp OTP |
| POST | `/api/v1/auth/verify-otp` | None | Verify OTP → create session → return JWT |
| POST | `/api/v1/auth/logout` | JWT | Close session → admin notification |
| GET | `/api/v1/auth/me` | JWT | Current user profile + permissions |
| GET | `/api/v1/auth/admin/users` | Admin JWT | List all whitelisted users |
| POST | `/api/v1/auth/admin/users` | Admin JWT | Add user to whitelist |
| PATCH | `/api/v1/auth/admin/users/:id` | Admin JWT | Update user / deactivate |
| DELETE | `/api/v1/auth/admin/users/:id` | Admin JWT | Remove user + invalidate sessions |
| GET | `/api/v1/auth/admin/sessions` | Admin JWT | Full audit log with filters |

---

## Security Summary

| Concern | Mitigation |
|---------|-----------|
| OTP brute-force | Max 3 attempts per OTP; lock after exceeded |
| OTP farming | Max 3 requests per mobile per 15 min (rate limiter) |
| OTP storage | bcrypt-hashed — plaintext never persisted |
| Token theft | JWT in httpOnly, Secure, SameSite=Strict cookie |
| Token reuse after logout | jti blacklist checked on every protected request |
| Unauthorized access | RLS on Supabase; admin role verified server-side only |
| Secrets exposure | All credentials in env vars; never in source code |

---

## Verification Plan

### Automated / Dev Testing
- Run backend locally (`npm run dev`) and test all endpoints via Postman or `curl`
- Run frontend locally (`npm run dev`) and test the full login → OTP → dashboard flow end-to-end
- Test with non-whitelisted numbers to verify access denial

### Manual Verification
- Confirm admin email is received on login and logout
- Confirm OTP arrives on WhatsApp (once Twilio credentials are available)
- Confirm session audit log captures correct login/logout timestamps and duration
- Confirm admin panel CRUD works and changes reflect immediately

---

*Prepared by: Development Team — Intern Batch 2026 | S.N Polymers | Date: 02 June 2026*
