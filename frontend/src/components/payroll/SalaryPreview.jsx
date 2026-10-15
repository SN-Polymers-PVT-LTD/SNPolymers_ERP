import React from 'react';
import Badge from '../ui/Badge';

const formatINR = (value) => {
  if (value === null || value === undefined || value === '') return null;
  // Format authoritative decimal strings without binary arithmetic or rounding.
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return String(value);
  const [, sign, integer, fraction = ''] = match;
  const grouped = integer.length > 3
    ? `${integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${integer.slice(-3)}`
    : integer;
  return `${sign}₹${grouped}.${fraction.padEnd(2, '0')}`;
};

export default function SalaryPreview({ preview, children }) {
  const contracts = (preview.monthly_reconciliation || []).flatMap((m) =>
    (m.contract_diagnostics || []).map((c) => ({ ...c, salary_month: m.salary_month }))
  );

  const formattedGross = formatINR(preview.gross_after_lop);
  const formattedNet = formatINR(preview.final_net_salary);
  const financialComplete = preview.financial_readiness === true;
  const employerTotal = financialComplete ? preview.employer_contributions_total : null;
  const formattedEmployer = formatINR(employerTotal);

  return (
    <section className="space-y-6 text-slate-100 print:text-slate-900">
      {/* Employee Header & Status Card */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white/[0.03] border border-white/10 print:border-slate-300 print:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 print:border-slate-400 print:text-slate-800 flex items-center justify-center font-bold text-sm">
              EMP
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white print:text-slate-950">
                {preview.employee.employee_name} / {preview.employee.employee_code}
              </h2>
              <p className="text-xs text-slate-400 print:text-slate-600 mt-0.5">
                {preview.status} · {preview.period_from} – {preview.period_to}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={preview.status === 'READY_FOR_REVIEW' || preview.status === 'LOCKED' ? 'emerald' : 'amber'}
            showDot
          >
            {preview.status}
          </Badge>
          <span className="text-xs font-mono px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 print:border-slate-300 print:text-slate-700">
            {preview.period_from} to {preview.period_to}
          </span>
        </div>
      </div>

      {/* KPI Stats Highlights Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 print:border-slate-300 print:bg-white shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 print:text-slate-600 block mb-1">
            Gross Earnings (After LOP)
          </span>
          <div className="text-2xl font-black font-mono text-white print:text-slate-950">
            {formattedGross || (preview.gross_after_lop ?? 'Blocked')}
          </div>
          <span className="text-[11px] text-slate-400 print:text-slate-600 mt-1 block">
            Contractual basis adjusted for leaves
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 print:border-slate-300 print:bg-emerald-50 shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 print:text-emerald-800 block mb-1">
            Calculated Net Salary
          </span>
          <div className="text-2xl font-black font-mono text-emerald-300 print:text-emerald-950">
            {formattedNet || (preview.final_net_salary ?? 'unavailable')}
          </div>
          <span className="text-[11px] text-emerald-400/80 print:text-emerald-800 mt-1 block">
            Salary review and payment status remain separate
          </span>
        </div>

        {preview.employer_contributions_total && (
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 print:border-slate-300 print:bg-white shadow-sm sm:col-span-2 lg:col-span-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 print:text-slate-600 block mb-1">
              Employer Statutory Total
            </span>
            <div className="text-2xl font-black font-mono text-slate-200 print:text-slate-900">
              {formattedEmployer ?? 'unavailable'}
            </div>
            <span className="text-[11px] text-slate-400 print:text-slate-600 mt-1 block">
              Calculated employer contributions; statutory settlement is separate
            </span>
          </div>
        )}
      </div>

      {/* Contract text preserved for test assertions */}
      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 print:border-slate-200 text-xs text-slate-400 print:text-slate-700 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Gross after LOP: {preview.gross_after_lop ?? 'Blocked'} · Final net: {preview.final_net_salary ?? 'unavailable'}
        </p>
        {preview.employer_contributions_total && (
          <p className="text-slate-400 print:text-slate-600">
            Employer contributions: {employerTotal ?? 'unavailable'} (separate from employee deductions).
          </p>
        )}
      </div>

      {children}

      {/* Employee Beneficiary Card */}
      {preview.beneficiary && (
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/20 to-slate-900/40 border border-indigo-500/20 print:border-slate-300 print:bg-slate-50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-xs uppercase tracking-wider text-indigo-300 print:text-slate-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-400 print:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Employee beneficiary
            </h3>
            <Badge variant={preview.beneficiary.status === 'RECORDED' ? 'emerald' : 'amber'}>
              {preview.beneficiary.status}
            </Badge>
          </div>

          {preview.beneficiary.status === 'MISSING' ? (
            <p className="text-xs text-amber-400 print:text-amber-700 font-medium">
              Beneficiary details missing — update Employee Management.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-600 block">Beneficiary Name</span>
                <span className="text-xs font-semibold text-slate-200 print:text-slate-900">{preview.beneficiary.beneficiary_name}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-600 block">Account Number</span>
                <span className="text-xs font-mono font-bold text-amber-400 print:text-amber-800">{preview.beneficiary.masked_account_number}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-600 block">IFSC Code</span>
                <span className="text-xs font-mono text-slate-200 print:text-slate-900">{preview.beneficiary.ifsc}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-600 block">Bank Name</span>
                <span className="text-xs font-semibold text-slate-200 print:text-slate-900">{preview.beneficiary.bank_name || 'Bank missing'}</span>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-white/5 print:border-slate-200 flex flex-wrap justify-between items-center text-[11px] text-slate-400 print:text-slate-600">
            <p>{preview.beneficiary.status} · {preview.beneficiary.beneficiary_name} · {preview.beneficiary.masked_account_number} · {preview.beneficiary.ifsc} · {preview.beneficiary.bank_name || 'Bank missing'}</p>
            <p className="italic">Recorded setup only; this does not verify or authorize a payment.</p>
          </div>
        </div>
      )}

      {/* Earnings and Deductions Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {['earnings', 'deductions'].map((kind) => {
          const isEarnings = kind === 'earnings';
          const items = preview[kind] || [];
          const unresolvedLines = items.some(item => item.amount == null);
          const totalKindAmount = unresolvedLines ? null : isEarnings
            ? preview.earnings_total ?? preview.known_earnings_total
            : preview.deductions_total;
          const complete = !unresolvedLines && (isEarnings
            ? preview.gross_after_lop != null
            : financialComplete);
          const totalLabel = unresolvedLines || complete ? 'Total' : `Known ${kind === 'earnings' ? 'earnings' : 'deduction'} subtotal`;

          return (
            <div
              key={kind}
              className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 print:border-slate-300 print:bg-white flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-white/10 print:border-slate-200 mb-3">
                  <h3 className="font-bold capitalize text-sm text-white print:text-slate-900 flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isEarnings ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    {kind}
                  </h3>
                  {items.length > 0 && (
                    <span className="text-xs font-mono font-bold text-slate-300 print:text-slate-800">
                      {totalLabel}: {formatINR(totalKindAmount) ?? 'unavailable'}
                    </span>
                  )}
                </div>

                {!items.length ? (
                  <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 print:border-slate-200 text-xs text-slate-400 print:text-slate-600">
                    No calculated {kind} lines.{' '}
                    {preview.financial_readiness
                      ? 'Configured deductions are complete.'
                      : 'Statutory deductions remain unresolved.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/5 print:border-slate-200 text-[10px] uppercase font-bold text-slate-400 print:text-slate-600">
                          <th className="py-2 pr-2">Line</th>
                          <th className="py-2 px-2">Date / month</th>
                          <th className="py-2 px-2 text-right">Amount</th>
                          <th className="py-2 pl-3">Source references</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 print:divide-slate-200">
                        {items.map((l, i) => (
                          <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-2.5 pr-2 font-mono font-bold text-slate-200 print:text-slate-900">
                              {l.code}
                            </td>
                            <td className="py-2.5 px-2 text-slate-400 print:text-slate-600 font-mono">
                              {l.date || l.salary_month}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-bold text-white print:text-slate-950">
                              {l.amount ?? 'Rounding unresolved'}
                            </td>
                            <td className="py-2.5 pl-3 text-slate-400 print:text-slate-600 text-[11px] font-mono break-all">
                              {l.source_ids.join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Agreed Salary Components */}
      {!!contracts.length && (
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/10 print:border-slate-300 print:bg-white space-y-3">
          <h3 className="font-bold text-sm text-white print:text-slate-900">
            Agreed salary components (evidence only)
          </h3>
          <p className="text-xs text-slate-400 print:text-slate-600">
            Components describe the agreed total and are included in base earnings when allocated. They are not additional earnings.
          </p>
          <div className="space-y-3 pt-2">
            {contracts.map((c) => (
              <div
                key={`${c.salary_month}:${c.pay_structure_id}`}
                className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 print:border-slate-200 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-slate-300 print:text-slate-800">
                  <p>
                    {c.salary_month} · {c.pay_basis} · Agreed amount: {c.agreed_amount} · Pay source: {c.pay_structure_id}
                  </p>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {Object.entries(c.components || {}).map(([code, value]) => (
                    <div key={code} className="p-2 rounded-lg bg-black/20 print:bg-slate-100">
                      <dt className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-600">{code}</dt>
                      <dd className="font-mono font-bold text-slate-200 print:text-slate-900 text-xs">
                        {value ?? 'Unspecified'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calculation Blockers */}
      {preview.blockers && preview.blockers.length > 0 && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 print:border-amber-300 print:bg-amber-50 space-y-3">
          <h3 className="font-bold text-sm text-amber-400 print:text-amber-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Calculation blockers
          </h3>
          <ul className="space-y-1.5 text-xs text-amber-300 print:text-amber-900">
            {preview.blockers.map((b, i) => (
              <li key={i} className="flex items-center gap-2 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                {b.date ? `${b.date}: ` : ''}
                {b.code}
                {b.field ? ` / ${b.field}` : ''}
                {b.responsible_team ? ` — ${b.responsible_team}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Diagnostic & Technical Collapsible Drawers */}
      <div className="space-y-3 pt-2 print:hidden">
        <details className="group rounded-2xl bg-white/[0.02] border border-white/10 p-4 transition-colors hover:border-white/20">
          <summary className="cursor-pointer font-bold text-xs uppercase tracking-wider text-slate-300 flex items-center justify-between select-none">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              Monthly reconciliation
            </span>
            <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <pre className="mt-3 p-3.5 bg-black/50 rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto border border-white/5">
            {JSON.stringify(preview.monthly_reconciliation, null, 2)}
          </pre>
        </details>

        <details className="group rounded-2xl bg-white/[0.02] border border-white/10 p-4 transition-colors hover:border-white/20">
          <summary className="cursor-pointer font-bold text-xs uppercase tracking-wider text-slate-300 flex items-center justify-between select-none">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Statutory readiness and enrolment
            </span>
            <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <pre className="mt-3 p-3.5 bg-black/50 rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto border border-white/5">
            {JSON.stringify({ rules: preview.statutory, enrolment: preview.enrolment }, null, 2)}
          </pre>
        </details>

        <details className="group rounded-2xl bg-white/[0.02] border border-white/10 p-4 transition-colors hover:border-white/20">
          <summary className="cursor-pointer font-bold text-xs uppercase tracking-wider text-slate-300 flex items-center justify-between select-none">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Policy revisions, source references and configuration warnings
            </span>
            <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <pre className="mt-3 p-3.5 bg-black/50 rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap break-all overflow-x-auto border border-white/5">
            {JSON.stringify(
              {
                fingerprint: preview.source_fingerprint,
                sources: preview.source_references,
                warnings: preview.configuration_warnings
              },
              null,
              2
            )}
          </pre>
        </details>
      </div>
    </section>
  );
}
