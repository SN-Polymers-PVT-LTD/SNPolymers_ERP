# S. N. Polymers ERP — Factory Attendance, Leave & Wage Rules

**Document purpose:** Approved business rules / implementation reference  
**Scope:** Factory attendance, factory leave recording, wage-rule configuration, daily submission to HO, and self-service leave for HO/Projects employees  
**Updated:** 30 September 2026

## 1. Scope and operating model

The attendance module applies to the following four employee categories:

1. Fabric Factory Permanent Employees
2. SNP Permanent Factory Labour
3. SNP Casual Factory Labour
4. Local Daily-Wage Workers

HO Staff and Projects Department Employees do **not** use daily attendance in this module. They use self-service leave requests from their ERP profile, and approved leave is later used for salary deduction / payroll treatment.

The Factory Manager (FM) records factory attendance. HO reviews the completed daily category sheet, especially leave and exception entries.

## 2. Roles and ownership

| Role | Responsibility |
|---|---|
| Factory Manager | Maintains Factory Labour Wage Master; records daily factory attendance; enters Entry Timestamp and Exit Timestamp; decides Holiday Pay Eligibility; records factory-worker leave/remarks; submits the completed daily category sheet to HO. Actual Hours and OT Hours are calculated automatically by the ERP. |
| Factory Worker | Does not require an ERP login for attendance. Leave may be communicated to the Factory Manager outside the ERP. |
| HO / Approver | Reviews submitted factory sheets and leave/exception entries; approves or rejects leave where approval is required. |
| HO Staff / Projects Employee | Submits own leave requests from their ERP profile. |
| ERP / Payroll Engine | Applies approved wage/pay rules after attendance is reviewed and locked. It does not infer or invent attendance facts. |

## 3. Factory attendance entry

### 3.1 Daily entry view

The primary operational screen is a **Daily Attendance Entry** view.

The Factory Manager selects:

- Attendance Date
- Employee Category

The ERP loads all **Active** employees in that category.

Suggested row fields:

| Field | Behaviour |
|---|---|
| Employee ID | Read-only from Employee Master |
| Employee Name | Read-only |
| Attendance Status | Present / Absent / Medical Leave / Paid Leave / Unpaid Leave / Compensatory Off / Management Issue as applicable |
| Entry Timestamp | Entered by Factory Manager; full date and time |
| Exit Timestamp | Entered by Factory Manager; full date and time |
| Actual Hours | Auto-calculated by ERP from Entry Timestamp and Exit Timestamp |
| OT Hours | Auto-calculated by ERP using Actual Hours and the applicable Standard Duty Hours from the active rule master |
| Duty Type | Used for Local Daily-Wage Workers: Single Duty / Double Duty |
| Holiday Pay Eligible | Yes / No; Factory Manager decides for categories where holiday pay applies |
| Leave / Exception | Used when the day is a leave or other exception |
| Remarks | Free-text operational remarks |

**Entry Timestamp and Exit Timestamp are the approved attendance inputs for working days.** The ERP calculates Actual Hours and OT Hours automatically. Full timestamps must be stored so overnight / 24-hour duty is calculated correctly. For Absent / Leave / Compensatory Off rows, Entry and Exit may remain blank.

Approved calculation logic:

```text
Actual Hours = Exit Timestamp − Entry Timestamp
OT Hours = max(0, Actual Hours − Standard Duty Hours)
```

Example for an 8-hour category:

```text
Entry Timestamp: 28 Sep 2026, 08:00
Exit Timestamp:  28 Sep 2026, 18:00
Actual Hours:     10.00
OT Hours:          2.00
```

Example for overnight / 24-hour duty:

```text
Entry Timestamp: 28 Sep 2026, 08:00
Exit Timestamp:  29 Sep 2026, 08:00
Actual Hours:     24.00
```


### 3.2 Bulk entry

For fast entry, the Daily Attendance screen should support:

- Mark All Present
- Edit exceptions only
- Save Draft
- Submit Category Sheet to HO

The system must not silently mark employees Present without an explicit Factory Manager action.

## 4. Monthly calendar view

