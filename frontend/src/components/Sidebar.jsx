import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

export const MobileHeader = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
            onClick={toggleTheme}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 transition"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            )}
          </button>
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
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const currentPath = location.pathname;
  const isAdmin = user?.role === 'admin';

  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  useEffect(() => {
    const handleCollapseEvent = (e) => {
      setIsCollapsed(e.detail);
    };
    window.addEventListener('sidebar-collapse', handleCollapseEvent);
    return () => {
      window.removeEventListener('sidebar-collapse', handleCollapseEvent);
    };
  }, []);

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
      label: 'Home',
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
    ...(['je', 'zo', 'ho', 'admin'].includes(user?.role) ? [
      {
        to: '/requisitions',
        label: 'Payment Requisitions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        )
      }
    ] : []),
    ...(['zo', 'staff', 'ho', 'admin'].includes(user?.role) ? [
      {
        to: '/fund-requests',
        label: 'Fund Requests',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      }
    ] : []),
    ...(['zo', 'ho', 'admin'].includes(user?.role) ? [
      {
        to: '/ra-final-bills',
        label: 'RA / Final Bills',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      }
    ] : []),
    ...(isAdmin ? [
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
              <span className="font-extrabold text-[10px] tracking-wider text-slate-100 uppercase whitespace-nowrap">
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
          const isActive = to === '/docs' ? currentPath.startsWith('/docs') : currentPath === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${isCollapsed ? 'justify-center p-3' : 'gap-3 px-4 py-3'
                } ${isActive
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
          {/* Theme Toggle Button */}
          {isCollapsed ? (
            <button
              onClick={toggleTheme}
              title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-slate-100 transition-all duration-300 mb-4 mx-auto"
            >
              {theme === 'light' ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
              )}
            </button>
          ) : (
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-slate-100 text-xs font-bold uppercase tracking-wider transition-all duration-300 mb-4"
            >
              {theme === 'light' ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  Dark Mode
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                  </svg>
                  Light Mode
                </>
              )}
            </button>
          )}

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
              <Link
                to="/privacy-policy"
                title="Privacy Policy"
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </Link>
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider transition-all duration-300 mb-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
              <Link
                to="/privacy-policy"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 text-[10px] font-bold uppercase tracking-wider transition-all duration-300"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Privacy Policy
              </Link>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
