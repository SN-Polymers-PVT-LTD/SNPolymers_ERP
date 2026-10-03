# Frontend Agent Instructions

The frontend uses React, Vite, Tailwind, React Router, TanStack Query, and the authenticated `authApi` client. Keep API wrappers thin and business rules in backend/database layers.

Reuse shared components from `src/components/ui` and established pages for tables, selects, pagination, modals, loading states, errors, and success feedback. Avoid introducing a parallel design system.

Frontend route/button visibility must match backend roles, but is not a security boundary. Use canonical IDs for selections and invalidate server-state caches after writes. Handle loading, empty, error, success, inactive, and pagination states explicitly.

When changing routes or navigation, check direct navigation and Sidebar behavior for JE/ZO/HO/Admin/Accounts. Run the available frontend build/test/lint commands and verify form state transitions, clearing/reselection, and empty optional values.
