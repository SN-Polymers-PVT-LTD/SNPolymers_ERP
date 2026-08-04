import React, { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { getZonalBalances } from '../../api/zoBalancesApi';
import { getProjectsHealth, getJeLeaderboard, getRecentActivity } from '../../api/analyticsApi';
import { getRequisitions } from '../../api/requisitionsApi';
import { EMPTY_ARRAY } from '../../utils/constants';
import { buildJeStats, computeWorkloadShare, filterProjectsByZoId } from '../../utils/zoDashboard';
import DashboardErrorBanner from '../../components/dashboard/DashboardErrorBanner';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};


const ZoDashboardView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // 1. Fetch Zonal Credit Balance
  const balanceQ = useQuery({
    queryKey: ['zoBalances'],
    queryFn: async () => {
      const res = await getZonalBalances();
      return res.data;
    },
    staleTime: 30000
  });

  const balanceRes = balanceQ.data;

  // 2. Fetch Projects for JE Workload & Stats
  const projectsQ = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => {
      const res = await getProjectsHealth();
      return res.data;
    },
    staleTime: 30000
  });

  const projectsRes = projectsQ.data;

  // 3. Fetch Requisitions for Pending Payment Requisition Amount
  const requisitionsQ = useQuery({
    queryKey: ['zoPendingRequisitions'],
    queryFn: async () => {
      const res = await getRequisitions();
      return res.data;
    },
    staleTime: 30000
  });

  const requisitionsRes = requisitionsQ.data;

  // 4. Fetch JE Leaderboard for Live Streaks
  const leaderboardQ = useQuery({
    queryKey: ['jeLeaderboardZoView'],
    queryFn: async () => {
      const res = await getJeLeaderboard({ timeframe: 'weekly' });
      return res.data;
    },
    staleTime: 30000
  });

  const leaderboardRes = leaderboardQ.data;

  // 5. Fetch recent zonal activity for timeline
  const activityQ = useQuery({
    queryKey: ['zoRecentActivity'],
    queryFn: async () => {
      const res = await getRecentActivity();
      return res.data;
    },
    staleTime: 30000
  });

  const activityRes = activityQ.data;

  const hasAnyError = balanceQ.isError || projectsQ.isError || requisitionsQ.isError || leaderboardQ.isError || activityQ.isError;

  const handleRetry = () => {
    if (balanceQ.isError) balanceQ.refetch();
    if (projectsQ.isError) projectsQ.refetch();
    if (requisitionsQ.isError) requisitionsQ.refetch();
    if (leaderboardQ.isError) leaderboardQ.refetch();
    if (activityQ.isError) activityQ.refetch();
  };

  const projects = projectsRes?.data ?? EMPTY_ARRAY;
  const requisitionsList = requisitionsRes?.requisitions ?? requisitionsRes?.data ?? EMPTY_ARRAY;
  const myZoName = user?.display_name || user?.assigned_zone || user?.zo_name || user?.name || 'Zonal Office';
  const myZoId = user?.mobile_number || user?.zo_user_id || '';

  // Filter projects for logged-in ZO (backend already scopes by zo_user_id)
  const filteredProjects = useMemo(() => {
    if (!user?.role || user.role !== 'zo') return projects;
    return filterProjectsByZoId(projects, myZoId);
  }, [projects, myZoId, user]);

  // Compute Pending Payment Requisitions for this ZO
  const pendingReqStats = useMemo(() => {
    const pendingItems = (requisitionsList || []).filter(r => {
      const status = (r.requisition_status || r.status || '').toLowerCase();
      return status.includes('pending');
    });

    const sum = pendingItems.reduce((acc, r) => acc + Number(r.requisition_amount || r.net_payable_amount || r.requested_amount || r.amount || 0), 0);
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
    const stats = buildJeStats(filteredProjects, leaderboardRes?.leaderboard);
    // Sort deterministically: count DESC, then streak DESC, then name ASC
    return stats.sort((a, b) => b.count - a.count || b.streak - a.streak || a.name.localeCompare(b.name));
  }, [filteredProjects, leaderboardRes]);

  const totalAssignments = useMemo(
    () => jeStats.reduce((sum, je) => sum + je.count, 0) || 1,
    [jeStats]
  );

  const recentActivities = activityRes?.activities ?? EMPTY_ARRAY;

  return (
    <div className="space-y-8 pb-12">
      <DashboardErrorBanner visible={hasAnyError} onRetry={handleRetry} />
      
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
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-1">
              Zonal Workload Distribution
            </span>
            <p className="text-[10px] text-slate-500 mb-4">
              Percentages reflect share of total JE assignments (shared sites counted per JE).
            </p>
            <div className="space-y-4">
              {jeStats.slice(0, 4).map((je, idx) => {
                const pct = computeWorkloadShare(je.count, totalAssignments);
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
            {recentActivities.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500 italic">No recent zonal activity</div>
            ) : (
              <div className="space-y-3.5 text-xs">
                {recentActivities.slice(0, 5).map((act, idx) => {
                  const ts = act.timestamp ? new Date(act.timestamp).toLocaleString('en-IN') : '';
                  const dotColor = (act.action || '').toLowerCase().includes('approv')
                    ? 'bg-emerald-400'
                    : (act.action || '').toLowerCase().includes('reject') || (act.action || '').toLowerCase().includes('fail')
                      ? 'bg-rose-400'
                      : 'bg-amber-400';
                  return (
                    <div key={act.id || act.audit_id || idx} className="flex gap-3 items-start">
                      <span className={`w-2 h-2 rounded-full ${dotColor} mt-1.5 shrink-0`} />
                      <div>
                        <div className="text-slate-200 font-bold">{act.action || 'Activity'}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {act.user_name || 'System'} · {act.module_name || 'Record'} {act.record_identifier ? `(${act.record_identifier})` : ''}{ts ? ` · ${ts}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default ZoDashboardView;
