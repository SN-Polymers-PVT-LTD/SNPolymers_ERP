import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pagination } from '../ui';
import { getBankLedger } from '../../api/acctRequisitionsApi';

const LIMIT = 10;

const ACTION_STYLES = {
  BANK_ADDED: { label: 'Bank Added', className: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  BANK_CREDITED: { label: 'Credit', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  BANK_DEBITED: { label: 'Debit', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  BANK_RECONCILED: { label: 'Reconciled', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  BANK_DEBITED_PAYOUT: { label: 'Payout', className: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  BANK_BACKFILL_APPROVED_PAYOUTS: { label: 'Backfill', className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' }
};

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const BankLedgerPanel = () => {
  const [page, setPage] = useState(1);

  const ledgerQ = useQuery({
    queryKey: ['acctBankLedger', page],
    queryFn: async () => (await getBankLedger({ page, limit: LIMIT })).data,
    staleTime: 15 * 1000
  });

  const entries = ledgerQ.data?.entries ?? [];
  const totalPages = ledgerQ.data?.totalPages ?? 1;
  const totalCount = ledgerQ.data?.totalCount ?? 0;

  return (
    <div className="glass-panel rounded-3xl overflow-hidden shadow-xl border border-white/5 flex flex-col">
      <div className="p-6 pb-4 border-b border-white/5">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Bank Ledger</h2>
        <p className="text-[10px] text-slate-500 mt-1">Debit / credit reconciliation history across all banks.</p>
      </div>

      {ledgerQ.isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading ledger...</div>
      ) : entries.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No ledger entries yet.
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {entries.map((entry) => {
            const style = ACTION_STYLES[entry.action] || { label: entry.action, className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
            const delta = entry.new_value?.delta;
            return (
              <div key={entry.id} className="p-4 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-slate-200">{entry.record_identifier}</span>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${style.className}`}>
                    {style.label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500">
                    {entry.user_name || 'System'} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-IN') : ''}
                  </span>
                  {delta != null && (
                    <span className={delta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {delta >= 0 ? '+' : ''}{formatCurrency(delta)}
                    </span>
                  )}
                </div>
                {entry.new_value?.available_balance != null && (
                  <span className="text-[9px] text-slate-500">
                    New balance: {formatCurrency(entry.new_value.available_balance)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        showLabel
        totalRecords={totalCount}
      />
    </div>
  );
};

export default BankLedgerPanel;
