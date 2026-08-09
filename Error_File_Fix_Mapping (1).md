# SN Polymers IDBP — Error File Fix Mapping (08-08-2026)

Status legend: ✅ Fixed in this pass | 🔲 Pending (spec confirmed, not yet coded)

---

## 1. Zonal Control Room — Left Sidebar Overlap ✅

**Business ask:** Sidebar must not overlap main content; all text/buttons visible and aligned.

**Root cause:** In the flex layout, the sidebar's outer wrapper had no `shrink-0`, so under certain viewport widths the flex container could compress it while its fixed-width child (`w-20` rail) still rendered at full size — pushing it visually over the content pane instead of reserving its own column.

| File | Change |
|---|---|
| `frontend/src/components/Sidebar.jsx` | Outer wrapper `<div>` (rail + drawer container) — added `shrink-0` to `className="relative z-40 md:w-20"` |
| `frontend/src/components/AppLayout.jsx` | Content wrapper (`flex-grow flex flex-col ...`) and `<main>` — normalized to `z-0` (was `z-10`) so the sidebar rail/drawer (`z-40`) reliably paints above content instead of both competing at similar stacking levels |

**Verify:** Resize the browser through the `md` breakpoint (768px) and confirm the icon rail never compresses/overlaps the "Zonal Control Room" header or the drawer's text labels (Digital Twin Hub / Dark Mode / Sign Out / Privacy Policy).

---

## 2. Site Visit Inactivity Alert (Telegram) 🔲

**Business ask:** If a user doesn't upload a site-visit photo for 3 consecutive days, auto-send a Telegram alert to the concerned ZO and HO containing: Work Order No., Employee Name, Last Site Visit Date, and an explicit "not uploaded" message.

**Existing infra this hooks into:**

| Piece | File |
|---|---|
| Telegram send primitive (`sendMessage` via `TELEGRAM_API_BASE`) | `backend/src/services/telegram.service.js` |
| Existing daily-scheduler pattern to copy (1:00 PM streak reminder, self-rescheduling `setTimeout` loop) | `backend/src/services/streakNotification.service.js` |
| Daily progress / site-visit photo records | `backend/src/controllers/dailyProgress.controller.js` |

**What's needed (not yet built):**
1. New function `checkSiteVisitInactivity()` in a new/extended service (e.g. `siteVisitInactivity.service.js`), modeled on `streakNotification.service.js`'s scheduler pattern.
2. Query: for each active Work Order, find `MAX(site_visit_date)` from daily progress/photo logs; flag if `today - last_visit_date >= 3 days`.
3. Resolve concerned **ZO** and **HO** `telegram_chat_id` per work order (via the same zone/WO mapping tables `fundRequests.controller.js`/`requisitions.controller.js` already use for recipient lookup).
4. Compose message in the exact format specified in the error file:
   ```
   ⚠️ Site Visit Inactivity Alert
   Work Order: {wo_no}
   Employee: {employee_name}
   Last Site Visit: {last_visit_date}
   No site-visit photo has been uploaded for the last 3 days.
   Please check and take necessary action.
   ```
5. Register the new scheduler in `backend/src/app.js` alongside the streak reminder init call.

**Note:** The "Inactivity Warning: Stale Projects" panel shown in the screenshot (BAN01/BAN02/IRPUR02, "no logs in 7 days") is a *separate, already-existing* UI widget — confirm whether that 7-day/no-logs panel should also be wired to fire the same Telegram alert, or if only the 3-day/no-photo rule (item 2) is new. The error file only specifies the 3-day photo rule as new.

---

## 3. Work Order Number — Font Size & Boldness ✅

**Business ask:** WO number on estimate cards too small; increase size, make bold, keep card layout intact.

| File | Change |
|---|---|
| `frontend/src/pages/Estimates.jsx` (line ~268) | `WO: {est.work_order_no}` label — className changed from `text-[9px] font-bold` → `text-sm font-extrabold`. Card layout/alignment untouched. |

---

## 4. Fund Request Screen 🔲

### 4(a) Add "Work Order Value" and "Estimated Value" columns after "Work Order No."

**Current table columns** (`frontend/src/components/fundRequests/FundRequestTable.jsx`, line 18):
```
['FR Order No', 'Work Order No', 'Zonal Office', 'Requested Amount', 'Approved Amount', 'Request Date', 'Status', 'Actions']
```

**Needed:** insert `'Work Order Value'`, `'Estimated Value'` immediately after `'Work Order No'`, plus matching `<TableCell>` data cells (currently only `req.work_order_no` is rendered per row, ~line 46).

