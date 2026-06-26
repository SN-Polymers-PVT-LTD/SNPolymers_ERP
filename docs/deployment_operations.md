# Part 10: Infrastructure, Deployment & Operations
## S.N. Polymers IDBP System Operations Reference

This document maps hosting services, CI/CD pipelines, logging setups, and database backup routines.

---

## 1. Hosting Infrastructure

The IDBP is hosted across three cloud platforms:

| Component | Platform | Configuration | URL |
|:---|:---|:---|:---|
| **Frontend Web app** | **Vercel** | SPA build, environment injection, auto-deploys on commit | `https://sn-polymers.vercel.app/` |
| **Backend REST API** | **Render** | Node.js web service, CORS whitelists, env injection | `https://snpolymers.onrender.comhealth` |
| **Database & Storage** | **Supabase** | Managed PostgreSQL, secure private buckets | *(Private connection pool)* |

---

## 2. Health Monitoring & Logs Analysis

### Server Liveness Checks
The backend exposes a `/health` endpoint returning server stats:
```json
{
  "status": "OK",
  "timestamp": "2026-06-27T03:32:00.000Z"
}
```
Ping checks are executed at 5-minute intervals to prevent Render instances from sleeping.

### Audit Trails
All CRUD operations on critical business tables (`fund_reports`, `projects_master`, `requisitions`, `daily_progress_reports`) are audited via database triggers. Admins can view these logs directly in the **Audit Trail Logs** panel of the Admin section.

---

## 3. Database Backups & Recovery

### Auto-Backups
* Supabase executes daily database backups automatically.
* Key ledger data (estimates, requisitions, daily progress logs) are protected from hard deletes using the database rule triggers `prevent_requisition_hard_delete` and `prevent_daily_progress_hard_delete`. This ensures history is preserved even during application failures.

### Disaster Recovery
To rebuild the database environment from scratch:
1. Initialize a new PostgreSQL database instance on Supabase.
2. Execute migration files sequentially from the directory `backend/src/db/migrations/` (from `01` to `22`).
3. Set the new database credentials inside Render's environment dashboard.
4. Manually configure the private storage buckets `payment-requisitions-pdfs` and `daily-progress-photos` in the Supabase storage dashboard.
