# Integrated Digital Business Platform (IDBP) Technical Reference
## Master Index & Executive Overview

S.N. Polymers Integrated Digital Business Platform (IDBP) is an enterprise-grade ERP system built to manage and automate business workflows across administrative offices, manufacturing divisions, and government-contracted infrastructure project sites. 

This multi-part documentation suite serves as the definitive architecture reference, operational guide, and developer manual for the platform.

---

## 1. Directory Structure

```
SNPolymers/                              ← Monorepo root
├── docs/                                ← Systems documentation suite (this directory)
│   ├── index.md                         ← Executive overview and index
│   ├── architecture.md                  ← System architecture & tech stack
│   ├── database.md                      ← Supabase DB schema, keys, and triggers
│   ├── backend.md                       ← REST API controllers & services reference
│   ├── frontend.md                      ← React Single Page Application design
│   ├── api.md                           ← Endpoint payload & response specification
│   ├── security.md                      ← Auth, rate limiting & session protection
│   ├── workflows.md                     ← Sequential business workflows & diagrams
│   ├── testing_performance.md           ← Testing suites & performance tuning
│   ├── deployment_operations.md         ← Deployment topology, CI/CD, and monitoring
│   └── standards_extension.md           ← Developer coding standards & extension guide
│
├── backend/                             ← Node.js + Express REST API
│   ├── src/
│   │   ├── app.js                       ← Express entrypoint
│   │   ├── db/
│   │   │   ├── supabase.js              ← DB client singleton
│   │   │   └── migrations/              ← SQL migrations 01-22
│   │   ├── routes/                      ← Auth, Admin, Estimates, Requisitions, etc.
│   │   ├── controllers/                 ← Request routers execution controllers
│   │   ├── validation/                  ← Zod input validation schemas
│   │   ├── middleware/                  ← Authentication & security handlers
│   │   └── services/                    ← WhatsApp, Telegram, OTP, and session logic
│   ├── tests/
│   │   └── milestones/                  ← Milestone validation tests (P1 to P5)
│   └── package.json
│
├── frontend/                            ← React 19 + Vite SPA
│   ├── vite.config.js                   ← Build bundler configuration
│   ├── tailwind.config.js               ← Styling design system definitions
│   └── src/
│       ├── main.jsx                     ← Mount entry point
│       ├── App.jsx                      ← Router definition
│       ├── index.css                    ← Tailwind directives + Glassmorphic components
│       ├── api/                         ← Axios instances
│       ├── components/                  ← Shared contexts, guards, and headers
│       └── pages/                       ← Pages (Estimates, DailyProgress, etc.)
│
├── README.md                            ← Setup and launch guide
└── .gitignore
```

---

## 2. Table of Contents

Navigate the documentation parts:

* **[Part 1: Master Index & Executive Overview](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/index.md)**: Repository Layout, purpose, directory ownership, and overall systems summary.
* **[Part 2: High-Level Architecture](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/architecture.md)**: Monorepo design, frontend and backend patterns, technology stack selections, configuration variables, and systems topologies.
* **[Part 3: Database Schema & Engine](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/database.md)**: Supabase PostgreSQL tables DDL, relations, constraints, custom triggers, row level security, and audits logging.
* **[Part 4: Backend Internals](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/backend.md)**: API Controllers, services (Telegram/OTP/Alerts), Middlewares, input validations (Zod), and helper utilities.
* **[Part 5: Frontend Single Page Application](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/frontend.md)**: SPA architecture, client routing, global AuthContext, pages layouts, and components.
* **[Part 6: API Specifications Reference](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/api.md)**: Complete request-response specs, schemas, parameters, responses, validation requirements, and status codes.
* **[Part 7: Authentication & Security Controls](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/security.md)**: HTTP-only cookies, session validations, JWT lifecycles, Telegram setup, OTP security policies, and rate limits.
* **[Part 8: Business Workflows Diagrams](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/workflows.md)**: Step-by-step lifecycles for logins, estimate approvals, requisitions, daily progress logs, and mutability locks.
* **[Part 9: Testing & Performance Optimization](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/testing_performance.md)**: Verification test pipelines (22 integration scripts), database indexes, caching plans, and optimizations.
* **[Part 10: Infrastructure, Deployment & Operations](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/deployment_operations.md)**: Hosting platforms (Render, Vercel, Supabase), health checks, logging analysis, backups, and recovery steps.
* **[Part 11: Developer Extension Guide & Coding Standards](file:///home/zenoguy/Desktop/projects/SNPolymers/docs/standards_extension.md)**: Best practices, code styles, and guides to adding new endpoints, tables, pages, and roles.
