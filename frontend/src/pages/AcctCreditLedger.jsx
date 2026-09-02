import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Badge, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { getCreditLedger } from '../api/acctRequisitionsApi';
import AdjustCreditBalanceModal from '../components/acctRequisition/AdjustCreditBalanceModal';

const STATUS_TABS = [
  { value: 'Open', label: 'Open', emptyText: 'No open credit purchases.' },
  { value: 'Settled', label: 'History', emptyText: 'No settled credit purchases yet.' }
];

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—');

/**
 * Browse/history view over credit_ledger (042_credit_purchases_and_ledger.sql)
 * — one row per credit purchase HO approved via "Credit Approved". Open tab
 * is the still-payable list; History is fully Settled purchases. This page
 * is browse-only for Accounts, same split as AcctImportEligibleItems.jsx for
 * the existing Hold/Reject queue — the actual "pull an installment into my
 * sheet" action lives in CreditLedgerImportModal, opened from within an Open
 * sheet, since importing always needs a target sheet_id this page doesn't
 * have. HO additionally gets an "Adjust Balance" action on Open entries
 * (adjust_credit_ledger_balance_transact, 044) — a data-correction tool,
 * not part of the normal installment-approval flow.
 */
const AcctCreditLedger = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canView = user?.role === 'accounts' || user?.role === 'ho' || user?.role === 'admin';
  const canAdjust = user?.role === 'ho' || user?.role === 'admin';

  const [statusFilter, setStatusFilter] = useState('Open');
  const [dealerFilter, setDealerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [adjustingEntry, setAdjustingEntry] = useState(null);
  const activeTab = STATUS_TABS.find((t) => t.value === statusFilter) || STATUS_TABS[0];

  const hasFilters = dealerFilter || dateFrom || dateTo;
  const queryKey = ['acctCreditLedger', statusFilter, dealerFilter, dateFrom, dateTo];

  const { data: entries = [], isLoading, error: queryError } = useQuery({
    queryKey,
    queryFn: async () => (await getCreditLedger({
      status: statusFilter,
      limit: 100,
      dealer: dealerFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined
    })).data?.entries || [],
    enabled: canView
  });

  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  const resetFilters = () => {
    setDealerFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const handleAdjusted = () => {
    queryClient.invalidateQueries({ queryKey: ['acctCreditLedger'] });
  };

  if (!canView) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · Credit Ledger
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Credit Ledger</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Every dealer purchase HO Credit Approved, one row per purchase. Pull an installment into an
            Open sheet via "Import from Credit Ledger" on that sheet — a purchase moves here to History
            once fully paid off.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions')}>
          ← Back to Sheets
        </Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 select-none ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-extrabold ring-1 ring-amber-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 bg-white/[0.02] border border-white/5'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row flex-wrap items-end gap-3 mb-6">
        <div className="w-full sm:w-56">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">Dealer Name</span>
          <Input
            type="text"
            placeholder="Search dealer..."
            value={dealerFilter}
            onChange={(e) => setDealerFilter(e.target.value)}
            size="sm"
          />
        </div>
        <div className="w-full sm:w-36">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">From</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} size="sm" />
        </div>
        <div className="w-full sm:w-36">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">To</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} size="sm" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset Filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {hasFilters ? 'No entries match these filters.' : activeTab.emptyText}
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[1100px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Dealer</TableCell>
                <TableCell isHeader>Source</TableCell>
                <TableCell isHeader align="right">Opening Balance</TableCell>
                <TableCell isHeader align="right">Paid So Far</TableCell>
                <TableCell isHeader align="right">Remaining Balance</TableCell>
                <TableCell isHeader>Status</TableCell>
                {statusFilter === 'Settled' && <TableCell isHeader>Settled On</TableCell>}
                {statusFilter === 'Open' && canAdjust && <TableCell isHeader>Actions</TableCell>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <span className="text-slate-300">{entry.beneficiary?.beneficiary_name || '—'}</span>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {entry.beneficiary?.account_number || ''} {entry.beneficiary?.ifsc ? `· ${entry.beneficiary.ifsc}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-400 text-xs">{entry.source?.particulars || '—'}</span>
                    {entry.source?.sheet_number && (
                      <div className="text-amber-500 font-mono text-[10px] mt-0.5">{entry.source.sheet_number}</div>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <span className="text-slate-400">{formatCurrency(entry.opening_balance)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="text-slate-400">{formatCurrency(entry.paid_total)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-bold text-slate-200">{formatCurrency(entry.remaining_balance)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.ledger_status === 'Settled' ? 'emerald' : 'amber'}>
                      {entry.ledger_status}
                    </Badge>
                  </TableCell>
                  {statusFilter === 'Settled' && (
                    <TableCell>
                      <span className="text-slate-400 text-xs">{formatDate(entry.settled_at)}</span>
                    </TableCell>
                  )}
                  {statusFilter === 'Open' && canAdjust && (
                    <TableCell>
                      <Button variant="glass" size="sm" onClick={() => setAdjustingEntry(entry)}>
                        Adjust Balance
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdjustCreditBalanceModal
        isOpen={!!adjustingEntry}
        onClose={() => setAdjustingEntry(null)}
        entry={adjustingEntry}
        onAdjusted={handleAdjusted}
      />
    </>
  );
};

export default AcctCreditLedger;
