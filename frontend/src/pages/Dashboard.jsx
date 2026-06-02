import React from 'react';
import { useAuth } from '../components/AuthContext';
import { Link } from 'react-router-dom';

const Dashboard = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex flex-col font-sans">
      
      {/* Admin / Operations Header Bar */}
      <header className="border-b border-admin-border/80 bg-admin-bg/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center font-bold text-slate-100 text-sm shadow">
              SNP
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xs tracking-wider text-slate-100 uppercase">
                S.N. Polymers Console
              </span>
              <span className="text-[9px] text-amber-500 font-bold tracking-wider uppercase">
                Authorized Session
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-bold uppercase tracking-wider px-3 py-1.5 rounded transition"
              >
                Access Whitelist Admin
              </Link>
            )}
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Operator ID</span>
              <span className="text-xs font-bold text-slate-200">{user?.display_name || user?.mobile_number}</span>
            </div>
            <button
              onClick={logout}
              className="text-[11px] font-bold bg-red-950/20 border border-red-900/40 hover:bg-red-900/40 text-red-400 uppercase tracking-wider px-3 py-1.5 rounded transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Administrative Control Grid */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-10">
        <div className="mb-8 border-b border-admin-border/60 pb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-wider text-slate-100">Enterprise Control Panels</h1>
            <p className="text-xs text-slate-300 font-semibold mt-1">Select an active ERP module to initiate session control.</p>
          </div>
          <div className="bg-slate-900 border border-admin-border px-3 py-1.5 rounded flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-300">Connection Secured</span>
          </div>
        </div>

        {/* Modules Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Module 1: Production (Future Module Placeholder) */}
          <div className="p-6 bg-admin-card border border-admin-border rounded relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <svg className="w-16 h-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Formulation Control</span>
            <h3 className="text-lg font-bold mt-1 text-slate-200">Manufacturing Module</h3>
            <p className="text-xs text-slate-300 font-medium mt-3 leading-relaxed">Contains formulation queues, chemical blending status logs, raw batch certifications, and warehouse inventory control.</p>
            <div className="mt-8 flex items-center justify-between border-t border-slate-900 pt-4">
              <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600">Phase 2+ Rollout</span>
              <span className="text-slate-500 text-xs font-bold select-none">Access Restricted</span>
            </div>
          </div>

          {/* Module 2: Projects (Future Module Placeholder) */}
          <div className="p-6 bg-admin-card border border-admin-border rounded relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <svg className="w-16 h-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Government Division</span>
            <h3 className="text-lg font-bold mt-1 text-slate-200">Project Management</h3>
            <p className="text-xs text-slate-300 font-medium mt-3 leading-relaxed">Oversees municipal contractor work schedules, infrastructure tender documents, civil log reports, and logistics dispatch status.</p>
            <div className="mt-8 flex items-center justify-between border-t border-slate-900 pt-4">
              <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600">Phase 2+ Rollout</span>
              <span className="text-slate-500 text-xs font-bold select-none">Access Restricted</span>
            </div>
          </div>

          {/* Module 3: Active Workspace */}
          <div className="p-6 bg-admin-card border border-amber-500/20 rounded relative overflow-hidden shadow-lg">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-16 h-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11.5V10c0-2.5 2-4.5 4.5-4.5S18 7.5 18 10v1.5c0 3 .07 3.53 2.384 4.762A2 2 0 0120 19.5H8.293m0 0l-1.143-1.143M12 21a2 2 0 01-2-2h4a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Systems & Policy</span>
            <h3 className="text-lg font-bold mt-1 text-slate-200">Office Administration</h3>
            <p className="text-xs text-slate-300 font-medium mt-3 leading-relaxed">Access control management, user authorization, live session tracking audits, security compliance metrics, and log reviews.</p>
            <div className="mt-8 flex items-center justify-between border-t border-slate-900 pt-4">
              <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-900/30">Active System</span>
              {user?.role === 'admin' ? (
                <Link
                  to="/admin"
                  className="text-amber-500 hover:text-amber-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition"
                >
                  Manage System &rarr;
                </Link>
              ) : (
                <span className="text-slate-400 text-xs font-bold select-none">Permissions Validated</span>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
