import React from 'react';
import Badge from '../ui/Badge';
import SalaryPreview from './SalaryPreview';

export default function PayrollPayslip({ payslip }) {
  if (!payslip) return null;

  const isOfficial = Boolean(payslip.official);

  return (
    <section className="glass-panel bg-slate-900/80 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 border border-white/10 print:bg-white print:text-black print:border-slate-300 print:rounded-none print:shadow-none print:p-8 print:space-y-6">
      {/* Company Header & Brand Banner */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-white/10 print:border-slate-300">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 print:border print:border-slate-400 print:bg-slate-100 print:text-slate-900 shrink-0">
            SN
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white print:text-slate-950">
              S. N. POLYMERS PVT. LTD.
            </h2>
            <p className="text-xs text-slate-400 print:text-slate-600 mt-0.5">
              {isOfficial ? 'Official Locked Salary Payslip' : 'Diagnostic Salary Preview — Not an Official Payslip'} · Private & Confidential
            </p>
            <p className="text-xs text-slate-400 print:text-slate-600 font-mono mt-1">
              {payslip.department} / {payslip.group_code} · {payslip.cycle} · Calculation revision {payslip.revision}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:items-end gap-2">
          {payslip.watermark && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wider border font-mono ${
                isOfficial
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 print:border-amber-400 print:text-amber-800'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400 print:border-rose-400 print:text-rose-800'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current" />
              {payslip.watermark}
            </span>
          )}
          <div className="flex items-center gap-2">
            <Badge variant={payslip.review_status === 'LOCKED' ? 'emerald' : 'amber'}>
              {payslip.review_status}
            </Badge>
            <Badge variant={payslip.payment_status === 'PAID' ? 'emerald' : 'slate'}>
              {payslip.payment_status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Snapshot Verification Notice */}
      <div
        className={`p-4 rounded-2xl border text-xs leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isOfficial
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 print:bg-slate-50 print:border-slate-300 print:text-slate-800'
            : 'bg-amber-500/10 border-amber-500/20 text-amber-300 print:bg-amber-50 print:border-amber-300 print:text-amber-900'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <svg className="w-5 h-5 shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <p>
            Review: {payslip.review_status} · Payment: {payslip.payment_status}.{' '}
            {isOfficial
              ? 'Immutable Locked financial snapshot. Statutory settlement is separate.'
              : 'Saved source evidence has not been revalidated.'}
          </p>
        </div>
      </div>

      {/* Source Error Banner */}
      {payslip.source_error && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3 print:border-rose-400 print:text-rose-900"
        >
          <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>Current sources unavailable: {payslip.source_error.message}</p>
        </div>
      )}

      {/* Core Calculation Breakdown */}
      <SalaryPreview preview={payslip.calculation} />

      {/* Physical Signature Signoff (Printed Payslip Only) */}
      {isOfficial && <div className="hidden print:grid grid-cols-2 gap-12 pt-10 border-t border-slate-300 text-xs text-slate-800">
        <div>
          <p className="font-bold">Prepared & Certified By:</p>
          <div className="mt-12 pt-2 border-t border-slate-400 text-[11px] text-slate-600">
            Accounts & HR Authorized Signatory
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold">Employee Acknowledgment:</p>
          <div className="mt-12 pt-2 border-t border-slate-400 text-[11px] text-slate-600">
            Signature / Date
          </div>
        </div>
      </div>}

      {/* Audit Footnote */}
      <div className="pt-4 border-t border-white/10 print:border-slate-300 flex flex-wrap items-center justify-between text-xs text-slate-400 print:text-slate-600 font-mono">
        <p>
          {isOfficial ? 'Locked' : 'Generated'}: {payslip.locked_at || payslip.generated_at} · Employee row: {payslip.row_id}
        </p>
        <p className="text-[11px] text-slate-500 print:text-slate-600">
          Electronic Audit Record · S. N. Polymers ERP
        </p>
      </div>
    </section>
  );
}
