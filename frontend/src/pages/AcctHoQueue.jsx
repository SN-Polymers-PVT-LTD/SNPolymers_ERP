import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, Badge, SkeletonCard } from '../components/ui';
import { useQuery } from '@tanstack/react-query';
import { getSheets } from '../api/acctRequisitionsApi';

const STATUS_TABS = [
  { value: 'Submitted', label: 'Pending Review', emptyText: 'No submitted sheets pending review.' },
  { value: 'Reviewed', label: 'Reviewed', emptyText: 'No fully-reviewed sheets yet.' }
];

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : null);

// Full-width sheet list, mirroring AcctRequisitions.jsx's card grid — the
// review table itself lives on its own dedicated page
// (AcctHoSheetView, /acct-requisitions/ho-queue/sheets/:id) rather than
// being squeezed into a side column here, which is what made the review
// table look cramped/form-like instead of a real table.
const AcctHoQueue = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isHoUser = user?.role === 'ho' || user?.role === 'admin';
  const [statusFilter, setStatusFilter] = useState('Submitted');
  const activeTab = STATUS_TABS.find((t) => t.value === statusFilter) || STATUS_TABS[0];

  // A sheet moves from Submitted to Reviewed automatically once every item
  // on it has a decision (migration 028) — at which point it drops out of
  // the default queue view above. Without this tab there'd be nowhere an HO
  // user could find that sheet again to reopen a decided item on it (the
  // Accounts sheet list with the same filter is role-gated away from HO).
  const { data: sheets = [], isLoading: loadingSheets } = useQuery({
    queryKey: ['acctSheets', statusFilter.toLowerCase()],
    queryFn: async () => (await getSheets({ sheet_status: statusFilter })).data?.sheets ?? [],
    staleTime: 15 * 1000,
    enabled: isHoUser
  });

  if (!isHoUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  const totalAmount = sheets.reduce((sum, s) => sum + Number(s.total_req_amount || 0), 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            HO · Accounts Requisition Review
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">HO Approval Queue</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            {statusFilter === 'Submitted'
              ? 'Submitted requisition sheets awaiting your review.'
              : 'Sheets you have fully reviewed — reopen an item here if it needs another look.'}
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
          View Bank Balances
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-6 p-1.5 glass-panel rounded-2xl border border-white/10 w-fit bg-slate-950/40">
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-300 flex items-center gap-2 select-none ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/25 ring-1 ring-amber-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>{tab.label}</span>
              {isActive && sheets.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-slate-950/20 text-slate-950 font-mono">
                  {sheets.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">{activeTab.label} Sheets</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{sheets.length}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Total Requested</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{formatINR(totalAmount)}</span>
        </div>
      </div>

      {loadingSheets ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : sheets.length === 0 ? (
        <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
          {activeTab.emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              onClick={() => navigate(`/acct-requisitions/ho-queue/sheets/${sheet.id}`)}
              className="glass-panel p-5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/[0.02] cursor-pointer transition duration-300 flex flex-col justify-between gap-4 group relative"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <span className="text-xl font-black text-amber-500 font-mono tracking-wide block mb-2">
                    {sheet.sheet_number}
                  </span>
                  <span className="text-xs text-slate-400 font-medium block">
                    {sheet.item_count} item{sheet.item_count === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex items-start gap-3 shrink-0">
                  <Badge variant={sheet.sheet_status === 'Reviewed' ? 'emerald' : 'blue'} showDot={false}>{sheet.sheet_status}</Badge>
                  <button className="h-8 w-8 rounded-xl bg-white/5 group-hover:bg-white/10 border border-white/5 group-hover:border-white/10 flex items-center justify-center text-slate-400 group-hover:text-slate-200 transition-all duration-300 shrink-0">
                    <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-white/5 pt-3.5 mt-2">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                  Submitted {formatDate(sheet.submitted_at)}
                </span>
                <div className="text-right">
                  <span className="text-[9px] text-slate-500 uppercase font-bold block">Total Requested</span>
                  <span className="text-lg font-black text-slate-200 font-mono">{formatINR(sheet.total_req_amount)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default AcctHoQueue;
