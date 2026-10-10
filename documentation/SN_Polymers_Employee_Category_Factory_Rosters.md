# Employee categories and six factory attendance rosters

Client decision: 10 October 2026. This replaces the earlier six-category directory and four-sheet attendance scope.

| Employee category | Allowed department |
|---|---|
| HO Staff | Head Office |
| Fabric Factory Permanent Employees | Fabric Factory |
| Fabric Factory Casual Factory Labour | Fabric Factory |
| SNP Casual Factory Labour | SNP Factory |
| SNP Permanent Factory Labour | SNP Factory |
| Zonal Office | Projects |
| Junior Engineer | Projects |
| Local project supervisor | Projects |
| Head office | Projects or Head Office |
| Local Daily-Wage Workers | SNP Factory or Fabric Factory |

Employee categories describe employment assignments, not authorization roles. Linking an ERP account does not change its role. Employee maintenance and permanent pay structure maintenance remain Admin-only. The four specific Projects categories retain the previous Projects permanent-pay and self-service leave behavior; HO Staff retains its own identity.

Daily attendance uses **date + employee category + factory department**. Each factory has a Permanent, Casual, and Local roster, giving six groups per date. Local employees are selected by their Employee Master department. New rows require Active status and joining date on/before the sheet date. No employee may appear on two sheets for the same date. Refresh adds eligible employees without replacing recorded rows. Finish any open attendance sheets before changing an employee's category or department.

Permanent/Casual/Local behavior is the same in both factories. Fabric Casual uses the existing Casual wage/configuration and attendance/leave rules. Permanent employees use their permanent pay structures; Casual employees use effective-dated daily wage revisions. Both Local rosters use the same Local wage/rule category: unpaid leave, no holiday eligibility, explicit Single/Double Duty, and zero OT for Double Duty. Applicable revisions remain resolved by the attendance date. Existing configurable rates/multipliers and approval/locking rules are preserved. Fabric Casual needs an effective wage and pay-rule revision before submission; no example rates are seeded into production.

## Migration and historical compatibility

Migration `102_hr_category_department_factory_rosters.sql` expands category checks, enforces valid mapping for new or reclassified records, adds sheet department, and extends roster/review RPCs. Existing invalid directory mappings remain readable and can receive unrelated updates until Admin confirms the category/department. New onboarding cannot use the retired generic Projects category.

Existing `Projects Department Employees` records retain their UUIDs, pay structures, leave history, and audit history. They are not inferred from ERP roles. Admin selects a specific category during reclassification; the directory filter and edit screen retain the legacy category for this purpose.

Existing attendance sheets retain a null factory department and are displayed as legacy rosters. They are reused on their original date rather than split, relabelled, or duplicated. A historical combined Local sheet remains combined, with all original rows available. Calendar/review factory filters include these legacy sheets and label them accordingly. Newly created sheets always have a valid factory department, which is immutable after creation.

For old API/RPC consumers omitting department, the single-factory categories infer their only department and Local defaults to SNP Factory. The new UI explicitly sends the selected department, and factory identity is included in query keys, filters, dashboard links, and calendar deep links. Authorization remains FM/Admin for entry and HO/Admin for review. Sheet creation remains explicit.
