# S.N. Polymers Pvt. Ltd. — Role Permissions Matrix

This document maps all the functions and modules of the Integrated Digital Business Platform (IDBP) to the active system roles.

> [!WARNING]
> The **Staff** role has been officially **deprecated** and removed from the active system access profiles. All operational personnel should be mapped to one of the four active roles detailed below.

## Role Keys
* **JE**: Junior Engineer (Field operations & site monitoring)
* **ZO**: Zonal Office (Regional manager & intermediate reviewer)
* **HO**: Head Office (Executive approver & financial control)
* **Admin**: System Administrator (Full platform configuration & compliance)

## Access Levels
* **✅ Full Access**: Can create, edit, delete (where permitted by system constraints), and submit.
* **👁️ View Only**: Can view data, details, list grids, and charts but cannot perform modifications or submit changes.
* **❌ No Access**: Module or action is completely hidden from the user interface and blocked by server-side route guards.

---

## Matrix Table

| Module & Functional Actions | Junior Engineer (JE) | Zonal Office (ZO) | Head Office (HO) | Administrator (Admin) |
| :--- | :---: | :---: | :---: | :---: |
| **Authentication & Profile Setup** | | | | |
| Mobile number entry & OTP authentication | ✅ | ✅ | ✅ | ✅ |
| Telegram notification linkage setup | ✅ | ✅ | ✅ | ✅ |
| Change color theme (Dark/Light mode) | ✅ | ✅ | ✅ | ✅ |
| **Console Dashboard** | | | | |
| View Project Status metrics (Total, Running, Closed) | ✅ | ✅ | ✅ | ✅ |
| View Cost Estimates statistics | ✅ | ✅ | ✅ | ✅ |
| View Recent Activity feed | ✅ | ✅ | ✅ | ✅ |
| **Material Master** | | | | |
| Browse material categories & list catalog | ✅ | ✅ | ✅ | ✅ |
| Search, filter, and sort materials | ✅ | ✅ | ✅ | ✅ |
| Export catalog items to Excel sheet | ✅ | ✅ | ✅ | ✅ |
| Create, edit, or toggle status of materials | ❌ | ❌ | ❌ | ✅ |
| **Cost Estimates** | | | | |
| View estimates list & individual sheets | ✅ | ✅ | ✅ | ✅ |
| Create new estimate draft & submit for review | ✅ | ❌ | ❌ | ✅ |
| Edit own draft or revision-requested sheets | ✅ | ❌ | ❌ | ✅ |
| Review & intermediate approve (ZO stage) | ❌ | ✅ | ❌ | ✅ |
| Review & final approve (HO stage) | ❌ | ❌ | ✅ | ✅ |
| Request revision (from ZO or HO stage) | ❌ | ✅ | ✅ | ✅ |
| **Payment Requisitions** | | | | |
| View requisition records & invoices | ✅ | ✅ | ✅ | ✅ |
| Create payment requisition & upload invoice PDF | ✅ | ✅ | ✅ | ✅ |
| Delete requisition record | ❌ | ❌ | ❌ | ✅ |
| **Daily Work Progress** | | | | |
| View daily progress reports & site history | ✅ | ✅ | ✅ | ✅ |
| Log new site visit, progress %, and upload photo | ✅ | ❌ | ❌ | ✅ |
| Edit/add authority evaluation remarks | ❌ | ✅ | ✅ | ✅ |
| **Fund Requests** | | | | |
| View fund requests ledger, charts, & gauges | ❌ | ✅ | ✅ | ✅ |
| Create new fund request for a project | ❌ | ✅ | ❌ | ✅ |
| Cancel own pending fund request | ❌ | ✅ | ❌ | ✅ |
| Review, approve, or place request on Hold | ❌ | ❌ | ✅ | ✅ |
| **RA & Final Bills** | | | | |
| View running bills ledger & summary statistics | ❌ | ✅ | ✅ | ✅ |
| Create, calculate, and submit sequential bills | ❌ | ✅ | ❌ | ✅ |
| Upload final/signed copies of billing files | ❌ | ✅ | ❌ | ✅ |
| **Administration Console** | | | | |
| Access Admin Panel dashboard & menu links | ❌ | ❌ | ❌ | ✅ |
| Add new users to authorized whitelist | ❌ | ❌ | ❌ | ✅ |
| Edit user roles, display names, and active status | ❌ | ❌ | ❌ | ✅ |
| Reset user Telegram webhook link | ❌ | ❌ | ❌ | ✅ |
| Manage global Master Data & Purchase Options | ❌ | ❌ | ❌ | ✅ |
| Inspect global System Audit Logs (Audit Trail) | ❌ | ❌ | ❌ | ✅ |

---

## Important Security Rules & System Constraints
1. **Immutable Billing Records**: Once a Running Account (RA) or Final Bill is created and registered in the database, it cannot be modified or deleted by *any* user (including Admins) to maintain audit compliance.
2. **Sequential Billing Enforcement**: Bill $N$ cannot be registered unless bill $N-1$ has already been created. The system verifies this sequence programmatically.
3. **Revision Deadlines**: When a revision is requested on a Cost Estimate, the system displays a live countdown timer. If the deadline expires before submission, the form locks down automatically for all non-admin roles.
4. **Server-Side Security Verification**: The frontend interface hides elements and routes based on roles, but the backend Express.js server inspects all incoming JWT requests to enforce the permissions outlined in the table above.
