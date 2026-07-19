import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import BackgroundShapes from '../components/BackgroundShapes';
import { getZoProductivity, getRecentActivity } from '../api/analyticsApi';

const formatActivityDescription = (log) => {
  const user = log.user_name || 'System';
  const actionMap = {
    'CREATE': 'created a new',
    'EDIT': 'modified',
    'STATUS_CHANGE': 'updated the status of',
    'APPROVED': 'approved',
    'ZO_APPROVED': 'zonal-approved',
    'HO_APPROVED': 'final-approved',
    'REJECTED': 'rejected',
    'REVISION_REQUESTED': 'requested revisions for'
  };

  const actionText = actionMap[log.action] || log.action.toLowerCase();
  return (
    <span>
      <strong className="text-slate-200">{user}</strong> {actionText}{' '}
      <span className="text-amber-500 font-bold">{log.module_name}</span> (ID: <span className="font-mono text-slate-300">{log.record_identifier}</span>)
    </span>
  );
};

const ZoDashboard = () => {
  // 1. Fetch ZO JE Productivity/Utilization
  const { data: prodRes, isLoading: prodLoading, isError: prodErr } = useQuery({
    queryKey: ['zoProductivity'],
    queryFn: async () => {
      const res = await getZoProductivity();
      return res.data;
    }
  });

  // 2. Fetch Recent Activities (isolated by ZO scope)
  const { data: actRes, isLoading: actLoading, isError: actErr } = useQuery({
    queryKey: ['recentActivity'],
    queryFn: async () => {
      const res = await getRecentActivity();
      return res.data;
    }
  });

  const jeList = prodRes?.data || [];
  const activities = actRes?.activities || [];

  const [currentPage, setCurrentPage] = useState(1);
  const CARDS_PER_PAGE = 4;
  const totalPages = Math.ceil(jeList.length / CARDS_PER_PAGE);
  const paginatedJEs = jeList.slice((currentPage - 1) * CARDS_PER_PAGE, currentPage * CARDS_PER_PAGE);

  // Summary Metrics calculations
  const totalJEs = jeList.length;
  const activeProjectsSum = jeList.reduce((sum, item) => sum + Number(item.active_projects_count || 0), 0);
  const totalSubmissionsSum = jeList.reduce((sum, item) => sum + Number(item.total_reports_submitted || 0), 0);
  const longestStreak = jeList.length > 0 ? Math.max(...jeList.map(item => item.streak_days || 0)) : 0;

  const isPageLoading = prodLoading || actLoading;
  const isPageError = prodErr || actErr;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />

        <main className="flex-grow p-6 md:p-10 overflow-y-auto no-scrollbar max-w-7xl mx-auto w-full relative z-10">
          {/* Header Row */}
          <div className="mb-10 pb-6 border-b border-white/5">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Zonal Office Panel</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Zonal Analytics & Productivity</h1>
            <p className="text-xs text-slate-400 mt-1.5">Monitor Junior Engineers' reporting frequency, workload distribution, and live zone activity feed.</p>
          </div>

          {isPageError ? (
            <div className="glass-panel p-8 rounded-3xl border border-rose-500/10 bg-rose-950/5 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400 mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-base font-bold uppercase tracking-widest text-slate-200">Error Loading Zonal Analytics</h2>
              <p className="text-xs text-slate-500 mt-2">Failed to connect to analytics services. Please check database configuration.</p>
            </div>
          ) : isPageLoading ? (
            <div className="space-y-8">
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

              {/* Summary Cards Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Active JEs Card */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(245,158,11,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Junior Engineers</span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-amber-500">
                    {totalJEs} <span className="text-xs text-slate-500 font-bold">Active in Zone</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5">
                    Managing {activeProjectsSum} projects overall
                  </div>
                </div>

                {/* Submissions Card */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(16,185,129,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Progress Reports</span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-emerald-500">
                    {totalSubmissionsSum} <span className="text-xs text-slate-500 font-bold">Submitted</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5">
                    Cumulative submission count in zone
                  </div>
                </div>

                {/* Streaks Card */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(14,165,233,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Peak Reporting Streak</span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-sky-500">
                    {longestStreak} <span className="text-xs text-slate-500 font-bold">Days Active</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5">
                    Longest consecutive daily report streak
                  </div>
                </div>

                {/* Active Projects counter */}
                <div className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/10 shadow-[0_0_15px_rgba(99,102,241,0.02)]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Zonal Projects Load</span>
                  <div className="text-3xl font-black mt-2 tracking-tight text-indigo-400">
                    {activeProjectsSum} <span className="text-xs text-slate-500 font-bold">Sites</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold mt-1.5">
                    Average workload: {totalJEs > 0 ? (activeProjectsSum / totalJEs).toFixed(1) : 0} projects/JE
                  </div>
                </div>
              </div>

              {/* Grid Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Column 1 (2/3 width) - JE Performance & Workload Grid */}
                <div className="lg:col-span-2">
                  
                  {/* Engineer Productivity & Workload Grid */}
                  <div className="glass-panel p-6 rounded-3xl space-y-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/5 pb-4">
                      <div>
                        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Engineer Registry & Workload Density</h2>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-wider">Active regional engineering staff profiles</p>
                      </div>
                      
                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className={`p-1.5 rounded-lg border transition-all duration-300 ${
                              currentPage === 1 
                                ? 'border-transparent text-slate-600 cursor-not-allowed' 
                                : 'border-white/10 hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                            Page {currentPage} of {totalPages}
                          </span>
                          <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className={`p-1.5 rounded-lg border transition-all duration-300 ${
                              currentPage === totalPages 
                                ? 'border-transparent text-slate-600 cursor-not-allowed' 
                                : 'border-white/10 hover:bg-white/5 text-slate-300'
                            }`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {jeList.length === 0 ? (
                      <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest">No Junior Engineers mapped in this zone</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {paginatedJEs.map((row, idx) => {
                          const percentage = Math.min(100, ((row.active_projects_count || 0) / 10) * 100);
                          return (
                            <div key={idx} className="glass-panel p-5 rounded-2xl relative overflow-hidden transition-all duration-300 hover:border-white/15 bg-white/[0.01] flex flex-col justify-between min-h-[190px]">
                              {/* Top row */}
                              <div className="flex justify-between items-start gap-2">
                                <div className="truncate">
                                  <h3 className="text-xs font-black text-slate-200 truncate">{row.je_name || 'JE Operator'}</h3>
                                  <span className="text-[9px] font-mono text-slate-500 block mt-0.5">{row.je_user_id}</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shrink-0 ${
                                  row.streak_days >= 7 
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                    : row.streak_days >= 3
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    : 'bg-white/5 text-slate-400 border border-white/5'
                                }`}>
                                  🔥 {row.streak_days || 0}d Streak
                                </span>
                              </div>

                              {/* Stats / Metrics */}
                              <div className="grid grid-cols-2 gap-4 my-4 border-y border-white/5 py-3">
                                <div>
                                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block">Projects Mapped</span>
                                  <span className="text-sm font-black text-slate-300 mt-1 block">{row.active_projects_count || 0} Sites</span>
                                </div>
                                <div>
                                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block">Reports Filed</span>
                                  <span className="text-sm font-black text-slate-300 mt-1 block">{row.total_reports_submitted || 0} DPRs</span>
                                </div>
                              </div>

                              {/* Workload Progress Bar */}
                              <div className="space-y-1.5">
                                <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-slate-500">
                                  <span>Workload Load Factor</span>
                                  <span className="text-slate-300">{row.active_projects_count || 0}/10 projects</span>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                  <div
                                    className="h-full bg-gradient-to-r from-amber-500 to-indigo-500 rounded-full transition-all duration-1000"
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                              </div>

                              {/* Footer details */}
                              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-3 pt-2 border-t border-white/5 text-right">
                                Last Submission: {row.last_submission_date 
                                  ? new Date(row.last_submission_date).toLocaleDateString('en-IN') 
                                  : 'No submissions'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>

                {/* Column 2 (1/3 width) - Site Activity Feed */}
                <div className="glass-panel p-6 rounded-3xl flex flex-col">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Live Site Activities</h2>

                  {activities.length === 0 ? (
                    <div className="text-slate-500 text-xs py-16 text-center uppercase tracking-widest flex-grow flex items-center justify-center">
                      No recent activities logged
                    </div>
                  ) : (
                    <div className="space-y-6 overflow-y-auto no-scrollbar max-h-[580px] pr-2">
                      {activities.map((log, idx) => (
                        <div key={idx} className="relative pl-6 border-l border-white/10 pb-2 last:pb-0">
                          {/* Dot marker */}
                          <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                          
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] leading-relaxed text-slate-400">
                              {formatActivityDescription(log)}
                            </span>
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                              {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : ''}
                            </span>
                          </div>
                        </div>
                      ))}
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

export default ZoDashboard;
