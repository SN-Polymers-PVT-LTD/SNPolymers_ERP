import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSheets, getBankBalances } from '../../api/acctRequisitionsApi';
import { SkeletonCard } from '../../components/ui/Skeleton';
import DashboardErrorBanner from '../../components/dashboard/DashboardErrorBanner';
import { EMPTY_ARRAY } from '../../utils/constants';
import { countSheetsByStatus, sumBankBalances } from '../../utils/acctDashboard';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const AcctDashboardView = () => {
  const sheetsQ = useQuery({
    queryKey: ['acctDashboardSheets'],
    queryFn: async () => (await getSheets()).data?.sheets ?? [],
    staleTime: 15 * 1000
  });

  const bankBalancesQ = useQuery({
    queryKey: ['acctDashboardBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000
  });

  const sheets = sheetsQ.data ?? EMPTY_ARRAY;
  const bankBalances = bankBalancesQ.data ?? EMPTY_ARRAY;
  const isLoading = sheetsQ.isLoading || bankBalancesQ.isLoading;
  const hasAnyError = sheetsQ.isError || bankBalancesQ.isError;

  const handleRetry = () => {
    if (sheetsQ.isError) sheetsQ.refetch();
    if (bankBalancesQ.isError) bankBalancesQ.refetch();
  };

  const openSheetsCount = useMemo(() => countSheetsByStatus(sheets, 'Open'), [sheets]);
  const submittedSheetsCount = useMemo(() => countSheetsByStatus(sheets, 'Submitted'), [sheets]);
  const totalAvailableBalance = useMemo(() => sumBankBalances(bankBalances), [bankBalances]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
      <div className="lg:col-span-3">
        <DashboardErrorBanner visible={hasAnyError} onRetry={handleRetry} />
      </div>

      {/* Left Column (2/3) */}
      <div className="lg:col-span-2 space-y-8">
        <div className="glass-panel p-6 rounded-3xl">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Requisition Sheets</h2>

          {isLoading ? (
            <SkeletonCard />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/20">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Open Sheets</span>
                <span className="text-2xl font-black text-amber-400 font-mono block mt-1">{openSheetsCount}</span>
                <span className="text-[10px] text-amber-500/80 font-mono mt-1 block">Awaiting line items or submission</span>
              </div>
              <div className="p-4 rounded-2xl bg-sky-950/20 border border-sky-500/20">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Submitted Sheets</span>
                <span className="text-2xl font-black text-sky-400 font-mono block mt-1">{submittedSheetsCount}</span>
                <span className="text-[10px] text-sky-500/80 font-mono mt-1 block">Under HO review or actioned</span>
              </div>
            </div>
          )}

          <Link
            to="/acct-requisitions"
            className="mt-6 flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-amber-500/40 hover:bg-amber-500/10 text-left transition group"
          >
            <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400">Open Requisition Sheets</span>
            <span className="text-amber-400 font-bold text-sm">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* Right Column (1/3) */}
      <div className="space-y-8">
        <div className="glass-panel p-6 rounded-3xl">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Bank Balances</h2>

          {isLoading ? (
            <SkeletonCard />
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/20">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Total Available Balance</span>
              <span className="text-2xl font-black text-emerald-400 font-mono block mt-1">{formatINR(totalAvailableBalance)}</span>
              <span className="text-[10px] text-emerald-500/80 font-mono mt-1 block">Across {bankBalances.length} bank accounts</span>
            </div>
          )}

          <Link
            to="/acct-requisitions/bank-balances"
            className="mt-4 flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-sky-500/40 hover:bg-sky-500/10 text-left transition group"
          >
            <span className="text-xs font-bold text-slate-200 group-hover:text-sky-400">Manage Bank Balances</span>
            <span className="text-sky-400 font-bold text-sm">&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AcctDashboardView;
