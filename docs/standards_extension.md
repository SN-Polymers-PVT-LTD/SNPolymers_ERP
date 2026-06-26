# Part 11: Developer Extension Guide & Coding Standards
## S.N. Polymers IDBP Developer Standards

This document establishes style conventions and guides for extending the platform with new database tables, routes, pages, and components.

---

## 1. Coding Standards

### Style Conventions
* **Javascript Style**: Standard ES6 syntax. Recommends camelCase for variables and functions (`requestOtp`, `verifyOtp`), UPPER_SNAKE_CASE for environment configurations (`JWT_SECRET`), and PascalCase for React component names (`DailyProgress`, `ProtectedRoute`).
* **Database Conventions**: lowercase snake_case for PostgreSQL tables and column identifiers (`work_order_no`, `otp_requests`, `authorised_users`).
* **HTML/CSS Design**: Use semantic HTML5 blocks (`<main>`, `<header>`, `<nav>`, `<aside>`). UI styling must use Tailwind utility tokens and conform to the custom glassmorphism directives (`.glass-panel`, `.glass-input`) declared in `index.css`.

### Security Rules
* All modifications to financial data or progress ledgers must check if the linked project is **Active** (not **Closed**).
* Client routes must be gated using the appropriate role arrays on the `ProtectedRoute` layout.
* Credentials and secrets must be loaded using the config files via `process.env`. Never hardcode keys or tokens.

---

## 2. Platform Extension Guides

### 2.1 Adding a New Database Table
1. Define a SQL migration file in `backend/src/db/migrations/` using a sequential numbering prefix (e.g. `23_create_new_table.sql`).
2. Implement custom triggers to block hard deletions (`DELETE`) on historical logs, forcing status state changes instead.
3. Configure audit log triggers targeting the table to log inserts and updates automatically to the `audit_log` table.
4. Execute the SQL migration file on the target database instance.

### 2.2 Adding a New Backend API Route
1. Define the input schemas inside the directory `backend/src/validation/` utilizing `zod`.
2. Add a new router module in `backend/src/routes/` (e.g. `newFeature.routes.js`).
3. Gate all protected routes using the `verifyJwt` middleware. Add the role check middleware `requireRole(['admin', 'zo'])` if required.
4. Mount the new router in `backend/src/app.js`:
   ```javascript
   const newFeatureRoutes = require('./routes/newFeature.routes');
   app.use('/api/v1/auth/new-feature', newFeatureRoutes);
   ```

### 2.3 Adding a New Frontend Page
1. Add a new page view file in `frontend/src/pages/` (e.g. `NewFeature.jsx`).
2. Add routing configurations in `frontend/src/App.jsx`:
   ```jsx
   <Route element={<ProtectedRoute allowedRoles={['admin', 'zo']} />}>
     <Route path="/new-feature" element={<NewFeature />} />
   </Route>
   ```
3. Update `frontend/src/components/Sidebar.jsx` to render navigation links in the dashboard sidebar menu, dynamically filtering links based on the user's role:
   ```javascript
   ...(['admin', 'zo'].includes(user?.role) ? [
     {
       to: '/new-feature',
       label: 'New Feature Menu',
       icon: <svg>...</svg>
     }
   ] : [])
   ```
