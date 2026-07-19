import React, { useMemo, useState } from 'react';
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

const HoDashboardView = () => {
  // 1. Fetch dashboard overview (contains total projects and audit log)
  const { data: overviewRes } = useQuery({
    queryKey: ['dashboardOverview'],
    queryFn: async () => {
      const res = await authApi.get('/projects/dashboard/overview');
      return res.data;
    },
    refetchInterval: 30000
  });

  const overview = overviewRes?.overview || { totalProjects: 0, running: 0, closed: 0, maintenance: 0 };
  const activities = overviewRes?.recentActivity || [];

  // 2. Fetch cost estimates to count pending reviews
  const { data: estimatesRes } = useQuery({
    queryKey: ['estimates', { limit: 100 }],
    queryFn: async () => {
      const res = await authApi.get('/estimates?limit=100');
      return res.data;
    }
  });

  const estimates = estimatesRes?.estimates || [];
  const pendingEstimatesCount = useMemo(() => {
    return estimates.filter(e => e.estimate_status === 'Under HO Review' || e.estimate_status === 'Under ZO Review').length;
  }, [estimates]);

  // 3. Fetch payment requisitions
  const { data: requisitionsRes } = useQuery({
    queryKey: ['dashboardRequisitions'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    }
  });

  const requisitions = requisitionsRes?.requisitions || [];
  const requisitionStats = useMemo(() => {
    const approvedSum = requisitions
      .filter(r => r.requisition_status === 'Approved')
      .reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
    const pendingCount = requisitions.filter(r => r.requisition_status === 'Pending').length;
    return { approvedSum, pendingCount };
  }, [requisitions]);

  // 4. Fetch all projects to calculate leakage anomalies and zonal progress
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    }
  });

  const projects = projectsRes?.projects || [];

  // Real Budget Leakage Detector: Mapped requisitions vs Work Order Value
  const leakageAlerts = useMemo(() => {
    const list = [];
    projects.forEach(p => {
      const woVal = Number(p.work_order_value || 0);
      const spent = requisitions
        .filter(r => r.work_order_no === p.work_order_no && r.requisition_status === 'Approved')
        .reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);

      if (woVal > 0 && spent > woVal) {
        const overrun = spent - woVal;
        const variance = ((overrun / woVal) * 100).toFixed(1);
        list.push({
          id: p.work_order_no,
          project: p.site_details || 'Site Project',
          budget: woVal,
          spent,
          variance: `+${variance}%`,
          status: 'Critical'
        });
      } else if (woVal > 0 && spent > woVal * 0.9) {
        const variance = (((spent - woVal) / woVal) * 100).toFixed(1);
        list.push({
          id: p.work_order_no,
          project: p.site_details || 'Site Project',
          budget: woVal,
          spent,
          variance: `${variance}%`,
          status: 'Warning'
        });
      }
    });
    return list.slice(0, 5); // top 5 overrun alerts
  }, [projects, requisitions]);

  // Zone Benchmarking (Group projects by zone and average their progress)
  const zoneRankings = useMemo(() => {
    const zonesMap = {};
    projects.forEach(p => {
      const zoneName = p.zone || 'General Zone';
      if (!zonesMap[zoneName]) {
        zonesMap[zoneName] = { zone: zoneName, totalProjects: 0, runningProjects: 0, progressSum: 0 };
      }
      zonesMap[zoneName].totalProjects += 1;
      if (p.status === 'Running') {
        zonesMap[zoneName].runningProjects += 1;
      }
      // Since progress is stored on daily reports, we can approximate zone density
      zonesMap[zoneName].progressSum += p.status === 'Closed' ? 100 : p.status === 'Complete Under Maintenance' ? 100 : 50; 
    });

    return Object.values(zonesMap)
      .map((z, idx) => {
        const avgProgress = Math.round(z.progressSum / z.totalProjects);
        return {
          rank: idx + 1,
          zone: z.zone,
          health: `${avgProgress}%`,
          progress: `${avgProgress}%`,
          activeProjects: z.totalProjects,
          rating: avgProgress >= 85 ? 'Excellent' : avgProgress >= 70 ? 'Good' : 'Warning'
        };
      })
      .sort((a, b) => parseInt(b.health) - parseInt(a.health));
  }, [projects]);

  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 5;
  const totalPages = Math.ceil(zoneRankings.length / ITEMS_PER_PAGE);
  const paginatedRankings = zoneRankings.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const kpis = [
    { label: 'Active Projects', value: overview.running, change: `Total: ${overview.totalProjects}`, color: 'text-amber-500', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.05)]' },
    { label: 'Estimates Under Review', value: pendingEstimatesCount, change: 'Pending approval action', color: 'text-sky-500', glow: 'shadow-[0_0_15px_rgba(14,165,233,0.05)]' },
    { label: 'Total Requisitions Approved', value: formatINR(requisitionStats.approvedSum), change: `${requisitions.length} bills processed`, color: 'text-emerald-500', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.05)]' },
    { label: 'Pending Requisitions', value: requisitionStats.pendingCount, change: 'Awaiting operator review', color: 'text-rose-500', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.05)]' },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Top KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, idx) => (
          <div key={idx} className={`glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 ${kpi.glow}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{kpi.label}</span>
            <div className={`text-3xl font-black mt-2 tracking-tight ${kpi.color}`}>{kpi.value}</div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1.5">{kpi.change}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Zone Benchmarking */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Zone Benchmarking</h2>
            {zoneRankings.length === 0 ? (
              <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No active zones logged</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 pb-3">
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Rank</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Zone</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Health Index</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Avg Progress</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Projects</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {paginatedRankings.map((row, idx) => {
                      const rank = (page - 1) * ITEMS_PER_PAGE + idx + 1;
                      return (
                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                          <td className="py-4 text-xs font-extrabold text-amber-500">#{rank}</td>
                          <td className="py-4 text-xs font-bold text-slate-200">{row.zone}</td>
                          <td className="py-4 text-xs font-bold text-slate-200 text-center">{row.health}</td>
                          <td className="py-4 text-xs font-bold text-slate-400 text-center">{row.progress}</td>
                          <td className="py-4 text-xs font-bold text-slate-400 text-center">{row.activeProjects}</td>
                          <td className="py-4 text-right">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                              row.rating === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              row.rating === 'Good' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                              'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {row.rating}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-4 mt-6">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Page {page} of {totalPages} <span className="text-slate-600">({zoneRankings.length} zones total)</span>
                </span>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    disabled={page === 1}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                      page === 1 
                        ? 'border-transparent text-slate-600 cursor-not-allowed' 
                        : 'border-white/10 hover:bg-white/5 text-slate-300'
                    }`}
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={page === totalPages}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                      page === totalPages 
                        ? 'border-transparent text-slate-600 cursor-not-allowed' 
                        : 'border-white/10 hover:bg-white/5 text-slate-300'
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Budget Leakage Anomaly List */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Budget Leakage Anomaly Detector</h2>
            {leakageAlerts.length === 0 ? (
              <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No active overruns detected</div>
            ) : (
              <div className="space-y-4">
                {leakageAlerts.map((alert, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all duration-300">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{alert.id}</span>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                          alert.status === 'Critical' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {alert.status}
                        </span>
                      </div>
                      <h4 className="text-sm font-extrabold text-slate-200">{alert.project}</h4>
                    </div>
                    <div className="flex items-center gap-8 mt-4 md:mt-0">
                      <div className="text-left md:text-right">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Spent / Budget</span>
                        <span className="text-xs font-bold text-slate-200">{formatINR(alert.spent)} <span className="text-[10px] text-slate-400">/ {formatINR(alert.budget)}</span></span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Overrun</span>
                        <span className={`text-xs font-black ${alert.status === 'Critical' ? 'text-rose-400' : 'text-amber-400'}`}>{alert.variance}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          {/* HO Quick Controls Panel */}
          <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Modules</h2>
            <div className="grid grid-cols-1 gap-3">
              <Link to="/estimates" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Review Cost Estimates</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/requisitions" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Approve Payment Requisitions</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/zonal-balances" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Audit Zonal Ledgers</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/admin" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
                <span className="text-xs font-bold uppercase tracking-wider">Configure Access Whitelist</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* User Count Breakdown */}
          <div className="glass-panel p-6 rounded-3xl flex flex-col justify-between min-h-[220px]">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-6">User Count Breakdown</span>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Junior Eng (JE)</span>
                  <span className="text-xl font-mono font-black text-amber-500 mt-1">{overview?.userCounts?.je || 0}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Zonal Offices (ZO)</span>
                  <span className="text-xl font-mono font-black text-sky-500 mt-1">{overview?.userCounts?.zo || 0}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Head Office (HO)</span>
                  <span className="text-xl font-mono font-black text-emerald-500 mt-1">{overview?.userCounts?.ho || 0}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Admin Staff</span>
                  <span className="text-xl font-mono font-black text-rose-500 mt-1">{overview?.userCounts?.admin || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Audits */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Recent Activity Logs</h2>
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
              {activities.length === 0 ? (
                <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No recent audits</div>
              ) : (
                activities.slice(0, 5).map((act, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <div className="space-y-0.5">
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

export default HoDashboardView;