The Factory Manager also receives a monthly calendar-style review screen.

Example codes:

| Code | Meaning |
|---|---|
| P | Present |
| A | Absent |
| ML | Medical Leave |
| PL | Paid Leave |
| UL | Unpaid Leave |
| CO | Compensatory Off / Rest Day |
| MI | Management Issue / Work Stoppage |

Clicking a calendar cell opens the stored daily attendance details for that employee/date.

The calendar is primarily a **review / correction view**. The Daily Entry screen remains the primary bulk-entry screen.

## 5. Leave workflow

### 5.1 Factory employees

Factory workers may not have ERP accounts. Their leave is recorded by the Factory Manager.

Workflow:

```text
Worker informs Factory Manager
        ↓
Factory Manager records leave / exception
        ↓
Entry appears in the daily category sheet
        ↓
Factory Manager submits completed sheet to HO
        ↓
HO reviews leave / exception items
        ↓
Approved / Rejected
        ↓
Final attendance result is used for wage / salary calculation
```

A factory leave entry should contain:

- Employee
- Employee Category
- From Date
- To Date
- Leave Type
- Reason / Remarks
- Approval Status: Pending / Approved / Rejected
- Pay Treatment: Paid / Unpaid where applicable
- Recorded By
- Approved By
- Approval Date
- Approval Remarks

### 5.2 Medical leave documents

**No medical certificate, attachment, file URL, upload field, or document storage is required in the ERP.**

Medical certificates or supporting documents will be emailed to HO / management outside the ERP when required.

The ERP records only:

- Medical Leave
- Date range
- Remarks
- Approval status
- Pay treatment

### 5.3 HO Staff and Projects Department Employees

HO Staff and Projects Department Employees do not use factory attendance.

They submit leave themselves:

```text
Employee ERP Profile
        ↓
Leave
        ↓
Request Leave
        ↓
HO Leave Approval Queue
        ↓
Approve / Reject
        ↓
Leave Ledger
        ↓
Later payroll / salary deduction
```

The same company-wide leave engine can support both:
- `FACTORY_MANAGER` request source
- `SELF_SERVICE` request source

## 6. Daily sheet submission to HO

The Factory Manager submits attendance **by date and employee category**.

Examples:

- Fabric Factory Permanent Employees — 28 Sep 2026
- SNP Permanent Factory Labour — 28 Sep 2026
- SNP Casual Factory Labour — 28 Sep 2026
- Local Daily-Wage Workers — 28 Sep 2026

Suggested submission summary:

- Total Employees
- Present
- Absent
- Leave / Medical Leave
- Compensatory Off
- Management Issue
- Holiday Pay Eligible Count
- Total OT Hours (auto-calculated)
- Submitted By
- Submitted At
- HO Review Status
- HO Remarks

HO should not re-enter attendance. HO reviews the submitted sheet and the exception / leave items.

## 7. Factory Labour Wage Master

This master is for categories that do **not** use the Permanent Employee Pay Structure.

Applicable categories:

- SNP Casual Factory Labour
- Local Daily-Wage Workers

Suggested fields:

| Field | Purpose |
|---|---|
| Employee Category | Casual or Local Daily-Wage |
| Effective From | Start date of rate revision |
| Daily Wage | Base daily wage |
| Standard Duty Hours | Normal duty hours |
| OT Rate Method | Fixed Hourly / Derived from Daily Wage |
| OT Hourly Rate | Used where fixed |
| Double Duty Multiplier | Local labour only; default 2.0× |
| Status | Active / Superseded |
| Maintained By | Factory Manager |

Rates must be **effective-dated**. A new rate creates a new revision; old payroll periods must not change because a future rate changes.

Current starting references:

- SNP Casual Factory Labour: ₹400/day, 8 standard hours
- Local Daily-Wage Workers: ₹350/day, 12 standard hours
- Local Double Duty: default 2.0× daily wage

## 8. Factory Attendance & Pay Rule Master

This master controls how attendance facts affect pay. It is separate from the base wage master.

Suggested fields:

