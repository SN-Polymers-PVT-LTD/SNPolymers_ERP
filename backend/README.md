# S.N. Polymers - IDBP Backend API

[![Express Version](https://img.shields.io/badge/express-%5E4.19.2-blue.svg)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/database-supabase-green.svg)](https://supabase.com)
[![Twilio](https://img.shields.io/badge/sms-twilio-red.svg)](https://twilio.com)
[![Nodemailer](https://img.shields.io/badge/email-nodemailer-orange.svg)](https://nodemailer.com)

This directory houses the backend server for S.N. Polymers' **Integrated Digital Business Platform (IDBP)**. It is constructed with Node.js and Express, orchestrating secure sessions, database operations through Supabase, OTP verifications via Twilio, and email alerting services.

---

## 📂 Directory Structure

```
backend/
├── src/
│   ├── app.js               # Application setup, CORS config, and root middlewares
│   ├── controllers/
│   │   ├── auth.controller.js  # Registration, sign-in, OTP, and session actions
│   │   └── admin.controller.js # Corporate dashboards, logs, and user status controls
│   ├── db/
│   │   └── supabase.js      # Initialized Supabase client instance
│   ├── middleware/
│   │   ├── auth.middleware.js  # JWT validation, role-based protection
│   │   └── rate-limiter.js  # DOS prevention limits
│   ├── routes/
│   │   ├── auth.routes.js   # Public auth routes (login, register, verify OTP)
│   │   └── admin.routes.js  # Protected admin endpoints
│   └── services/
│       ├── email.service.js # Email dispatcher (Gmail SMTP wrapper)
│       └── sms.service.js   # Twilio WhatsApp & SMS dispatcher
├── .env.example             # Template for configuration
└── package.json             # Engine scripts and dependency declarations
```

---

## ⚡ Setup & Configuration

### 1. Configure Environment Variables
Create a `.env` file in the root of the `/backend` directory based on the `.env.example` file:

```ini
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Supabase Configurations
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Authentication
JWT_SECRET=your_long_secure_jwt_secret_phrase
JWT_EXPIRY=24h

# Messaging Channels
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Mailer Configuration
GMAIL_USER=sender_email@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
ADMIN_EMAIL=recipient_email@domain.com
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Execution
To run the server in **development mode** with hot reloading (via nodemon):
```bash
npm run dev
```

To run the server in **production mode**:
```bash
npm start
```

---

## Database migrations (Supabase)

SQL migrations live in [`src/db/migrations/`](src/db/migrations/). The runner [`scripts/apply-migrations.js`](scripts/apply-migrations.js) applies pending `.sql` files in numeric order and records them in `public._migration_log`, so it is safe to run repeatedly.

### Connection env files (gitignored)

Create these in `/backend` (never commit them):

**`.env.dev-db`** — shared dev/staging Supabase project:
```ini
SUPABASE_TEST_DB_URI=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

**`.env.prod-db`** — production Supabase project:
```ini
SUPABASE_TEST_DB_URI=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

Get the URI from **Supabase Dashboard → Project Settings → Database → Connection string → URI**. Prefer the **Session pooler** URL (IPv4-friendly); the direct `db.*.supabase.co` host is IPv6-only on the free tier and often fails from local networks.

### Apply migrations

```bash
cd backend

# Dev / staging Supabase (loads .env.dev-db)
npm run migrate:dev

# Production Supabase (loads .env.prod-db) — run only after reviewing SQL
npm run migrate:prod
```

Equivalent manual form:
```bash
SUPABASE_TEST_DB_URI='postgresql://...' npm run migrate
```

### Local Supabase (tests)

`npm run test:local` starts local Supabase (if needed), runs `apply-migrations.js` against `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, then runs integration tests. No `.env.dev-db` file is required for that path.

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli/local-development) installed.

### Baseline an existing database

If a Supabase project already has the schema (e.g. created via dashboard or an older deploy) but no `_migration_log` rows, mark files as applied **without** executing SQL:

```bash
npm run migrate:baseline:dev    # or migrate:baseline:prod
```

Use `--exclude <filename.sql>` when a specific migration should still run. See [`scripts/baseline-migrations.js`](scripts/baseline-migrations.js).

### Adding a new migration

1. Add `NNN_short_description.sql` under `src/db/migrations/` (leading number sets order).
2. Test locally: `npm run test:local` or `npm run migrate:dev` against dev.
3. Deploy backend, then run `npm run migrate:prod` before or immediately after production deploy.

Release checklist and backup notes: [`docs/deployment_operations.md`](../docs/deployment_operations.md).

---

## 🛡️ Core API Endpoints

### Public Authentication API (`/api/v1/auth`)
- `POST /register` - Registers a new internal employee. Sets user status to `PENDING` validation.
- `POST /login` - Standard password validation. Initiates multi-factor authentication by sending a code to the registered mobile.
- `POST /verify-otp` - Completes login by validating the 6-digit OTP code, issuing a JWT.
- `POST /logout` - Cleans session tokens.

### Protected Administrative API (`/api/v1/auth/admin`)
*(All admin endpoints require valid Admin authorization header cookies)*
- `GET /users` - Lists all employees, current status (`PENDING`, `APPROVED`, `SUSPENDED`).
- `PATCH /users/:userId/status` - Approves, rejects, or suspends an employee.
- `GET /audit-logs` - Inspects detailed action history logs.
