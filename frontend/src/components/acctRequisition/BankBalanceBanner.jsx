import React, { useMemo } from 'react';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

/**
 * bankBalance.available_balance is now a live running total — HO approval/
 * partial-approval decrements it directly (migration 025), so it already
 * reflects every approved payout across every sheet for this bank, not just
 * the current one. Only the not-yet-submitted rows on the currently-open
 * sheet remain a genuine client-side projection, since those haven't reached
 * HO yet and so can't be reflected in the stored balance.
 */
const BankBalanceBanner = ({ bankBalance, lineItems = [] }) => {
  const projected = useMemo(() => {
    if (!bankBalance) return null;

    const bankName = bankBalance.bank_name;
    const openRunning = lineItems
      .filter(i => i.debit_bank_ac_type === bankName && i.requisition_status == null)
      .reduce((sum, i) => sum + Number(i.req_amount || 0), 0);

    return Number(bankBalance.available_balance) - openRunning;
  }, [bankBalance, lineItems]);

  if (!bankBalance) return null;

  return (
    <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-[#0d131f]/90 flex flex-wrap items-center gap-6">
      <div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">{bankBalance.bank_name}</span>
        <p className="text-lg font-extrabold text-slate-100">{formatCurrency(bankBalance.available_balance)}</p>
      </div>
      <div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Projected After Open Sheet</span>
        <p className="text-sm font-bold text-amber-400">{formatCurrency(projected)}</p>
      </div>
    </div>
  );
};

export default BankBalanceBanner;