**Data source:**
- Work Order Value → Work Order master (same source `work-order-mappings` page reads).
- Estimated Value → Estimated Bill record's total estimated amount for that WO (`api/estimatedBillsApi.js` / `estimatesApi.js` — same table backing the "Total Estimate Amount" stat on the Zonal Control Room dashboard, ₹11.85L in the screenshot).
- Both should be joined server-side (or via a lookup map client-side, matching the pattern in `FundRequests.jsx`) so they load with the list rather than N+1 fetches per row.

### 4(b) Quick Filter — "Fund Request Not Sent to HO"

**Current filters** (`frontend/src/components/fundRequests/QuickFiltersSidebar.jsx`, line 9-13):
```js
{ key: 'myRequests', ... }
{ key: 'pendingOnly', ... }
{ key: 'approvedThisMonth', ... }
{ key: 'onHoldRequests', ... }
{ key: 'largeAmount', ... }
```

**Needed:** add `{ key: 'notSentToHo', label: 'Fund Request Not Sent to HO' }` to `checklistItems`, plus filtering logic in `pages/FundRequests.jsx` (where `filters` state and the `pendingOnly`/`largeAmount` predicates presumably already live) — show Work Orders with **zero** fund request records submitted to HO at all (distinct from "pending", which implies a request exists).

### 4(c) Quick Filter — "Remaining Fund Request"

**Needed:** add `{ key: 'remainingFundRequest', label: 'Remaining Fund Request' }`.

**Calculation logic (must match spec exactly):**
```
Remaining Fund Request Amount = Estimated Value − Total Fund Request Amount (Submitted/Approved)
```
- Show WO only if `Remaining Fund Request Amount > 0`.
- **Important:** base this on **Estimated Value**, not Work Order Value (easy bug to introduce given 4(a) adds both fields side by side).

**Files to touch:** `QuickFiltersSidebar.jsx` (add 2 checklist items), `pages/FundRequests.jsx` (filter predicates + wiring the Estimated Value figures pulled in from 4(a)).

---

## 5. RA / Final Bill Entry — "No RA Bill" Payment Type Filter 🔲

**Current dropdown** (`frontend/src/pages/RAFinalBill.jsx`, lines 965-967):
```jsx
<option value="">All Types</option>
<option value="RA Bill">RA Bills</option>
<option value="Final Bill">Final Bills</option>
```
Filter state wired via `payment_type` (init at line 79, passed to `getBills` as `filterType` at line 159).

**Needed:**
1. Add `<option value="__no_ra_bill">No RA Bill</option>` (using a sentinel value since `"No RA Bill"` isn't a real `payment_type` value stored on bill records — it's an absence filter, not a value filter).
2. This can't reuse the existing server-side `payment_type` passthrough as-is, because `getBills({ payment_type: filterType })` (line 159) expects a literal DB value. Needs one of:
   - **Client-side:** fetch full Work Order list + existing RA bills, then filter to WOs with zero RA bill records, when this option is selected — bypassing the normal `getBills` filter call.
   - **Server-side (cleaner):** extend `raFinalBillApi.js` / the backend bills controller with a `payment_type=no_ra_bill` special case that does a `NOT EXISTS` / anti-join against RA bill records per Work Order.
3. Result set for this filter is **Work Orders**, not bills — so this view likely needs to render differently from the normal bill-list table (it's "WOs missing a bill", not "bills matching a type"). Confirm with the existing "Projects Directory" tab (`currentTab === 'directory'`) since that already lists WOs — the "No RA Bill" filter may belong there rather than in the bill-list table.

---

## Summary Table

| # | Item | Screen | Status | Primary Files |
|---|---|---|---|---|
| 1 | Sidebar overlap | Zonal Control Room / global layout | ✅ Fixed | `Sidebar.jsx`, `AppLayout.jsx` |
| 2 | Site visit inactivity Telegram alert | Daily Progress / backend | 🔲 Pending | new service + `telegram.service.js`, `app.js` |
| 3 | WO number font size/bold | Estimates (cost estimate cards) | ✅ Fixed | `Estimates.jsx` |
| 4a | WO Value + Estimated Value columns | Fund Requests | 🔲 Pending | `FundRequestTable.jsx`, `FundRequests.jsx` |
| 4b | "Not Sent to HO" filter | Fund Requests | 🔲 Pending | `QuickFiltersSidebar.jsx`, `FundRequests.jsx` |
| 4c | "Remaining Fund Request" filter | Fund Requests | 🔲 Pending | `QuickFiltersSidebar.jsx`, `FundRequests.jsx` |
| 5 | "No RA Bill" payment type filter | RA / Final Bill Entry | 🔲 Pending | `RAFinalBill.jsx`, `raFinalBillApi.js` |
