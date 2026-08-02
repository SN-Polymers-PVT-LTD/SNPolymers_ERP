import React from 'react';
import { SkeletonCard } from '../ui';

export const EstimatedBillStats = ({ data = [], isLoading = false }) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val || 0);
  };

  const totalCount = data.length;
  const totalAmount = data.reduce((sum, item) => sum + (Number(item.estimated_bill_amount) || 0), 0);
  const weightedAmount = data.reduce((sum, item) => {
    const amt = Number(item.estimated_bill_amount) || 0;
    const surety = Number(item.surety_pct) || 0;
    return sum + (amt * surety / 100);
  }, 0);
  const avgSurety = totalCount > 0
    ? Math.round(data.reduce((sum, item) => sum + (Number(item.surety_pct) || 0), 0) / totalCount)
    : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Work Orders Count */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 group hover:border-indigo-500/30 transition-all duration-300 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Work Orders
          </span>
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>
        <div className="my-2">
          <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono tracking-tight tabular-nums">
            {totalCount}
          </div>
        </div>
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-400/90 font-mono">
          {totalCount} Active Contracts
        </div>
      </div>

      {/* 2. Total Estimated Amount */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 group hover:border-amber-500/30 transition-all duration-300 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Total Estimated Amount
          </span>
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <div className="my-2">
          <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono tracking-tight tabular-nums truncate" title={formatCurrency(totalAmount)}>
            {formatCurrency(totalAmount)}
          </div>
        </div>
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400/90 font-mono">
          Gross Cash-Flow Forecast
        </div>
      </div>

      {/* 3. Surety-Weighted Total */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 group hover:border-emerald-500/30 transition-all duration-300 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Surety-Weighted Total
          </span>
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        </div>
        <div className="my-2">
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono tracking-tight tabular-nums truncate" title={formatCurrency(weightedAmount)}>
            {formatCurrency(weightedAmount)}
          </div>
        </div>
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400/90 font-mono">
          Probability Realization
        </div>
      </div>

      {/* 4. Average Surety % */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 group hover:border-sky-500/30 transition-all duration-300 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Avg. % Surety
          </span>
          <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 shrink-0">
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
        </div>
        <div className="my-2">
          <div className="text-2xl sm:text-3xl font-black text-sky-400 font-mono tracking-tight tabular-nums">
            {avgSurety}%
          </div>
        </div>
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-sky-400/90 font-mono">
          Confidence Score
        </div>
      </div>
    </div>
  );
};

export default EstimatedBillStats;
