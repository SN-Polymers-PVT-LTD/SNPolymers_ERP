# Part 2: High-Level Architecture & Technology Stack
## S.N. Polymers IDBP System Topology

This document details the high-level architecture, design decisions, monorepo communication layers, technology stack choices, and environment configurations.

---

## 1. System Topology Overview

The IDBP is structured as a decoupled monorepo containing:
1. **Frontend SPA**: React 19 single-page application built with Vite and Tailwind CSS.
2. **Backend API**: Node.js and Express RESTful server hosting database operations, OTP delivery, user management, and validation logic.
3. **Supabase Cloud Engine**: Managed PostgreSQL instance, secure file storage buckets (for requisitions and progress photos), and auditing databases.

```
+-------------------------------------------------------+
|                 React 19 Frontend SPA                 |
|             (Vercel CDN / Client Browser)             |
+--------------------------+----------------------------+
                           |
                           | HTTPS REST + HttpOnly Cookie Credentials
                           v
+-------------------------------------------------------+
|                   Express Backend API                 |
|                   (Render Web Service)                |
+--------+-----------------+-------------------+--------+
         |                 |                   |
         | admin client    | Telegram API      | SMTP (TLS)
         v                 v                   v
+------------------+ +-------------+ +------------------+
|     Supabase     | |  Telegram   | |   Gmail SMTP     |
| PostgreSQL &     | |  Bot Alert  | |   Email Alerts   |
| Object Storage   | |   System    | |    Transport     |
+------------------+ +-------------+ +------------------+
```

---

## 2. Technology Stack & Design Decisions

### Frontend Framework
* **Vite + React 19**: Replaced default bundlers to achieve sub-second hot reloading in development and highly optimized code-split production bundles. React 19 was selected to guarantee future-proof hook patterns.
* **Tailwind CSS**: Custom color definitions were injected into `tailwind.config.js` to build a dark-mode glassmorphic interface, ensuring visual consistency across all dashboards.
* **Axios Client**: Configured with `withCredentials: true` globally to allow the automatic transport of secure HTTP-only cookies without exposing token states to local browser scripts.

### Backend Framework
* **Node.js + Express**: Replaces monolithic frameworks to allow microsecond response times and complete control over security middlewares.
* **Supabase JS Client**: Configured to run on the backend via the `SUPABASE_SERVICE_ROLE_KEY`. This is a deliberate security decision: database security is enforced at the API gateway level, while RLS is bypassed internally to run complex cross-table operations.
* **Zod validation**: Applied directly at the middleware boundary. Routes will not hit controllers unless the input structure matches the Zod validation schemas.

---

## 3. Environment Variables Configuration

The following variables must be configured on deployment targets:

### Core Configuration
| Variable | Purpose | Production Usage | Security Implications |
|:---|:---|:---|:---|
| `PORT` | Local server port. Defaults to `5000`. | Ignored in PaaS hosting. | None. |
| `NODE_ENV` | Environment state (`development`, `production`). | Must be set to `production`. | Controls security guards (HTTPS flags). |
| `FRONTEND_URL` | Frontend origin for CORS. | Must point to Vercel domain. | Prevents unauthorized cross-origin requests. |

### Supabase Keys
| Variable | Purpose | Production Usage | Security Implications |
|:---|:---|:---|:---|
| `SUPABASE_URL` | Supabase project API gateway. | Shared production URL. | Public routing path. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin database access key. | Production service key. | **CRITICAL SECURITY RISK**. Grants full bypass of DB security. Never expose. |

### Security Secrets
| Variable | Purpose | Production Usage | Security Implications |
|:---|:---|:---|:---|
| `JWT_SECRET` | Secret key for JWT signature hashing. | Minimum 256-bit secure key. | **CRITICAL**. Compromise allows session spoofing. |
| `JWT_EXPIRY` | Token expiration duration (default: `24h`). | Set to `24h` or lower. | Limits duration of compromised sessions. |

### Integrations
| Variable | Purpose | Production Usage | Security Implications |
|:---|:---|:---|:---|
| `TELEGRAM_BOT_TOKEN` | Auth token for `@snpolymers_bot`. | Production bot token. | Allows sending messages on behalf of bot. |
| `GMAIL_USER` | Email alert sender account. | Corporate Gmail address. | Account access. |
| `GMAIL_APP_PASSWORD` | App-specific login credential. | App password. | Bypasses 2FA for SMTP mailing. |
| `ADMIN_EMAIL` | Receives login/logout audit emails. | Admin mailbox. | Information security. |
| `TWILIO_ACCOUNT_SID` | Backup SMS SID. | Twilio credential. | Billing. |
| `TWILIO_AUTH_TOKEN` | Backup SMS Auth token. | Twilio secret. | Twilio API access. |
| `TWILIO_WHATSAPP_FROM` | Whatsapp number. | Twilio sandbox/WABA. | Messaging dispatch. |
