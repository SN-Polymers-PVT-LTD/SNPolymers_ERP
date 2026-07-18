# S.N. Polymers - Integrated Digital Business Platform (IDBP)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg)](https://nodejs.org)
[![React Version](https://img.shields.io/badge/react-%5E19.0.0-blue.svg)](https://react.dev)
[![Vite Version](https://img.shields.io/badge/vite-%5E8.0.0-blue.svg)](https://vite.dev)
[![Express Version](https://img.shields.io/badge/express-%5E4.19.2-blue.svg)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/Database-Supabase-green.svg)](https://supabase.com)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)](#)

Welcome to the **Integrated Digital Business Platform (IDBP)** for **S.N. Polymers**. This project is a monorepo containing both the backend and frontend components designed to centralize access, management, and tracking of manufacturing formulation pipelines, logistics controls, and government infrastructure projects.

---

##  Repository Architecture

The project is split into two primary folders:

```
SNPolymers/
├── backend/            # Express.js REST API with Supabase integration
│   ├── src/
│   │   ├── controllers/ # Route handler logic (Auth, Admin, & RA/Final Bills)
│   │   ├── db/          # Supabase client, query layer, and SQL migrations
│   │   ├── middleware/  # Rate limiting, validation, & JWT Auth guards
│   │   ├── routes/      # Express route definitions
│   │   └── services/    # Telegram Bot, Email (Nodemailer), & audit services
│   └── package.json
│
├── frontend/           # React + Vite client-side dashboard UI
│   ├── src/
│   │   ├── api/         # Axios instance & API client endpoints
│   │   ├── components/  # Reusable UI controls, auth wrappers, & contexts
│   │   ├── pages/       # Portal pages (Home, Dashboard, Requisitions, RA/Final Bills)
│   │   └── index.css    # Tailwind CSS imports & global styles
│   └── package.json
```

---

## Tech Stack & Key Technologies

### Frontend
- **Framework:** React 19 (Vite bundler)
- **Styling:** Tailwind CSS + PostCSS
- **Navigation:** React Router DOM v6
- **HTTP Client:** Axios (configured with interceptors & credentials support)

### Backend
- **Framework:** Node.js + Express.js
- **Database / Auth Storage:** Supabase (PostgreSQL with Service Role permissions)
- **Security:** JSON Web Tokens (JWT), `bcrypt` password hashing, cookie parser
- **Integrations:**
  - **Telegram Bot API:** Secure Multi-Factor / OTP Verification via @snpolymers_bot
  - **Nodemailer (SMTP):** Secure corporate notifications
  - **Supabase Storage:** Private bucket file storage (`ra-bill-copies`) with timed signed URL generation (TTL: 1 hour) for secure document retrieval.
- **Resilience:** Rate limiter middleware (`express-rate-limit`) to prevent abuse

---

## System Modules (Phases 1–6)

The IDBP features a comprehensive set of enterprise resource planning modules implemented across several rollout phases:

* **Phase 1 — Auth & Access Controls:** Multi-factor authentication via Telegram OTP bot, custom role-based privileges (`admin`, `ho`, `zo`, `je`, `staff`), and corporate fund reports.
* **Phase 2 — Project Cost Estimation:** Creation of project cost estimates by JEs, review by Zonal Offices (ZO), and final approval by the Head Office (HO) with detailed revision history tracking.
* **Phase 3 — Fund Requests:** ZO fund request generation and HO workflow approvals mapping disbursements to Credit Control (CC), Overdraft (OD), or Cash Credit (CR) accounts.
* **Phase 4 — Payment Requisition Management:** Procurement requisition logging against active projects, ensuring amount allocations stay within remaining estimate bounds. Supports GST declarations and invoice attachment uploads.
* **Phase 5 — Daily Work Progress:** Daily site visit logging for JEs, including photo uploads, cumulative work percentage updates, and authority review comment capabilities.
* **Phase 6 — RA / Final Bill Entry:** Run-time billing management for projects. Enforces sequential RA billing ($N-1$ must exist before $N$), prevents edits/deletions on financial records via database constraints, and computes live billing summary calculations (Previous Bill Amount, Current Bill Amount, Total Billed, Balance Amount).

---

## Getting Started

Follow these steps to set up and run the entire application locally.

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18.0.0 or higher) and `npm` installed.

### 1. Clone & Set Up Environments

#### Setup Backend Environment
1. Navigate to `/backend`
2. Duplicate `.env.example` as `.env`:
   ```bash
   cp .env.example .env
   ```
3. Populate the required environment variables:
   - **Supabase credentials** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
   - **JWT Secrets** (`JWT_SECRET`)
   - **Telegram Bot Token** (`TELEGRAM_BOT_TOKEN`) (for OTP authentication)
   - **Gmail SMTP Credentials** (for admin alerts & notifications)

#### Setup Frontend Environment
The frontend communicates directly with `http://localhost:5000/api/v1` by default. Custom configurations can be adjusted inside the frontend Axios client wrapper.

---

### 2. Installation and Running

You need to spin up the backend and the frontend in separate terminals.

#### Run Backend
```bash
cd backend
npm install
npm run dev
```
The backend server runs on `http://localhost:5000`.

#### Run Frontend
```bash
cd frontend
npm install
npm run dev
```
The client UI will run on `http://localhost:5173`.

---

## Running Verification Tests

The monorepo contains comprehensive test suites to verify database constraints, security controls, and endpoint logic.

### Run All System Tests
To run the entire suite of system tests:
```bash
cd backend
npm run test:all
```

### Run Phase 6 Specific Tests
To test the Database Foundation, Core CRUD APIs, and Storage upload controls for the RA / Final Bill Entry module:
```bash
cd backend
# Run DB, CRUD, and Upload tests
npm run test:p6:all

# Or run individual milestones:
npm run test:p6:m1 # Database schema, checks & constraints
npm run test:p6:m2 # Core CRUD and billing summary statistics
npm run test:p6:m3 # File uploading and bucket security controls
```

---

## Live Deployment

### Production Environment

| Service | URL |
|----------|-----|
| Frontend (Vercel) | https://sn-polymers.vercel.app/ |
| Backend API (Render) | https://snpolymers.onrender.com |
| API Health Check | https://snpolymers.onrender.com/health |

### API Base URL

```text
https://snpolymers.onrender.com/api/v1/auth
```

### Deployment Architecture

```text
User
  ↓
Vercel Frontend
  ↓
Render Backend API
  ↓
Supabase PostgreSQL
 ├─ Private Storage (ra-bill-copies)
 └─ Telegram Bot OTP
```

> **Note:** The frontend communicates with the backend through the `VITE_API_URL` environment variable. For production deployments this is configured as:

```env
VITE_API_URL=https://snpolymers.onrender.com/api/v1/auth
```
---

## Security & Best Practices

- **Zero Client-Side Secret Leak:** The client never directly calls Supabase. All security operations, user management, and DB mutations are mediated securely by the Express.js Backend API.
- **Secure Sessions:** Sessions are reinforced using JWT authorization cookies and secure token verification.
- **Audit Logging:** Every critical administrative action is recorded systematically to provide trace logs for corporate compliance.
- **MIME type verification:** Storage uploads restrict incoming files to strict PDF/JPG/PNG structures using server-side inspection instead of trusting extensions.
- **Immutability Protection:** Running account and final bill documents are protected against unauthorized updates or deletions at the database schema level via triggers.

...