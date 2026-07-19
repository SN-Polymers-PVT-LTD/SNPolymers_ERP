import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import BackgroundShapes from '../components/BackgroundShapes';
import {
  getHoKpis,
  getHoZoneBenchmarking,
  getHoBudgetLeakage,
  refreshAnalyticsViews
} from '../api/analyticsApi';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const InfoTooltip = ({ content, position = 'center' }) => {
  const positionClasses = {
    center: 'left-1/2 -translate-x-1/2 origin-bottom',
    left: 'left-0 origin-bottom-left',
    right: 'right-0 origin-bottom-right'
  };

  const arrowClasses = {
    center: 'left-1/2 -translate-x-1/2',
    left: 'left-4',
    right: 'right-4'
  };

  return (
    <div className="relative group ml-1.5 inline-block align-middle cursor-pointer">
      <svg className="w-3.5 h-3.5 text-slate-400 hover:text-amber-500 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div className={`absolute bottom-full mb-2 w-56 p-2.5 rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-md text-[10px] text-slate-300 font-semibold tracking-wide leading-relaxed shadow-2xl opacity-0 scale-95 pointer-events-none transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 z-50 ${positionClasses[position]}`}>
        {content}
        <div className={`absolute top-full border-4 border-transparent border-t-slate-950 ${arrowClasses[position]}`} />
      </div>
    </div>
  );
};

const HoDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [alertMsg, setAlertMsg] = useState(null);
  const [alertType, setAlertType] = useState('success'); // 'success' or 'error'
  const [exploreWo, setExploreWo] = useState('');

  // 1. Fetch HO KPIs
  const { data: kpiRes, isLoading: kpiLoading, isError: kpiErr } = useQuery({
    queryKey: ['hoKpis'],
    queryFn: async () => {
      const res = await getHoKpis();
      return res.data;
    }
  });

  // 2. Fetch Zonal Benchmarking
  const { data: zoneRes, isLoading: zoneLoading, isError: zoneErr } = useQuery({
    queryKey: ['hoZoneBenchmarking'],
    queryFn: async () => {
      const res = await getHoZoneBenchmarking();
      return res.data;
    }
  });

  // 3. Fetch Budget Leakages
  const { data: leakageRes, isLoading: leakageLoading, isError: leakageErr } = useQuery({
    queryKey: ['hoBudgetLeakage'],
    queryFn: async () => {
      const res = await getHoBudgetLeakage();
      return res.data;
    }
  });

  // 4. Mutation to trigger manual DB materialized view refresh
  const refreshMutation = useMutation({
    mutationFn: refreshAnalyticsViews,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hoKpis'] });
      queryClient.invalidateQueries({ queryKey: ['hoZoneBenchmarking'] });
      queryClient.invalidateQueries({ queryKey: ['hoBudgetLeakage'] });
      showToast('Database views refreshed successfully!', 'success');
    },
    onError: (err) => {
      console.error(err);
      showToast(err.response?.data?.message || 'Failed to refresh views.', 'error');
    }
  });

  const showToast = (msg, type) => {
    setAlertMsg(msg);
    setAlertType(type);
    setTimeout(() => {
      setAlertMsg(null);
    }, 4000);
  };

  const kpis = kpiRes?.kpis || null;
  const healthDistribution = kpiRes?.healthDistribution || { Healthy: 0, Warning: 0, Critical: 0 };
  const zones = zoneRes?.data || [];
  const leakages = leakageRes?.data || [];

  const [zonePage, setZonePage] = useState(1);
  const ZONES_PER_PAGE = 5;
  const totalZonePages = Math.ceil(zones.length / ZONES_PER_PAGE);
  const paginatedZones = zones.slice((zonePage - 1) * ZONES_PER_PAGE, zonePage * ZONES_PER_PAGE);

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  const isPageLoading = kpiLoading || zoneLoading || leakageLoading;
  const isPageError = kpiErr || zoneErr || leakageErr;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />

        <main className="flex-grow p-6 md:p-10 overflow-y-auto no-scrollbar max-w-7xl mx-auto w-full relative z-10">
          
          {/* Toast Notification */}
          {alertMsg && (
            <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-3 border transition-all duration-300 ${
              alertType === 'success' 
                ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-400' 
                : 'bg-rose-950/80 border-rose-500/30 text-rose-400'
            }`}>
              <span className="text-sm font-bold tracking-wide">{alertMsg}</span>
              <button onClick={() => setAlertMsg(null)} className="text-slate-400 hover:text-white">&times;</button>
            </div>
          )}

          {/* Header Row */}
          <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Executive HQ Panel</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Portfolio Performance Analytics</h1>
              <p className="text-xs text-slate-400 mt-1.5">Consolidated portfolio KPIs, zonal performance benchmarking, and cost leakage anomalies.</p>
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshMutation.isPending}
              className={`px-5 py-2.5 rounded-xl border border-white/10 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all duration-300 ${
                refreshMutation.isPending 
                  ? 'bg-white/5 text-slate-400 cursor-not-allowed' 
                  : 'bg-white hover:bg-white/90 text-slate-950'
              }`}
            >
              <svg className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
              </svg>
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Views'}
            </button>
          </div>

          {isPageError ? (
            <div className="glass-panel p-8 rounded-3xl border border-rose-500/10 bg-rose-950/5 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400 mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-base font-bold uppercase tracking-widest text-slate-200">Error Loading Analytics</h2>
              <p className="text-xs text-slate-500 mt-2 max-w-sm">We had trouble communicating with the backend. Please check the DB connection or click refresh.</p>
            </div>
          ) : isPageLoading ? (
            <div className="space-y-8">
              {/* Skeleton Loaders */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map(idx => (
                  <div key={idx} className="glass-panel p-6 rounded-3xl animate-pulse h-32 bg-white/[0.02]" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02]" />
                <div className="glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02]" />
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              
              {/* KPI Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Active Projects KPI */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(245,158,11,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Project Portfolio
                    <InfoTooltip content="Active projects relative to the total portfolio, categorized by health status." position="left" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-amber-500">
                    {kpis?.active_projects || 0} <span className="text-xs text-slate-500 font-bold">/ {kpis?.total_projects || 0} Active</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 flex gap-2">
                    <span className="text-emerald-400">{healthDistribution.Healthy || 0} Healthy</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-rose-400">{healthDistribution.Critical || 0} Critical</span>
                  </div>
                </div>

                {/* Budget Utilization KPI */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(16,185,129,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Budget Utilization
                    <InfoTooltip content="Percentage of total budget spent relative to total allocated budget." position="center" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-emerald-500">
                    {kpis?.budget_utilization_pct ? `${Number(kpis.budget_utilization_pct).toFixed(1)}%` : '0%'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 truncate">
                    Spent {formatINR(kpis?.total_spent)} of {formatINR(kpis?.total_budget)}
                  </div>
                </div>

                {/* Warnings / Risks KPI */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(244,63,94,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    Critical Anomaly Risk
                    <InfoTooltip content="Number of projects currently marked as Critical risk or carrying warnings." position="center" />
                  </span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-rose-500 flex items-baseline gap-2">
                    {kpis?.projects_at_risk || 0}
                    <span className="text-xs text-slate-500 font-bold">at Risk</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5 flex gap-2">
                    <span className="text-amber-400">{kpis?.projects_at_warning || 0} warnings pending review</span>
                  </div>
                </div>

                {/* Radial Gauge / Portfolio Health */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 flex items-center justify-between shadow-[0_0_15px_rgba(99,102,241,0.02)]">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      Portfolio Health
                      <InfoTooltip content="Weighted health average based on active projects' individual health score." position="right" />
                    </span>
                    <div className="text-3xl font-black mt-2 tracking-tight text-indigo-400">
                      {kpis?.average_project_health ? `${Math.round(kpis.average_project_health)}%` : '0%'}
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest font-black block mt-1">Average Score</span>
                  </div>

                  {/* SVG circular progress */}
                  <div className="relative w-16 h-16">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-white/5"
                        strokeWidth="3"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-indigo-500 transition-all duration-1000 ease-out"
                        strokeDasharray={`${kpis?.average_project_health || 0}, 100`}
                        strokeWidth="3"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-300">
                      {kpis?.average_project_health ? `${Math.round(kpis.average_project_health)}` : '0'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Middle Section Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Zonal Benchmarking (2/3 width) */}
                {/* Column wrapper for Zonal Benchmarking & Twin Explorer (2/3 width) */}
                <div className="lg:col-span-2 space-y-8">
                  {/* Zonal Benchmarking */}
                  <div className="glass-panel p-6 rounded-3xl flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                            Zonal Benchmarking
                            <InfoTooltip content="Aggregated performance, slack days, and health scores compared across all Zones." position="left" />
                          </h2>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider">Performance metrics aggregated by zone</p>
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Ranked by Health</span>
                      </div>

                      {zones.length === 0 ? (
                        <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest">No active zones logged</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/5 pb-3">
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Rank</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Zone</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Active Projects</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Avg Slack Days</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Health Score</th>
                                <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {paginatedZones.map((row, idx) => {
                                const score = Number(row.average_health_score || 0);
                                const rating = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : 'Warning';
                                const rank = (zonePage - 1) * ZONES_PER_PAGE + idx + 1;

                                return (
                                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                                    <td className="py-4 text-xs font-extrabold text-amber-500">#{rank}</td>
                                    <td className="py-4 text-xs font-bold text-slate-200">{row.zone}</td>
                                    <td className="py-4 text-xs font-bold text-slate-400 text-center">{row.active_projects || 0}</td>
                                    <td className={`py-4 text-xs font-bold text-center ${row.average_timeline_slack_days > 15 ? 'text-rose-400' : 'text-slate-400'}`}>
                                      {row.average_timeline_slack_days || 0}d
                                    </td>
                                    <td className="py-4 text-xs font-bold text-slate-200 text-center">{Math.round(score)}%</td>
                                    <td className="py-4 text-right">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                        rating === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                        rating === 'Good' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      }`}>
                                        {rating}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Pagination Controls */}
                    {totalZonePages > 1 && (
                      <div className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-4 mt-6">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                          Page {zonePage} of {totalZonePages} <span className="text-slate-600">({zones.length} zones total)</span>
                        </span>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => setZonePage(prev => Math.max(1, prev - 1))}
                            disabled={zonePage === 1}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                              zonePage === 1 
                                ? 'border-transparent text-slate-600 cursor-not-allowed' 
                                : 'border-white/10 hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            Prev
                          </button>
                          <button
                            onClick={() => setZonePage(prev => Math.min(totalZonePages, prev + 1))}
                            disabled={zonePage === totalZonePages}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                              zonePage === totalZonePages 
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

                  {/* Digital Twin Simulation Explorer */}
                  <div className="glass-panel p-6 rounded-3xl flex flex-col justify-between">
                    <div>
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-1">
                        Digital Twin Explorer
                        <InfoTooltip content="Launch the interactive digital twin view of a project using its Work Order number." position="left" />
                      </h2>
                      <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider mb-6">
                        Retrieve live digital twin performance scores
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (exploreWo.trim()) {
                            navigate(`/projects/${exploreWo.trim()}/digital-twin`);
                          }
                        }}
                        className="flex gap-4 items-center"
                      >
                        <input
                          type="text"
                          placeholder="Enter Work Order No. (e.g. WO-01)"
                          value={exploreWo}
                          onChange={(e) => setExploreWo(e.target.value)}
                          className="bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/50 flex-grow"
                        />
                        <button
                          type="submit"
                          disabled={!exploreWo.trim()}
                          className={`px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                            exploreWo.trim()
                              ? 'bg-white hover:bg-white/90 text-slate-950'
                              : 'bg-white/5 border border-transparent text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Launch Twin
                        </button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Budget Leakage Anomalies (1/3 width) */}
                <div className="glass-panel p-6 rounded-3xl flex flex-col h-fit">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      Budget Leakages
                      <InfoTooltip content="Projects flagging significant cost overruns or high revision counts." position="right" />
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
                      Anomalies
                    </span>
                  </div>

                  {leakages.length === 0 ? (
                    <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest flex-grow flex items-center justify-center">
                      No overruns detected
                    </div>
                  ) : (
                    <div className="space-y-4 overflow-y-auto no-scrollbar max-h-[380px]">
                      {leakages.map((item, idx) => {
                        const score = Number(item.anomaly_score || 0);
                        const severityColor = score >= 80 
                          ? 'border-rose-500/20 bg-rose-950/10 text-rose-400 hover:border-rose-500/40' 
                          : score >= 50
                          ? 'border-amber-500/20 bg-amber-950/10 text-amber-400 hover:border-amber-500/40'
                          : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/15';

                        const overrunPct = Math.max(0, Number(item.budget_variance_pct || 0) - 100);

                        return (
                          <div
                            key={idx}
                            onClick={() => navigate(`/projects/${item.work_order_no}/digital-twin`)}
                            className={`p-4 rounded-2xl border transition-all duration-300 cursor-pointer hover:scale-[1.02] flex flex-col gap-2 ${severityColor}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="truncate pr-2">
                                <span className="text-[10px] font-black uppercase tracking-wider block truncate text-slate-300">
                                  {item.site_details || 'Site Project'}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest block mt-0.5">
                                  {item.work_order_no}
                                </span>
                              </div>
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-black/30 shrink-0">
                                Score: {Math.round(score)}
                              </span>
                            </div>

                            {/* Mini horizontal bar representing anomaly score */}
                            <div className="space-y-1 mt-1">
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                                <div
                                  className={`h-full rounded-full transition-all duration-1000 ${
                                    score >= 6 ? 'bg-rose-500' : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${(score / 8) * 100}%` }}
                                />
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-[10px] font-semibold pt-1.5 border-t border-white/5 mt-1">
                              <div>
                                <span className="text-slate-500">Overrun: </span>
                                <span className="font-extrabold text-rose-400">+{Number(overrunPct).toFixed(1)}%</span>
                              </div>
                              <div className="text-slate-500">
                                Revisions: <span className="text-slate-300 font-extrabold">{item.estimate_revisions_count || 0}</span>
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
          )}

        </main>
      </div>
    </div>
  );
};

export default HoDashboard;
