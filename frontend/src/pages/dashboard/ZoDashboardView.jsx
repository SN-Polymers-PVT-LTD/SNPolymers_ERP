import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import authApi from '../../api/authApi';
import ZoDashboard from '../ZoDashboard';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const ZoDashboardView = () => {
  // 1. Fetch Zonal Credit Balance
  const { data: balanceRes } = useQuery({
    queryKey: ['zoBalances'],
    queryFn: async () => {
      const res = await authApi.get('/zo-balances');
      return res.data;
    },
    staleTime: 30000
  });

  const balanceData = balanceRes?.balances?.[0] || {
    available_balance: 1860000,
    credit_limit: 2000000,
    zo_name: 'Kolkata Zone Office'
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Top Zonal Ledger Header Strip */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-500">{balanceData.zo_name}</span>
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">Zonal Credit Limit Ledger</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-200 dark:border-white/5">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block font-bold">Available Credit Balance</span>
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">{formatINR(balanceData.available_balance)}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block font-bold">Total Assigned Limit</span>
            <span className="text-2xl font-black text-slate-800 dark:text-slate-200 font-mono">{formatINR(balanceData.credit_limit || 2000000)}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block font-bold">Zonal Controls</span>
            <div className="flex items-center gap-3 mt-1">
              <Link to="/fund-requests" className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold border border-amber-500/20 hover:bg-amber-500/20 transition">
                Request Funds →
              </Link>
              <Link to="/zonal-balances" className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 text-xs font-bold border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition">
                Zonal Balances
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Zonal Analytics Suite */}
      <ZoDashboard />
    </div>
  );
};

export default ZoDashboardView;
