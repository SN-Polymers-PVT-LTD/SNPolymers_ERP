# Part 5: Frontend Single Page Application
## S.N. Polymers React 19 SPA Architecture Reference

This document provides details of the frontend architecture, state management, client routing, pages, and UI components.

---

## 1. Application Layout & Routing

The frontend is built as a Single Page Application (SPA) utilizing `react-router-dom` (v6 data router). Access control is enforced client-side via a nested `ProtectedRoute` layout component.

```
       +------------------------------------+
       |              App.jsx               |
       +-----------------+------------------+
                         |
           +-------------+-------------+
           |                           |
           v                           v
+--------------------+      +--------------------+
|   Public Routes    |      |  Protected Routes  |
|  (/, /login, etc.) |      |   (Dashboard...)   |
+--------------------+      +----------+---------+
                                       |
                                       v
                            +--------------------+
                            |  ProtectedRoute.jsx|
                            +--------------------+
```

### Route Index
* `/`: Public landing page.
* `/login`: Public login form.
* `/link-telegram`: Public Telegram setup instructions page.
* `/verify-otp`: Public OTP verification form.
* `/dashboard`: Protected landing console (all authenticated roles).
* `/materials`: Protected Material Master Catalog list page.
* `/estimates`: Protected Zonal Cost Estimate builder.
* `/requisitions`: Protected payment request panel.
* `/daily-progress`: Protected site progress timeline and ledger.
* `/fund-reports`: Protected disbursement ledger.
* `/admin`: Admin-only Operator Whitelist management.
* `/admin/purchase-options`: Admin-only procurement vendor management.
* `/admin/master-data`: Admin-only catalog version manager.
* `/admin/sessions`: Admin-only session audit history log.

---

## 2. Authentication & State Context

### `AuthContext.jsx`
Manages global session state across page refreshes.
* **Initialization**: On mount, calls `GET /api/v1/auth/me`. If a valid HTTP-only cookie token is present, the server returns the user profile, setting the `user` context variable.
* **Logout Flow**: Calls `POST /api/v1/auth/logout` to terminate the session on the backend, clears local user state to `null`, and redirects the user to the landing page.

---

## 3. Styling & Custom Design Tokens

The styling system is configured in `tailwind.config.js` to match corporate dark-mode guidelines.

### Glassmorphism CSS Utilities
Global custom styles are defined in `index.css` to build translucent panels:
```css
/* Glass panel definition */
.glass-panel {
  background: rgba(21, 28, 44, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

/* Translucent form input */
.glass-input {
  background: rgba(11, 15, 25, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.07);
  color: #f8fafc;
}
.glass-input:focus {
  border-color: rgba(245, 158, 11, 0.55); /* Amber focus ring */
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.15);
}
```
All dashboards use standard amber hover states (`hover:bg-amber-500/10`) to highlight interactive elements.
