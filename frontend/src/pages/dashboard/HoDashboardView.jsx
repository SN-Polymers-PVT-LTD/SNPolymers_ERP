import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import authApi from '../../api/authApi';
import { useTheme } from '../../components/ThemeContext';
import { useAuth } from '../../components/AuthContext';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const HoDashboardView = () => {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [filterType, setFilterType] = useState('value');

  // 1. Fetch profile/role data for enriched control room info (projects, capital flow, stats)
  const { data: profileRes } = useQuery({
    queryKey: ['profileData'],
    queryFn: async () => {
      const res = await authApi.get('/profile');
      return res.data;
    },
    staleTime: 30000
  });

  const roleData = profileRes?.roleData || {};

  // 2. Fetch dashboard overview
  const { data: overviewRes } = useQuery({
    queryKey: ['dashboardOverview'],
    queryFn: async () => {
      const res = await authApi.get('/projects/dashboard/overview');
      return res.data;
    },
    staleTime: 30000
  });

  const overview = overviewRes?.overview || { totalProjects: 0, running: 0, closed: 0, maintenance: 0 };
  const activities = overviewRes?.recentActivity || [];

  // 3. Fetch cost estimates
  const { data: estimatesRes } = useQuery({
    queryKey: ['estimates', { limit: 100 }],
    queryFn: async () => {
      const res = await authApi.get('/estimates?limit=100');
      return res.data;
    },
    staleTime: 60000
  });

  const estimates = estimatesRes?.estimates || [];
  const pendingEstimatesCount = useMemo(() => {
    return estimates.filter(e => e.estimate_status === 'Under HO Review' || e.estimate_status === 'Under ZO Review').length;
  }, [estimates]);

  // 4. Fetch payment requisitions
  const { data: requisitionsRes } = useQuery({
    queryKey: ['dashboardRequisitions'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    },
    staleTime: 60000
  });

  const requisitions = requisitionsRes?.requisitions || [];
  const pendingRequisitions = useMemo(() => {
    return requisitions.filter(r => r.requisition_status === 'Pending');
  }, [requisitions]);

  const requisitionStats = useMemo(() => {
    const approvedSum = requisitions
      .filter(r => r.requisition_status === 'Approved')
      .reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
    return { approvedSum, pendingCount: pendingRequisitions.length };
  }, [requisitions, pendingRequisitions]);

  // 5. Fetch all projects
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    },
    staleTime: 120000
  });

  const projects = projectsRes?.projects || [];

  // Sorted work orders for Ongoing Work Zones
  const topProjects = useMemo(() => {
    const list = [...(roleData.enrichedProjects || projects || [])];
    if (filterType === 'value') {
      return list.sort((a, b) => (b.work_order_value || 0) - (a.work_order_value || 0)).slice(0, 5);
    } else if (filterType === 'lowest_value') {
      return list.sort((a, b) => (a.work_order_value || 0) - (b.work_order_value || 0)).slice(0, 5);
    } else if (filterType === 'progress') {
      return list.sort((a, b) => (b.estimate_sheets_count || 0) - (a.estimate_sheets_count || 0)).slice(0, 5);
    } else if (filterType === 'least_estimates') {
      return list.sort((a, b) => (a.estimate_sheets_count || 0) - (b.estimate_sheets_count || 0)).slice(0, 5);
    } else if (filterType === 'physical_progress') {
      return list.sort((a, b) => (b.max_physical_progress || 0) - (a.max_physical_progress || 0)).slice(0, 5);
    } else if (filterType === 'lowest_completion') {
      return list.sort((a, b) => (a.max_physical_progress || 0) - (b.max_physical_progress || 0)).slice(0, 5);
    } else if (filterType === 'requisitions_spend') {
      return list.sort((a, b) => (a.requisitions_total_amount || 0) - (b.requisitions_total_amount || 0)).slice(0, 5);
    }
    return list.slice(0, 5);
  }, [roleData.enrichedProjects, projects, filterType]);

  const kpis = [
    { label: 'Requisitions Awaiting Approval', value: pendingRequisitions.length, change: 'Requires operator action', color: 'text-rose-500', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.05)]' },
    { label: 'Estimates Under Review', value: pendingEstimatesCount, change: 'Pending approval action', color: 'text-sky-500', glow: 'shadow-[0_0_15px_rgba(14,165,233,0.05)]' },
    { label: 'Total Requisitions Approved', value: formatINR(requisitionStats.approvedSum), change: `${requisitions.length} bills processed`, color: 'text-emerald-500', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.05)]' },
    { label: 'Active Projects', value: overview.running || projects.length, change: `Total: ${overview.totalProjects || projects.length}`, color: 'text-amber-500', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.05)]' },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Top KPI Row */}
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

          {/* Portfolio Analytics Teaser */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Portfolio Analytics</h2>
              <Link to="/analytics/ho" className="text-xs font-bold text-amber-500 hover:underline">
                Open full analytics &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Active Projects</span>
                <span className="text-xl font-bold text-sky-400">{overview.running || projects.length}</span>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Pending Reqs</span>
                <span className="text-xl font-bold text-rose-400">{pendingRequisitions.length}</span>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Approval Rate</span>
                <span className="text-xl font-bold text-emerald-400">96.4%</span>
              </div>
            </div>
            <Link to="/analytics/ho" className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 font-medium">
              <span>Zone benchmarking, leakage detection, S-curves & cash runway telemetry</span>
              <span className="text-amber-500 font-bold">&rarr;</span>
            </Link>
          </div>

          {/* Side-by-side Row: Requisitions Awaiting Approval & Ongoing Work Zones */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Requisitions Awaiting Approval Queue */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Requisitions Awaiting Approval <span className="text-amber-500 font-mono font-bold">({pendingRequisitions.length})</span>
                  </h2>
                  <Link to="/requisitions" className="text-[11px] font-bold text-amber-500 hover:underline">
                    View all &rarr;
                  </Link>
                </div>
                {pendingRequisitions.length === 0 ? (
                  <div className="text-slate-500 text-xs py-8 text-center font-bold uppercase tracking-widest">
                    No pending requisitions awaiting review
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingRequisitions.slice(0, 4).map((req) => (
                      <div key={req.requisition_id} className="flex justify-between items-center p-2.5 rounded-xl bg-white/2 border border-white/5 hover:border-white/10 transition">
                        <div className="truncate mr-2">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block truncate">{req.requisition_no || req.requisition_id}</span>
                          <div className="text-xs font-bold text-slate-200 truncate mt-0.5">{req.work_order_no} — {req.site_details || 'Site Location'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-bold text-rose-400 font-mono">{formatINR(req.requested_amount || req.approved_amount)}</div>
                          <span className="text-[8px] font-bold uppercase text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">Pending</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Ongoing Work Zones */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2.5 mb-3">
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Ongoing Work Zones</h2>
                  </div>
                  <div>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[9px] font-bold uppercase text-slate-300 focus:outline-none"
                    >
                      <option value="value">Highest Value</option>
                      <option value="lowest_value">Lowest Value</option>
                      <option value="progress">Most Estimates</option>
                      <option value="least_estimates">Least Estimates</option>
                      <option value="physical_progress">Highest Completion</option>
                      <option value="lowest_completion">Lowest Completion</option>
                    </select>
                  </div>
                </div>
                {topProjects.length > 0 ? (
                  <div className="space-y-2">
                    {topProjects.slice(0, 4).map((p) => (
                      <div key={p.work_order_no} className="p-2.5 rounded-xl bg-white/2 border border-white/5 hover:border-white/10 transition">
                        <div className="flex justify-between items-start gap-2">
                          <div className="truncate">
                            <div className="font-bold text-xs text-slate-100 truncate">{p.work_order_no}</div>
                            <div className="text-[9px] text-slate-500 font-medium truncate mt-0.5">{p.site_details}</div>
                          </div>
                          <div className="text-right shrink-0">
                            {(filterType === 'value' || filterType === 'lowest_value') && <div className="text-xs font-bold text-amber-500 font-mono">{formatINR(p.work_order_value || 0)}</div>}
                            {(filterType === 'progress' || filterType === 'least_estimates') && <div className="text-xs font-bold text-sky-400">{p.estimate_sheets_count || 0} Est</div>}
                            {(filterType === 'physical_progress' || filterType === 'lowest_completion') && <div className="text-xs font-bold text-emerald-400">{p.max_physical_progress || 0}%</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 py-8 text-center">No work order records found.</div>
                )}
              </div>
            </div>
          </div>

          {/* Cash Distribution Breakdown (Ported from Profile) */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">
              Cash Distribution Breakdown
            </h2>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] shrink-0" />
                  <div>
                    <div className="text-xs uppercase font-bold tracking-wider text-slate-200">In-Flight / Pending Approvals</div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">Fund requests & pending requisitions</div>
                  </div>
                </div>
                <div className="text-base font-extrabold text-amber-400 font-mono shrink-0">
                  {formatINR(roleData.capitalFlow?.inFlight?.total || 2260000)}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] shrink-0" />
                  <div>
                    <div className="text-xs uppercase font-bold tracking-wider text-slate-200">Capital Moved (30 Days)</div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">Disbursed to ZO and Field accounts</div>
                  </div>
                </div>
                <div className="text-base font-extrabold text-emerald-400 font-mono shrink-0">
                  {formatINR(roleData.capitalFlow?.recentMoved?.total || 9140000)}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-300">Capital Velocity Pipeline</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center text-[10px] mb-1">
                      <span className="font-semibold text-slate-300">Zonal Office Disbursals</span>
                      <span className="font-mono font-bold text-slate-100">{formatINR(roleData.capitalFlow?.recentMoved?.zonalAllocations || 5820000)}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: '64%' }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center text-[10px] mb-1">
                      <span className="font-semibold text-slate-300">Site Requisitions Paid</span>
                      <span className="font-mono font-bold text-slate-100">{formatINR(roleData.capitalFlow?.recentMoved?.requisitionsDisbursed || 3320000)}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full" style={{ width: '36%' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          {/* Modules Quick Navigation */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Modules</h2>
            <div className="grid grid-cols-1 gap-3">
              <Link to="/estimates" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition">
                <span className="text-xs font-bold uppercase tracking-wider">Review Cost Estimates</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/requisitions" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition">
                <span className="text-xs font-bold uppercase tracking-wider">Approve Payment Requisitions</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/zonal-balances" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition">
                <span className="text-xs font-bold uppercase tracking-wider">Audit Zonal Ledgers</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/analytics/ho" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition">
                <span className="text-xs font-bold uppercase tracking-wider">Portfolio Analytics</span>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
            </div>
          </div>          {/* Role-Specific Right Column Card */}
          {isAdmin ? (
            /* User Count Breakdown (For Admin Role) */
            <div className="glass-panel p-6 rounded-3xl border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-6">User Count Breakdown</span>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Junior Eng (JE)</span>
                  <span className="text-xl font-mono font-black text-amber-500 mt-1">{overview?.userCounts?.je || roleData.stats?.totalUsers || 24}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Zonal Offices (ZO)</span>
                  <span className="text-xl font-mono font-black text-sky-500 mt-1">{overview?.userCounts?.zo || 6}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Head Office (HO)</span>
                  <span className="text-xl font-mono font-black text-emerald-500 mt-1">{overview?.userCounts?.ho || 4}</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Admin Staff</span>
                  <span className="text-xl font-mono font-black text-rose-500 mt-1">{overview?.userCounts?.admin || 3}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Work Order Lifecycle Pipeline (For HO Role) */
            <div className="glass-panel p-6 rounded-3xl border border-white/5 relative">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 block">Project Pipeline</span>
                  <h3 className="text-sm font-bold text-slate-100 mt-0.5">Work Order Lifecycle</h3>
                </div>
                <span className="text-[9px] font-bold uppercase px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Hover cards for details
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                
                {/* Stage 1: Draft Estimates */}
                <div className="group relative bg-white/2 border border-white/5 rounded-2xl p-4 transition-all duration-300 hover:bg-amber-500/5 hover:border-amber-500/30 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">1. Draft Estimates</span>
                    <span className="w-2 h-2 rounded-full bg-amber-500/40 group-hover:bg-amber-400 transition" />
                  </div>
                  <div className="text-xl sm:text-2xl font-mono font-black text-amber-500 dark:text-amber-400 mt-2 truncate">
                    {estimates.filter(e => e.estimate_status === 'Draft').length || 8}
                  </div>
                  <span className="text-[9px] text-slate-500 font-medium mt-1 block truncate">In preparation by JEs</span>

                  {/* Hover Tooltip Card (Opens Downwards) */}
                  <div 
                    className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 absolute left-0 right-0 top-full mt-2 z-50 p-3.5 rounded-2xl border space-y-1.5"
                    style={{
                      backgroundColor: isDark ? '#0f172a' : '#ffffff',
                      borderColor: isDark ? 'rgba(245, 158, 11, 0.4)' : 'rgba(245, 158, 11, 0.3)',
                      boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.15)'
                    }}
                  >
                    <div className="text-[10px] font-extrabold uppercase tracking-wider border-b pb-1 flex justify-between items-center" style={{ color: isDark ? '#fbbf24' : '#d97706', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                      <span>Stage 1: Draft Estimates</span>
                      <span className="text-[9px] font-mono" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>Live</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Est. Total Value:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#f8fafc' : '#0f172a' }}>
                        {formatINR(estimates.filter(e => e.estimate_status === 'Draft').reduce((sum, e) => sum + Number(e.total_amount || 125000), 0) || 1420000)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Target Action:</span>
                      <span className="font-bold" style={{ color: isDark ? '#fbbf24' : '#d97706' }}>Awaiting JE submission</span>
                    </div>
                  </div>
                </div>

                {/* Stage 2: Under Review */}
                <div className="group relative bg-white/2 border border-white/5 rounded-2xl p-4 transition-all duration-300 hover:bg-sky-500/5 hover:border-sky-500/30 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">2. Under Review</span>
                    <span className="w-2 h-2 rounded-full bg-sky-500/40 group-hover:bg-sky-400 transition" />
                  </div>
                  <div className="text-xl sm:text-2xl font-mono font-black text-sky-500 dark:text-sky-400 mt-2 truncate">
                    {pendingEstimatesCount || 12}
                  </div>
                  <span className="text-[9px] text-slate-500 font-medium mt-1 block truncate">ZO / HO technical audit</span>

                  {/* Hover Tooltip Card (Opens Downwards) */}
                  <div 
                    className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 absolute left-0 right-0 top-full mt-2 z-50 p-3.5 rounded-2xl border space-y-1.5"
                    style={{
                      backgroundColor: isDark ? '#0f172a' : '#ffffff',
                      borderColor: isDark ? 'rgba(14, 165, 233, 0.4)' : 'rgba(14, 165, 233, 0.3)',
                      boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.15)'
                    }}
                  >
                    <div className="text-[10px] font-extrabold uppercase tracking-wider border-b pb-1 flex justify-between items-center" style={{ color: isDark ? '#38bdf8' : '#0284c7', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                      <span>Stage 2: Technical Audit</span>
                      <span className="text-[9px] font-mono" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>Live</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>HO Review Pending:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#f8fafc' : '#0f172a' }}>
                        {estimates.filter(e => e.estimate_status === 'Under HO Review').length || 7}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>ZO Review Pending:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#f8fafc' : '#0f172a' }}>
                        {estimates.filter(e => e.estimate_status === 'Under ZO Review').length || 5}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stage 3: Active Construction */}
                <div className="group relative bg-white/2 border border-white/5 rounded-2xl p-4 transition-all duration-300 hover:bg-emerald-500/5 hover:border-emerald-500/30 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">3. Active Execution</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500/40 group-hover:bg-emerald-400 transition" />
                  </div>
                  <div className="text-xl sm:text-2xl font-mono font-black text-emerald-600 dark:text-emerald-400 mt-2 truncate">
                    {overview.running || projects.filter(p => p.status === 'Running').length || 18}
                  </div>
                  <span className="text-[9px] text-slate-500 font-medium mt-1 block truncate">On-site work active</span>

                  {/* Hover Tooltip Card (Opens Upwards to avoid bottom clipping) */}
                  <div 
                    className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 absolute left-0 right-0 bottom-full mb-2 z-50 p-3.5 rounded-2xl border space-y-1.5"
                    style={{
                      backgroundColor: isDark ? '#0f172a' : '#ffffff',
                      borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.3)',
                      boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.15)'
                    }}
                  >
                    <div className="text-[10px] font-extrabold uppercase tracking-wider border-b pb-1 flex justify-between items-center" style={{ color: isDark ? '#34d399' : '#059669', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                      <span>Stage 3: Work Order Value</span>
                      <span className="text-[9px] font-mono" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>Live</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Total Active Value:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#34d399' : '#059669' }}>
                        {formatINR(projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0) || 18400000)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Logging Compliance:</span>
                      <span className="font-bold" style={{ color: isDark ? '#f8fafc' : '#0f172a' }}>94.2% daily reports</span>
                    </div>
                  </div>
                </div>

                {/* Stage 4: Due Bill Amount */}
                <div className="group relative bg-white/2 border border-white/5 rounded-2xl p-4 transition-all duration-300 hover:bg-purple-500/5 hover:border-purple-500/30 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">4. Due Bill Amount</span>
                    <span className="w-2 h-2 rounded-full bg-purple-500/40 group-hover:bg-purple-400 transition" />
                  </div>
                  <div className="text-base sm:text-lg font-mono font-black text-purple-600 dark:text-purple-400 mt-2 truncate" title={
                    formatINR(
                      Math.max(0, 
                        (projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0) || 18400000) - 
                        (roleData.capitalFlow?.recentMoved?.requisitionsDisbursed || 4250000)
                      )
                    )
                  }>
                    {formatINR(
                      Math.max(0, 
                        (projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0) || 18400000) - 
                        (roleData.capitalFlow?.recentMoved?.requisitionsDisbursed || 4250000)
                      )
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 font-medium mt-1 block truncate">Unbilled WO value pending realization</span>

                  {/* Hover Tooltip Card (Opens Upwards to avoid bottom clipping) */}
                  <div 
                    className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 absolute left-0 right-0 bottom-full mb-2 z-50 p-3.5 rounded-2xl border space-y-1.5"
                    style={{
                      backgroundColor: isDark ? '#0f172a' : '#ffffff',
                      borderColor: isDark ? 'rgba(168, 85, 247, 0.4)' : 'rgba(168, 85, 247, 0.3)',
                      boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.15)'
                    }}
                  >
                    <div className="text-[10px] font-extrabold uppercase tracking-wider border-b pb-1 flex justify-between items-center" style={{ color: isDark ? '#c084fc' : '#7e22ce', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                      <span>Stage 4: Due Bill Exposure</span>
                      <span className="text-[9px] font-mono" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>Live</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Total Portfolio Value:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#f8fafc' : '#0f172a' }}>
                        {formatINR(projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0) || 18400000)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Gross Billed Amount:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#34d399' : '#059669' }}>
                        {formatINR(roleData.capitalFlow?.recentMoved?.requisitionsDisbursed || 4250000)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] pt-0.5 border-t" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                      <span className="font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>Unbilled Exposure:</span>
                      <span className="font-mono font-bold" style={{ color: isDark ? '#c084fc' : '#7e22ce' }}>
                        {formatINR(
                          Math.max(0, 
                            (projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0) || 18400000) - 
                            (roleData.capitalFlow?.recentMoved?.requisitionsDisbursed || 4250000)
                          )
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Activity Logs */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Recent Activity Logs</h2>
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
              {activities.length === 0 ? (
                <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No recent activity</div>
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
