import React, { useMemo } from 'react';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

/**
 * Purely client-side projection (design doc §5b): master balance minus
 * already-approved deductions minus the running total of the current Open
 * sheet's not-yet-submitted rows for the same bank. No dedicated backend
 * endpoint for this — computed from data already fetched for the page.
 */
const BankBalanceBanner = ({ bankBalance, lineItems = [] }) => {
  const { approvedDeducted, openSheetRunningTotal, projected } = useMemo(() => {
    if (!bankBalance) return { approvedDeducted: 0, openSheetRunningTotal: 0, projected: null };

    const bankName = bankBalance.bank_name;
    const approved = lineItems
      .filter(i => i.debit_bank_ac_type === bankName && ['Approved', 'Partially Approved'].includes(i.requisition_status))
      .reduce((sum, i) => sum + Number(i.ho_pass_amount || 0), 0);

    const openRunning = lineItems
      .filter(i => i.debit_bank_ac_type === bankName && i.requisition_status == null)
      .reduce((sum, i) => sum + Number(i.req_amount || 0), 0);

    const remaining = Number(bankBalance.available_balance) - approved;
    return { approvedDeducted: approved, openSheetRunningTotal: openRunning, projected: remaining - openRunning };
  }, [bankBalance, lineItems]);

  if (!bankBalance) return null;

  return (
    <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-[#0d131f]/90 flex flex-wrap items-center gap-6">
      <div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">{bankBalance.bank_name}</span>
        <p className="text-lg font-extrabold text-slate-100">{formatCurrency(bankBalance.available_balance)}</p>
      </div>
      <div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">After Approved Deductions</span>
        <p className="text-sm font-bold text-emerald-400">{formatCurrency(bankBalance.available_balance - approvedDeducted)}</p>
      </div>
      <div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Projected After Open Sheet</span>
        <p className="text-sm font-bold text-amber-400">{formatCurrency(projected)}</p>
      </div>
    </div>
  );
};

export default BankBalanceBanner;
