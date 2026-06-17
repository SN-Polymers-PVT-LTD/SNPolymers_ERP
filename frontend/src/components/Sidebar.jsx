import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export const MobileHeader = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="h-8 w-auto object-contain" />
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">SN Polymers Pvt LTD</span>
        </Link>
      </div>
      {user && (
        <div className="flex items-center gap-3">
          {user.role === 'admin' && currentPath !== '/admin' && (
            <Link
              to="/admin"
              className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
            >
              Admin
            </Link>
          )}
          {currentPath !== '/dashboard' && (
            <Link
              to="/dashboard"
              className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
            >
              Console
            </Link>
          )}
          <button
            onClick={logout}
            className="text-[10px] bg-red-950/20 border border-red-900/30 text-red-400 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg"
          >
            Out
          </button>
        </div>
      )}
    </header>
  );
};

const Sidebar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;
  const isAdmin = user?.role === 'admin';

  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const navItems = [
    {
      to: '/dashboard',
      label: 'Command Center',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
        </svg>
      )
    },
    {
      to: '/materials',
      label: 'Material Master',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      )
    },
    {
      to: '/estimates',
      label: 'Cost Estimates',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    ...(isAdmin ? [
      {
        to: '/admin',
        label: 'Access Whitelist',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        )
      },
      {
        to: '/admin/purchase-options',
        label: 'Purchase Options',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        )
      },
      {
        to: '/admin/master-data',
        label: 'Master Data',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        )
      },
      {
        to: '/admin/sessions',
        label: 'Audit Trail Logs',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      }
    ] : [])
  ];

  return (
    <aside className={`hidden md:flex flex-col glass-nav border-r border-white/5 sticky top-0 h-screen z-20 shrink-0 overflow-y-auto transition-all duration-300 ${isCollapsed ? 'w-20 px-3 py-6' : 'w-64 p-6'}`}>
      <div className={`flex items-center justify-between mb-10 ${isCollapsed ? 'flex-col gap-4' : ''}`}>
        {!isCollapsed && (
          <div className="flex items-center gap-3.5">
            <Link to="/dashboard">
              <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="h-10 w-auto object-contain" />
            </Link>
            <div className="flex flex-col">
              <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">
                SN Polymers Pvt LTD
              </span>
              <span className="text-[9px] text-amber-500 font-extrabold tracking-widest uppercase">
                ERP Console
              </span>
            </div>
          </div>
        )}
        {isCollapsed && (
          <Link to="/dashboard" className="flex justify-center">
            <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="h-8 w-auto object-contain" />
          </Link>
        )}
        <button
          onClick={toggleCollapse}
          className={`text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg bg-white/5 border border-white/5 ${isCollapsed ? 'w-8 h-8 flex items-center justify-center' : 'ml-auto'}`}
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {isCollapsed ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>

      <nav className="flex-grow space-y-2">
        {navItems.map(({ to, label, icon }) => {
          const isActive = currentPath === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                isCollapsed ? 'justify-center p-3' : 'gap-3 px-4 py-3'
              } ${
                isActive
                  ? 'bg-white/5 border border-white/10 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5'
              }`}
              title={isCollapsed ? label : undefined}
            >
              <span className={isActive ? 'text-amber-500' : ''}>
                {icon}
              </span>
              {!isCollapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Operator Profile and Logout */}
      {user && (
        <div className="border-t border-white/5 pt-6 mt-auto">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-extrabold text-slate-950 text-sm select-none shadow-md"
                title={`${user.display_name || 'Operator'} (${user.role})`}
              >
                {(user.display_name || 'U')[0].toUpperCase()}
              </div>
              <button
                onClick={logout}
                title="Sign Out"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-extrabold text-slate-950 text-sm select-none shadow-md">
                  {(user.display_name || 'U')[0].toUpperCase()}
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-xs font-extrabold text-slate-200 truncate">{user.display_name || 'Operator'}</span>
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">{user.role}</span>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
