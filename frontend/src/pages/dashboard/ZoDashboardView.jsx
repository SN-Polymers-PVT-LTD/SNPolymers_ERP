import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import authApi from '../../api/authApi';

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
    }
  });

  const balanceData = balanceRes?.balances?.[0] || {
    available_balance: 0,
    credit_limit: 0,
    zo_name: 'Zonal Office'
  };

  // 2. Fetch Projects assigned to this ZO
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    }
  });

  const projects = projectsRes?.projects || [];

  // 3. Fetch User Mappings to display JEs in the Zone
  const { data: mappingsRes } = useQuery({
    queryKey: ['userMappings'],
    queryFn: async () => {
      const res = await authApi.get('/user-mappings');
      return res.data;
    }
  });

  const mappings = mappingsRes?.mappings || [];

  // 4. Fetch recent activity timeline
  const { data: overviewRes } = useQuery({
    queryKey: ['dashboardOverview'],
    queryFn: async () => {
      const res = await authApi.get('/projects/dashboard/overview');
      return res.data;
    }
  });

  const activities = overviewRes?.recentActivity || [];

  // Map JEs and count their project assignments dynamically
  const jes = useMemo(() => {
    const list = {};
    mappings.forEach(m => {
      if (m.je_user_id) {
        const jeName = m.je_user?.display_name || m.je_user_id;
        if (!list[jeName]) {
          list[jeName] = { name: jeName, projects: 0, reports: 0, streak: m.je_user?.daily_streak || 0, status: 'Active' };
        }
        list[jeName].projects += 1;
      }
    });
    
    const array = Object.values(list);
    if (array.length === 0) {
      return [
        { name: 'No JEs Mapped', projects: 0, reports: 0, streak: 0, status: 'Warning' }
      ];
    }
    return array;
  }, [mappings]);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Zonal Ledger card */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden shadow-[0_8px_32px_rgba(245,158,11,0.03)] border border-white/5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">{balanceData.zo_name}</span>
        <h2 className="text-xl font-extrabold text-slate-100 mt-1">Zonal Credit Limit Ledger</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t border-white/5">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Available Credit Balance</span>
            <span className="text-2xl font-black text-emerald-400">{formatINR(balanceData.available_balance)}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Total Assigned Limit</span>
            <span className="text-2xl font-black text-slate-200">{formatINR(balanceData.credit_limit || 2000000)}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Mapped Active Projects</span>
            <span className="text-2xl font-black text-slate-400">{projects.length} WO Sites</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-8">
          {/* JE Productivity & Leaderboard */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Junior Engineer Productivity</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 pb-3">
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">JE Name</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Assigned Projects</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Daily Streak</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {jes.map((je, idx) => (
                    <tr key={idx} className="hover:bg-white/5 transition-colors">
                      <td className="py-4 text-xs font-bold text-slate-200">{je.name}</td>
                      <td className="py-4 text-xs font-bold text-slate-300 text-center">{je.projects}</td>
                      <td className="py-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-xs font-black text-amber-500">
                          <span>🔥</span> {je.streak} days
                        </div>
                      </td>
                      <td className="py-4 text-right">
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                          je.streak >= 5 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          je.streak > 0 ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                          'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {je.streak >= 5 ? 'Excellent' : je.streak > 0 ? 'Active' : 'Warning'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Workload density */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Workload Distribution</h2>
            <div className="space-y-4">
              {jes.map((je, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-slate-300">{je.name}</span>
                    <span className="text-slate-400 font-medium">{je.projects} Mapped Work Orders</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                    <div 
                      className="h-full bg-amber-500 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.min((je.projects / 5) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          {/* ZO Operations shortcuts */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Zonal Control</h2>
            <div className="grid grid-cols-1 gap-3">
              <Link to="/fund-requests" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Initiate Zonal Fund Request</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/zonal-balances" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Inspect Zonal Ledger</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/daily-progress" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Audit Site Progress Logs</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* Activity Feed */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Zonal Site Timeline</h2>
            <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-white/5 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
              {activities.length === 0 ? (
                <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No recent timeline logs</div>
              ) : (
                activities.slice(0, 6).map((act, idx) => (
                  <div key={idx} className="flex gap-4 relative">
                    <div className="w-4 h-4 rounded-full bg-slate-900 border-2 border-amber-500 flex items-center justify-center shrink-0 z-10">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-300 leading-normal">{act.message}</p>
                      <span className="text-[9px] text-slate-400 block font-medium">
                        {new Date(act.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ZoDashboardView;
