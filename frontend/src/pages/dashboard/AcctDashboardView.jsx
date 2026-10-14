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

        {/* Payroll & Statutory Compliance Hub */}
        <div className="glass-panel p-6 rounded-3xl space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 block font-mono">Compliance & Banking</span>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200 mt-0.5">Payroll & Statutory Hub</h2>
            </div>
            <Link to="/hr/payroll/register" className="text-xs font-bold text-emerald-400 hover:underline">
              Salary Register &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1: Statutory Profiles */}
            <Link
              to="/admin/payroll/statutory-profiles"
              className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition group flex flex-col justify-between space-y-2"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 font-mono">Profiles & Banking</span>
                  <span className="text-xs text-slate-500 group-hover:text-emerald-400 transition">&rarr;</span>
                </div>
                <h3 className="text-xs font-bold text-slate-200 group-hover:text-emerald-300 mt-1">Employee Statutory Profiles</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Worker PF/UAN, ESIC numbers, PAN, PT state bindings, and verified bank account beneficiaries.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 pt-1 block">
                Manage Profiles →
              </span>
            </Link>

            {/* Card 2: Statutory Slabs */}
            <Link
              to="/admin/payroll/statutory"
              className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-sky-500/30 hover:bg-sky-500/5 transition group flex flex-col justify-between space-y-2"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-sky-400 font-mono">Legal Slabs</span>
                  <span className="text-xs text-slate-500 group-hover:text-sky-400 transition">&rarr;</span>
                </div>
                <h3 className="text-xs font-bold text-slate-200 group-hover:text-sky-300 mt-1">Statutory Deduction Master</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  EPF (12%), ESIC (0.75%/3.25%), State Professional Tax slabs, and wage ceilings.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 pt-1 block">
                Configure Slabs →
              </span>
            </Link>

            {/* Card 3: Payroll Register */}
            <Link
              to="/hr/payroll/register"
              className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 transition group flex flex-col justify-between space-y-2"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 font-mono">Disbursements</span>
                  <span className="text-xs text-slate-500 group-hover:text-amber-400 transition">&rarr;</span>
                </div>
                <h3 className="text-xs font-bold text-slate-200 group-hover:text-amber-300 mt-1">Payroll Salary Register</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Audit monthly net pay totals, verify deductions, and export bank payout Excel files.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 pt-1 block">
                Open Register →
              </span>
            </Link>

            {/* Card 4: Payroll Review Queue */}
            <Link
              to="/hr/payroll/review"
              className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-purple-500/30 hover:bg-purple-500/5 transition group flex flex-col justify-between space-y-2"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400 font-mono">Sign-off Gate</span>
                  <span className="text-xs text-slate-500 group-hover:text-purple-400 transition">&rarr;</span>
                </div>
                <h3 className="text-xs font-bold text-slate-200 group-hover:text-purple-300 mt-1">Payroll Verification Queue</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Verify FM submitted batches, check statutory components, and forward to HO for locking.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 pt-1 block">
                Open Queue →
              </span>
            </Link>
          </div>
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
