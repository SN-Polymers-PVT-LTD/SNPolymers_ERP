# Part 10: Infrastructure, Deployment & Operations
## S.N. Polymers IDBP System Operations Reference

This document maps hosting services, CI/CD pipelines, logging setups, database backup routines, and the release checklist for production deploys.

---

## 1. Hosting Infrastructure

The IDBP is hosted across three cloud platforms:

| Component | Platform | Configuration | URL |
|:---|:---|:---|:---|
| **Frontend Web app** | **Vercel** | SPA build, environment injection, auto-deploys on commit | `https://sn-polymers.vercel.app/` |
| **Backend REST API** | **Render** | Node.js web service, CORS whitelists, env injection | `https://snpolymers.onrender.com` |
| **Database & Storage** | **Supabase** | Managed PostgreSQL, secure private buckets | *(Private connection pool)* |

### Branch and deploy policy

| Platform | Production source | Notes |
|:---|:---|:---|
| **Render** (backend) | `main` only | Do not point the production Render service at feature branches. Merges to `main` trigger auto-deploy. |
| **Vercel** (frontend) | `main` (production) + PR previews | Preview deployments must use the Render API URL (see §5). |

---

## 2. Health Monitoring & Logs Analysis

### Server liveness checks

The backend exposes `GET /health` with a database connectivity ping and a deployment fingerprint:

```json
{
  "status": "OK",
  "database": "CONNECTED",
  "version": "1.0.0",
  "git": "a1b2c3d",
  "branch": "main",
  "built": null,
  "timestamp": "2026-06-27T03:32:00.000Z"
}
```

On database failure the endpoint returns HTTP 503 with `"database": "DISCONNECTED"`.

**Health URL:** `https://snpolymers.onrender.com/health`

### Deployment fingerprint (`git` field)

`buildInfo` (`backend/src/utils/buildInfo.js`) populates the `git`, `branch`, and `built` fields on `/health`:

| Environment variable | Set by | Purpose |
|:---|:---|:---|
| `RENDER_GIT_COMMIT` | Render (automatic) | Short SHA of the commit Render deployed |
| `RENDER_GIT_BRANCH` | Render (automatic) | Branch name (expect `main` in production) |
| `GIT_SHA` | CI / manual override | Used when `RENDER_GIT_COMMIT` is absent (local, smoke) |
| `GIT_BRANCH` | CI / manual override | Branch label for non-Render runs |
| `BUILD_TIMESTAMP` | CI (optional) | ISO timestamp of the build |

Production smoke (`.github/workflows/production-smoke.yml`) runs every 15 minutes and verifies that `/health` reports a `git` SHA matching the latest commit on `main` when `SMOKE_VERIFY_GITHUB_SHA=true`.

### Production smoke workflow

| Trigger | Command | What it checks |
|:---|:---|:---|
| Cron (every 15 min) | `npm run smoke:prod` | Health, DB connectivity, SHA match, auth routing, CORS, security headers, latency |
| Manual (`workflow_dispatch`) | Same | Run after a deploy to confirm production before announcing |

Smoke probes are **stateless** — no OTP or rate-limited auth flows.

### Audit trails

All CRUD operations on critical business tables (`fund_reports`, `projects_master`, `requisitions`, `daily_progress_reports`) are audited via database triggers. Admins can view these logs directly in the **Audit Trail Logs** panel of the Admin section.

---

## 3. Release checklist (merge → production)

Use this sequence when merging a PR that touches the backend or database.

1. **CI green** — all staged jobs pass on the PR (lint → unit → static contracts → integration → frontend).
2. **Merge to `main`** — Render and Vercel pick up the commit from `main`.
3. **Apply migrations to production** (if `backend/src/db/migrations/` changed):
   ```bash
   cd backend
   npm run migrate:prod
   ```
   Requires `backend/.env.prod-db` with the production `SUPABASE_TEST_DB_URI` (gitignored). Run migrations **before or immediately after** the Render deploy so the new code and schema stay aligned.
4. **Regenerate manifests** (if migrations changed schema, RPCs, or indexes):
   ```bash
   cd backend
   npm run generate:manifests
   ```
   Commit updated files under `backend/tests/manifests/` in the same PR (or a fast follow-up) so contract tests catch drift on the next CI run.
5. **Verify production** — trigger **Production smoke** in GitHub Actions or confirm `GET /health` shows the expected `git` SHA.

PR authors should complete the checklist in [`.github/pull_request_template.md`](../.github/pull_request_template.md).

---

## 4. Database backups & recovery

### Auto-backups

* Supabase executes daily database backups automatically.
* Key ledger data (estimates, requisitions, daily progress logs) are protected from hard deletes using the database rule triggers `prevent_requisition_hard_delete` and `prevent_daily_progress_hard_delete`. This ensures history is preserved even during application failures.

### Disaster recovery

To rebuild the database environment from scratch:

1. Initialize a new PostgreSQL database instance on Supabase.
2. Apply migration files from `backend/src/db/migrations/` in order (use `npm run migrate` with the new connection string).
3. Set the new database credentials inside Render's environment dashboard.
4. Manually configure the private storage buckets `payment-requisitions-pdfs` and `daily-progress-photos` in the Supabase storage dashboard.

### Local / CI migrations

| Command | Target |
|:---|:---|
| `npm run migrate` | Uses `DATABASE_URL` / env from shell |
| `npm run migrate:dev` | Loads `backend/.env.dev-db` |
| `npm run migrate:prod` | Loads `backend/.env.prod-db` |

CI runs `npm run migrate` against a local Supabase instance before integration tests (`.github/workflows/ci.yml`).

---

## 5. Frontend environment (`VITE_API_URL`)

The SPA calls the backend through `VITE_API_URL` (see `frontend/src/api/`). Production value:

```env
VITE_API_URL=https://snpolymers.onrender.com/api/v1/auth
```

| Vercel environment | Required `VITE_API_URL` |
|:---|:---|
| **Production** | `https://snpolymers.onrender.com/api/v1/auth` |
| **Preview** (PR branches) | Same Render URL — previews talk to the shared production API, not localhost |

CI enforces this via `frontend/scripts/verify-build-env.js`: builds fail if `VITE_API_URL` is missing, uses HTTP, or points at localhost.

---

## 6. CI pipeline overview

Staged jobs on every PR to `main` (see `.github/workflows/ci.yml`):

| Stage | Job | Gate |
|:---|:---|:---|
| 1 | `lint` | Frontend ESLint |
| 2 | `backend-unit` | `npm run test:unit` |
| 3 | `backend-contract-static` | `npm run test:contracts` (deploy fingerprint, no DB) |
| 4 | `backend-integration` | Supabase + migrate + `test:contracts:db` + `test:integration` |
| 5 | `frontend` | `npm run test` + production build |

Regression and contract failures are **release blockers**. Milestone tests run in integration but the `milestones/` folder is frozen — new coverage belongs in `unit/`, `contracts/`, or `regression/` (see `backend/tests/README.md`).

---

## 7. Further reading

| Document | Topic |
|:---|:---|
| [`backend/tests/README.md`](../backend/tests/README.md) | Test ownership, decision tree, milestone policy |
| [`backend/tests/DEDUP_MAP.md`](../backend/tests/DEDUP_MAP.md) | Removed milestone tests → active replacements |
| [`.github/pull_request_template.md`](../.github/pull_request_template.md) | PR checklist |
| [`.github/workflows/production-smoke.yml`](../.github/workflows/production-smoke.yml) | Scheduled production probes |