- Employee Category
- Effective From
- Standard Duty Hours
- OT Enabled
- OT Pay Method
- OT Multiplier / Fixed Rate
- Holiday Work Pay Enabled
- Holiday Pay Multiplier
- Management Stoppage Treatment
- Short-Hours Treatment
- Compensatory-Off Treatment
- Double Duty Multiplier where applicable
- Status

### Default rule direction

| Category | OT | Holiday Work | Double Duty |
|---|---|---|---|
| Fabric Factory Permanent Employees | Configurable; current guideline uses salary-derived hourly rate | Enabled; default 1.5× | Not applicable |
| SNP Permanent Factory Labour | Configurable; current guideline uses salary-derived hourly rate | Enabled; default 1.5× | Not applicable |
| SNP Casual Factory Labour | Configurable; current starting equivalent is ₹50/hour | Enabled; default 1.5× | Not applicable |
| Local Daily-Wage Workers | Derived from Daily Wage ÷ Standard Hours unless changed | Not applicable | Enabled; default 2.0× |

The Holiday Pay multiplier and Double Duty multiplier must be configurable, not hardcoded.

## 9. Category-specific attendance and leave rules

### 9.1 Permanent factory categories

Applies to:
- Fabric Factory Permanent Employees
- SNP Permanent Factory Labour

Business direction:

- Base salary comes from Permanent Employee Pay Structure.
- Factory Manager enters Entry Timestamp and Exit Timestamp; Actual Hours and OT Hours are auto-calculated by the ERP.
- Unapproved absence can cause one day salary deduction according to payroll policy.
- Approved medical / paid leave follows management approval and pay treatment.
- Holiday work uses the configured Holiday Pay multiplier; initial default 1.5×.
- Management-caused reduced hours / stoppage causes no deduction when marked accordingly.
- Approved 24-hour duty may record 16 OT hours where applicable.
- The next day after an approved 24-hour duty can be marked `CO` (Compensatory Off / Rest Day) with **no salary deduction**.

### 9.2 SNP Casual Factory Labour

Business direction:

- Base wage comes from Factory Labour Wage Master.
- Current starting reference: ₹400/day, 8 standard hours.
- Factory Manager enters Entry Timestamp and Exit Timestamp; Actual Hours and OT Hours are auto-calculated by the ERP.
- Absence = no wage for that day.
- Approved medical leave may be Paid or Unpaid according to management decision.
- Holiday work uses configured multiplier; initial default 1.5×.
- Management Issue / Work Stoppage can preserve full daily wage where approved.

### 9.3 Local Daily-Wage Workers

Business direction:

- Base wage comes from Factory Labour Wage Master.
- Current starting reference: ₹350/day, 12 standard hours.
- Factory Manager enters Entry Timestamp and Exit Timestamp; Actual Hours and OT Hours are auto-calculated by the ERP.
- Duty Type: Single Duty / Double Duty.
- Double Duty default = 2.0× daily wage, configurable.
- Leave is **unpaid**. There is no paid leave entitlement in the current approved direction.
- Holiday-work pay is **not applicable** for Local Daily-Wage Workers in the approved design.

## 10. Attendance sheet statuses

Suggested lifecycle:

```text
Draft
  ↓
Submitted to HO
  ↓
HO Reviewed
  ↓
Locked
```

If HO requires correction:

```text
Submitted to HO
  ↓
Returned for Correction
  ↓
Factory Manager corrects
  ↓
Resubmitted
```

Locked attendance must not be silently edited. Any reopening should be auditable.

## 11. Payroll boundary

This specification ends at reviewed / locked attendance and approved leave.

The later payroll module will consume:

```text
Permanent Pay Structure OR Factory Labour Wage Master
                    +
Factory Attendance & Pay Rule Master
                    +
Locked Attendance
                    +
Approved Leave
                    ↓
            Wage / Salary Calculation
```

Attendance entry must not directly store the final payable amount.

## 12. Out of scope for this approval

- Medical certificate upload or attachment storage
- Biometric attendance
- Bank/payment method capture
- Payment execution
- Salary advance processing
- Statutory contribution calculation
- Final payroll approval/payment workflow

