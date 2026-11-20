# Employee advance recovery — official Zoho/SAP research

Researched 12 October 2026. This is a design recommendation, not an implemented ledger or an approval of recovery limits. Salary payments/bank integration and ordinary loan products remain outside the agreed scope.

## Official documentation findings

- [Zoho India salary-advance FAQ](https://www.zoho.com/in/payroll/kb/employer/loans/does-zoho-payroll-handle-loans.html): salary advances are handled through Loans; payments already issued are recorded and recovered monthly. This FAQ specifically says the product does not issue those loan payments itself.
- [Zoho India Loans guide](https://www.zoho.com/in/payroll/help/employer/loans.html): records employee, amount, disbursement date, opening balance, reason, repayment start and installment. Supports external repayments, pause/resume with reasons, and restrictions on deleting records already involved in payroll. These are product capabilities, not new SN Polymers permissions.
- [Zoho release notes](https://www.zoho.com/in/payroll/whats-new/): the September 2024 loan-approval feature requires approval/disbursement before payroll inclusion; February 2020 added repayment skip/override. Its February 2026 negative-net consent feature conflicts with our confirmed negative-net block and will not be adopted.
- [SAP HCM Loans](https://help.sap.com/docs/ERP_HCM/e2456ce1796a44e7bf55811e67a03792/5618a753b9cfdb72e10000000a4450e5.html?locale=en-US&state=PRODUCTION&version=6.18.latest): infotype 0045 tracks balances, payroll/external payments and repayments separately; scheduled recovery reduces the balance and is reduced to the remaining balance when necessary. This is a technical pattern, not an India-specific legal limit.
- [SAP Employee Central compensation guide, section 11.2](https://help.sap.com/doc/080a7936d0f34b8dbbc2d2e8a76257fd/latest/en-US/SF_EC_Payments.pdf): provides one-time/recurring deductions linked to advance types, dates and history. A recurring deduction alone does not establish the verified advance balance; the balance ledger is still needed.

## Proposed SN Polymers contract

Accounts records an externally issued advance with evidence, employee identity and opening balance. HO approves its recovery plan: installment, starting contribution month and any permitted pause/override. This implements the approved employee adjustment ledger, not a new bank-payment or interest-bearing loan module.

Maintain distinct issued-advance and recovery events. A preview proposes a deduction; it does not reduce the outstanding balance. When a salary is financially Locked, atomically apply the approved recovery once, against the same employee's verified balance. Link the event to the salary snapshot and plan revision. Concurrent custom payroll runs must share the approved schedule-period allowance, rather than each collecting a full monthly installment.

Suggested recovery is the lesser of the approved schedule amount still available for that period and outstanding principal. Apply any additional approved/legal limits and retain the negative-net block. A smaller remaining balance can produce a smaller final installment; insufficient available salary must block or use an explicitly HO-approved change, never invent an automatic carry-forward or zero cap.

Corrections use linked compensating events and revised plans, preserving Locked salaries. Do not adopt Zoho pay-run reversion or SAP record deletion as permission to alter our immutable history. External repayments are a possible future capability, not activated by this report.

Illustration: advance ₹10,000; approved monthly recovery ₹3,000. With no other repayments or restrictions, recover ₹3,000 + ₹3,000 + ₹3,000 + ₹1,000. Two fortnightly runs in the first month share ₹3,000; they do not each recover ₹3,000.

## Remaining company choices

Approve a per-advance installment/start month and mandatory evidence/consent/reference requirements. Decide whether there is a company-wide recovery cap or only approved individual plans, subject to applicable legal limits. Vendor guides do not supply a universal percentage or document requirement. HO approval is already confirmed; no new statutory approval role is inferred from these sources.
