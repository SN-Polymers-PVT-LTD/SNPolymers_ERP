import React, { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { getZonalBalances } from '../../api/zoBalancesApi';
import { getProjectsHealth } from '../../api/analyticsApi';
import { getRequisitions } from '../../api/requisitionsApi';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const fmtCr = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹ ${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹ ${(v / 100000).toFixed(2)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
};

const ZoDashboardView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // 1. Fetch Zonal Credit Balance
  const { data: balanceRes } = useQuery({
    queryKey: ['zoBalances'],
    queryFn: async () => {
      const res = await getZonalBalances();
      return res.data;
    },
    staleTime: 30000
  });

  // 2. Fetch Projects for JE Workload & Stats
  const { data: projectsRes } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => {
      const res = await getProjectsHealth();
      return res.data;
    },
    staleTime: 30000
  });

  // 3. Fetch Requisitions for Pending Payment Requisition Amount
  const { data: requisitionsRes } = useQuery({
    queryKey: ['zoPendingRequisitions'],
    queryFn: async () => {
      const res = await getRequisitions();
      return res.data;
    },
    staleTime: 30000
  });

  const projects = projectsRes?.data || [];
  const requisitionsList = requisitionsRes?.requisitions || requisitionsRes?.data || [];
  const myZoName = user?.assigned_zone || user?.zo_name || user?.display_name || user?.name || 'Zonal Office';

  // Filter projects for logged-in ZO
  const filteredProjects = useMemo(() => {
    if (!user?.role || user.role !== 'zo') return projects;
    const q = myZoName.toLowerCase().trim();
    return projects.filter(p => {
      const zName = (p.zo_name || p.zo_user_id || p.zone || '').toLowerCase().trim();
      return zName === q || zName.includes(q) || q.includes(zName);
    });
  }, [projects, myZoName, user]);

  // Compute Pending Payment Requisitions for this ZO
  const pendingReqStats = useMemo(() => {
    const pendingItems = (requisitionsList || []).filter(r => {
      const status = (r.requisition_status || r.status || '').toLowerCase();
      return status.includes('pending');
    });

    const sum = pendingItems.reduce((acc, r) => acc + Number(r.net_payable_amount || r.requested_amount || r.amount || 0), 0);
    return { count: pendingItems.length, amount: sum };
  }, [requisitionsList]);

  const balanceData = balanceRes?.balances?.[0] || balanceRes?.balance || {
    available_balance: 0,
    assigned_credit_limit: 0,
    zo_name: myZoName
  };

  const availBal = balanceData.available_balance ?? 0;

  // Derive JE Stats for this zone
  const jeStats = useMemo(() => {
    const map = new Map();
    (filteredProjects || []).forEach(p => {
      const jeName = p.je_name || p.assigned_je || 'Unassigned JE';
      if (!map.has(jeName)) {
        map.set(jeName, { name: jeName, count: 0, totalProgress: 0 });
      }
      const item = map.get(jeName);
      item.count += 1;
      item.totalProgress += Number(p.physical_progress || 0);
    });

    return Array.from(map.values()).map(je => {
      const avg = je.count > 0 ? Math.round(je.totalProgress / je.count) : 0;
      let status = 'Active';
      let streak = Math.max(1, Math.min(15, Math.round(je.count * 3)));
      if (avg >= 70) status = 'Excellent';
      else if (avg < 40) status = 'Warning';
      return { ...je, avg, status, streak };
    }).sort((a, b) => b.count - a.count);
  }, [filteredProjects]);

  return (
    <div className="space-y-8 pb-12">
      
      {/* Overview Banner (homedashboard.html ZO View) */}
      <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-white/10 bg-[#0b0e14]/80 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/10">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 font-mono">
              {myZoName}
            </span>
            <h2 className="text-2xl font-extrabold text-slate-100 tracking-tight mt-1">
              Zonal Credit Limit Ledger
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Available credit, pending payment requisitions and junior engineer productivity for your zone.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/fund-requests"
              className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-md flex items-center gap-1.5"
            >
              <span>💸 Request Funds</span>
              <span className="text-amber-300">→</span>
            </Link>
            <Link
              to="/zonal-balances"
              className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 font-black text-xs uppercase tracking-wider transition flex items-center gap-1.5"
            >
              <span>📊 Zonal Balances</span>
              <span className="text-slate-400">→</span>
            </Link>
          </div>
        </div>

        {/* 3 Top Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6">
          <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Available Credit Balance</span>
            <span className="text-2xl font-black text-emerald-400 font-mono block mt-1">{formatINR(availBal)}</span>
            <span className="text-[10px] text-emerald-500/80 font-mono mt-1 block">Ready for requisition payout</span>
          </div>
          <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Pending Requisitions Amount</span>
            <span className="text-2xl font-black text-amber-400 font-mono block mt-1">{formatINR(pendingReqStats.amount)}</span>
            <span className="text-[10px] text-amber-500/80 font-mono mt-1 block">{pendingReqStats.count} payment bills pending review</span>
          </div>
          <div className="p-4 rounded-2xl bg-sky-950/20 border border-sky-500/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Mapped Active Projects</span>
            <span className="text-2xl font-black text-sky-400 font-mono block mt-1">{filteredProjects.length} WO Sites</span>
            <span className="text-[10px] text-sky-500/80 font-mono mt-1 block">Active sites under monitoring</span>
          </div>
        </div>
      </div>

      {/* Main Grid: JE Productivity (Left) + Quick Controls & Timeline (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: JE Productivity & Workload Distribution */}
        <div className="lg:col-span-7 space-y-6">
          
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/40">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200">
                Junior Engineer Productivity <span className="text-slate-500 font-normal">· {jeStats.length} JEs</span>
              </span>
              <Link to="/analytics/leaderboard" className="text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:underline">
                Full Leaderboard →
              </Link>
            </div>
            
            {jeStats.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 italic">No JEs mapped to this zone</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[9px] font-black uppercase text-slate-400">
                      <th className="pb-3">JE Name</th>
                      <th className="pb-3 text-center">Assigned Sites</th>
                      <th className="pb-3 text-center">Daily Streak</th>
                      <th className="pb-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {jeStats.slice(0, 5).map((je, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition">
                        <td className="py-3 font-bold text-slate-200">{je.name}</td>
                        <td className="py-3 text-center font-mono text-slate-300">{je.count}</td>
                        <td className="py-3 text-center font-mono text-amber-400">🔥 {je.streak} days</td>
                        <td className="py-3 text-right">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            je.status === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            je.status === 'Active' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {je.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Workload Distribution Progress Bars */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/40">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Workload Distribution
            </span>
            <div className="space-y-4">
              {jeStats.slice(0, 4).map((je, idx) => {
                const pct = Math.min(100, Math.round((je.count / (filteredProjects.length || 1)) * 100));
                return (
                  <div key={idx}>
                    <div className="flex justify-between text-xs font-bold mb-1.5">
                      <span className="text-slate-300">{je.name}</span>
                      <span className="text-slate-500 font-mono">{je.count} mapped work orders ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 border border-white/5 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Analytics Link-out */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Dedicated ZO Analytics Link Card */}
          <div className="glass-panel p-6 rounded-3xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 transition shadow-lg relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[9px] font-mono uppercase tracking-widest text-amber-500 font-bold block">Deep Analytics Control Room</span>
                <h3 className="text-lg font-black text-slate-100 mt-0.5">ZO Performance Analytics</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  S-curves, physical progress, department breakdown, fund flow waterfall &amp; risk matrix.
                </p>
              </div>
              <button
                onClick={() => navigate('/analytics/zo')}
                className="px-4 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider hover:bg-amber-400 transition cursor-pointer shrink-0 shadow-md"
              >
                Open ZO Analytics →
              </button>
            </div>
          </div>

          {/* Quick Zonal Controls Panel */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/40">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Controls &amp; Requisitions
            </span>
            <div className="space-y-3">
              <Link
                to="/fund-requests"
                className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-amber-500/40 hover:bg-amber-500/10 text-left transition group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-amber-400">Initiate Zonal Fund Request</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Current available: {formatINR(availBal)}</div>
                </div>
                <span className="text-amber-400 font-bold text-sm">→</span>
              </Link>

              <Link
                to="/zonal-balances"
                className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-sky-500/40 hover:bg-sky-500/10 text-left transition group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400">Inspect Zonal Ledger</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Full transaction ledger &amp; credit cap</div>
                </div>
                <span className="text-sky-400 font-bold text-sm">→</span>
              </Link>

              <Link
                to="/daily-progress"
                className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 text-left transition group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-emerald-400">Audit Site Progress Logs</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">DPR visits &amp; site photos feedback</div>
                </div>
                <span className="text-emerald-400 font-bold text-sm">→</span>
              </Link>
            </div>
          </div>

          {/* Recent Zonal Site Activity */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/40">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-3">
              Zonal Site Timeline
            </span>
            <div className="space-y-3.5 text-xs">
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">DPR Progress Update Submitted</div>
                  <div className="text-[10px] text-slate-500 font-mono">Mapped JE logged site progress (WO Active)</div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">Zonal Requisition Processed</div>
                  <div className="text-[10px] text-slate-500 font-mono">Disbursement recorded in credit balance</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ZoDashboardView;
