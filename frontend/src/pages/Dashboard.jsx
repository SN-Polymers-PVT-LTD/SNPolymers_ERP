import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { Link } from 'react-router-dom';
import BackgroundShapes from '../components/BackgroundShapes';
import authApi from '../api/authApi';

const formatTimeAgo = (dateStr) => {
  if (!dateStr) return 'N/A';
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} mins ago`;
  
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs === 1) return '1 hour ago';
  if (diffHrs < 24) return `${diffHrs} hours ago`;
  
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
};

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [overview, setOverview] = useState({
    totalProjects: 20,
    running: 14,
    closed: 3,
    maintenance: 3,
    lastUpdatedProject: 'WB_APD_101',
    lastUpdatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
  });
  const [activities, setActivities] = useState([]);
  const [loadingOverview, setLoadingOverview] = useState(true);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        const res = await authApi.get('/projects/dashboard/overview');
        if (res.data?.success) {
          setOverview(res.data.overview);
          setActivities(res.data.recentActivity || []);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard overview:', err);
      } finally {
        setLoadingOverview(false);
      }
    };

    fetchOverview();
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      {/* Background Silhouettes & Ambient Glows */}
      <BackgroundShapes />

      {/* Left Sidebar Navigation - Desktop */}
      <aside className="hidden md:flex flex-col w-64 glass-nav border-r border-white/5 p-6 relative z-20 shrink-0">
        <div className="flex items-center gap-3.5 mb-10">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-10 w-auto object-contain" />
          <div className="flex flex-col">
            <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">
              S.N. Polymers
            </span>
            <span className="text-[9px] text-amber-500 font-extrabold tracking-widest uppercase">
              ERP Console
            </span>
          </div>
        </div>

        {/* Sidebar Nav Links */}
        <nav className="flex-grow space-y-2">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-100 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
            </svg>
            Command Center
          </Link>

          <Link
            to="/fund-reports"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
            </svg>
            Fund Reports
          </Link>

          {user?.role === 'admin' && (
            <>
              <Link
                to="/admin"
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Access Whitelist
              </Link>
              <Link
                to="/admin/master-data"
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Master Data
              </Link>
              <Link
                to="/admin/sessions"
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Audit Trail Logs
              </Link>
            </>
          )}
        </nav>

        {/* Operator Profile and Logout */}
        <div className="border-t border-white/5 pt-6 mt-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-extrabold text-slate-950 text-sm select-none shadow-md">
              {(user?.display_name || 'U')[0].toUpperCase()}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-xs font-extrabold text-slate-200 truncate">{user?.display_name || 'Operator'}</span>
              <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">{user?.role}</span>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Header bar for Mobile view */}
      <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-8 w-auto object-contain" />
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">S.N. Polymers</span>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <Link
              to="/admin"
              className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
            >
              Admin
            </Link>
          )}
          <button
            onClick={logout}
            className="text-[10px] bg-red-950/20 border border-red-900/30 text-red-400 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
          >
            Out
          </button>
        </div>
      </header>

      {/* Main Administrative Control Grid */}
      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Top welcome banner / header panel */}
        <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Authorized Operator Session</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Welcome back, {user?.display_name || user?.mobile_number}!</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Select an active ERP module to initiate session control.</p>
          </div>
          <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-2.5 shadow-md">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-300">Connection Secured</span>
          </div>
        </div>

        {/* Dashboard Grid Container */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main ERP Modules (Left & Center Columns) */}
          <div className="lg:col-span-2 space-y-8">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Enterprise Modules</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Module 1: Production (Future Module Placeholder) */}
              <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px]">
                <div className="absolute top-0 right-0 p-5 opacity-[0.03]">
                  <svg className="w-24 h-24 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Formulation Control</span>
                  <h3 className="text-lg font-extrabold mt-1 text-slate-200">Manufacturing Module</h3>
                  <p className="text-xs text-slate-400 font-normal mt-4 leading-relaxed">Contains formulation queues, chemical blending status logs, raw batch certifications, and warehouse inventory control.</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-[9px] uppercase tracking-widest font-extrabold text-amber-600 bg-amber-950/20 border border-amber-900/30 px-2 py-0.5 rounded-lg">Phase 2+ Rollout</span>
                  <span className="text-slate-500 text-xs font-bold select-none">Access Restricted</span>
                </div>
              </div>

              {/* Module 2: Projects – Now Live */}
              <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px] glow-border-active shadow-[0_8px_32px_rgba(245,158,11,0.04)]">
                <div className="absolute top-0 right-0 p-5 opacity-[0.05]">
                  <svg className="w-24 h-24 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Government Division</span>
                  <h3 className="text-lg font-extrabold mt-1 text-slate-200">Project Management</h3>
                  <p className="text-xs text-slate-400 font-normal mt-4 leading-relaxed">Oversees municipal contractor work schedules, infrastructure tender documents, civil log reports, and fund disbursement records.</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-[9px] uppercase tracking-widest font-extrabold text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded-lg">Active System</span>
                  <Link
                    to="/fund-reports"
                    className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-white text-slate-950 hover:bg-slate-100 hover:shadow-lg transition-all duration-300 flex items-center gap-1.5"
                  >
                    Open Fund Reports &rarr;
                  </Link>
                </div>
              </div>

              {/* Module 3: Active Workspace */}
              <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px] lg:col-span-2 glow-border-active shadow-[0_8px_32px_rgba(245,158,11,0.04)]">
                <div className="absolute top-0 right-0 p-5 opacity-[0.05]">
                  <svg className="w-24 h-24 text-amber-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ animationDuration: '4s' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11.5V10c0-2.5 2-4.5 4.5-4.5S18 7.5 18 10v1.5c0 3 .07 3.53 2.384 4.762A2 2 0 0120 19.5H8.293m0 0l-1.143-1.143M12 21a2 2 0 01-2-2h4a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Systems & Policy</span>
                  <h3 className="text-xl font-extrabold mt-1 text-slate-200">Office Administration Console</h3>
                  <p className="text-xs text-slate-300 font-normal mt-4 leading-relaxed max-w-xl">Central system configurations. Access control management, user authorization whitelist keys, live session tracking audits, security compliance metrics, and verification logs ledger.</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
                  <span className="text-[9px] uppercase tracking-widest font-extrabold text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded-lg">Active System</span>
                  {user?.role === 'admin' ? (
                    <Link
                      to="/admin"
                      className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-white text-slate-950 hover:bg-slate-100 hover:shadow-lg transition-all duration-300 flex items-center gap-1.5"
                    >
                      Manage System Whitelist &rarr;
                    </Link>
                  ) : (
                    <span className="text-slate-400 text-xs font-bold select-none">Permissions Validated</span>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Right Sidebar Stats & Info widgets */}
          <div className="space-y-8">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Project Operations Overview</h2>
            
            {/* Operator Card widget */}
            <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Operator Information</span>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs pb-3 border-b border-white/5">
                  <span className="text-slate-400 font-semibold">Operator ID</span>
                  <span className="font-mono font-bold text-slate-200">{user?.mobile_number}</span>
                </div>
                <div className="flex justify-between items-center text-xs pb-3 border-b border-white/5">
                  <span className="text-slate-400 font-semibold">Access Privilege</span>
                  <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider bg-indigo-950/40 text-indigo-400 border border-indigo-900/30">
                    {user?.role}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-semibold">Firewall Gate</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    VERIFIED
                  </span>
                </div>
              </div>
            </div>

            {/* Project Overview widget */}
            <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Project Overview</span>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Total Projects</span>
                  <span className="text-2xl font-extrabold text-white mt-1">{overview.totalProjects}</span>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-4 flex flex-col justify-between">
                  <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold">Running</span>
                  <span className="text-2xl font-extrabold text-emerald-400 mt-1">{overview.running}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs p-3 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-slate-400 font-medium">Closed</span>
                  <span className="font-extrabold text-slate-200">{overview.closed}</span>
                </div>
                
                <div className="flex justify-between items-center text-xs p-3 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-slate-400 font-medium">Under Maintenance</span>
                  <span className="font-extrabold text-amber-500">{overview.maintenance}</span>
                </div>

                <div className="border-t border-white/5 pt-3 mt-1 flex flex-col">
                  <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Last Project Updated</span>
                  <div className="flex justify-between items-end mt-1">
                    <span className="text-xs font-mono font-bold text-amber-400">{overview.lastUpdatedProject}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{formatTimeAgo(overview.lastUpdatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity widget */}
            <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Recent Activity</span>
              <div className="space-y-4">
                {activities.length > 0 ? (
                  activities.map((act, idx) => (
                    <div key={act.id || idx} className="flex gap-3 text-xs leading-relaxed items-start">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0 animate-pulse"></span>
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-medium">{act.message}</span>
                        <span className="text-[9px] text-slate-500 mt-0.5">{formatTimeAgo(act.timestamp)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex gap-3 text-xs leading-relaxed items-start">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-medium">Shreyan updated WB_APD_101</span>
                        <span className="text-[9px] text-slate-500 mt-0.5">2 mins ago</span>
                      </div>
                    </div>
                    <div className="flex gap-3 text-xs leading-relaxed items-start">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-medium">Aswint closed BH_BEG_505</span>
                        <span className="text-[9px] text-slate-500 mt-0.5">15 mins ago</span>
                      </div>
                    </div>
                    <div className="flex gap-3 text-xs leading-relaxed items-start">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-medium">New Fund Report submitted</span>
                        <span className="text-[9px] text-slate-500 mt-0.5">1 hour ago</span>
                      </div>
                    </div>
                    <div className="flex gap-3 text-xs leading-relaxed items-start">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                      <div className="flex flex-col">
                        <span className="text-slate-300 font-medium">Project WB_PUR_602 reopened</span>
                        <span className="text-[9px] text-slate-500 mt-0.5">3 hours ago</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>

        </div>

      </main>
    </div>
  );
};

export default Dashboard;
