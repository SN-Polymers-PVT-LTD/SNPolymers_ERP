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
│   │   ├── controllers/ # Route handler logic (Auth & Admin actions)
│   │   ├── db/          # Supabase client and query layer
│   │   ├── middleware/  # Rate limiting, validation, & JWT Auth guards
│   │   ├── routes/      # Express route definitions
│   │   └── services/    # Telegram Bot, Email (Nodemailer), & audit services
│   └── package.json
│
├── frontend/           # React + Vite client-side dashboard UI
│   ├── src/
│   │   ├── api/         # Axios instance & API client endpoints
│   │   ├── components/  # Reusable UI controls, auth wrappers, & contexts
│   │   ├── pages/       # Portal pages (Home, Login, Admin Panel, Audit Logs, OTP)
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
- **Resilience:** Rate limiter middleware (`express-rate-limit`) to prevent abuse

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

       ↓

Telegram Bot OTP
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
