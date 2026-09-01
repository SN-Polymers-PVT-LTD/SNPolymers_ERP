import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

export const MobileHeader = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Grouped Menu Links matching desktop access permissions
  const menuGroups = [];

  if (user) {
    // Group 1: Project Operations
    const projItems = [];
    projItems.push({
      to: '/estimates',
      label: 'Cost Estimates',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    });
    projItems.push({
      to: '/materials',
      label: 'Material Master',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      )
    });
    if (['je', 'zo', 'ho', 'admin'].includes(user?.role)) {
      projItems.push({
        to: '/daily-progress',
        label: 'Daily Progress',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
          </svg>
        )
      });
    }
    menuGroups.push({ title: 'Project Control', items: projItems });

    // Group 2: Financial Allocation
    const finItems = [];
    if (['je', 'zo', 'ho', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/requisitions',
        label: 'Requisitions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        )
      });
    }
    if (['zo', 'staff', 'ho', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/fund-requests',
        label: 'Fund Requests',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }
    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/ra-final-bills',
        label: 'RA / Final Bills',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      });
      finItems.push({
        to: '/estimated-bills',
        label: 'Estimated Bills',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      });

      finItems.push({
        to: '/zonal-balances',
        label: 'Zonal Balances',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
      finItems.push({
        to: '/excess-fund-returns',
        label: 'Excess Returns',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-6a4 4 0 00-8 0v6M5 18h14M8 15V9a4 4 0 118 0v6M12 18v-3" />
          </svg>
        )
      });
    }
    if (['accounts', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/acct-requisitions',
        label: 'Acct Requisitions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      });
    }
    if (['ho', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/acct-requisitions/ho-queue',
        label: 'HO Acct Queue',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }
    if (['accounts', 'ho', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/acct-requisitions/bank-balances',
        label: 'Bank Balances',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M4 21V9l8-5 8 5v12M9 21v-6h6v6" />
          </svg>
        )
      });
      finItems.push({
        to: '/acct-requisitions/credit-ledger',
        label: 'Credit Ledger',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a4 4 0 00-8 0v2M5 9h14l-1 11H6L5 9z" />
          </svg>
        )
      });
      finItems.push({
        to: '/acct-requisitions/logs',
        label: 'Requisition Logs',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }
    if (['accounts', 'admin'].includes(user?.role)) {
      finItems.push({
        to: '/acct-requisitions/sub-titles',
        label: 'Sub-titles',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        )
      });
      finItems.push({
        to: '/acct-requisitions/particulars',
        label: 'Particulars',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V6a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V18a2 2 0 01-2 2z" />
          </svg>
        )
      });
      finItems.push({
        to: '/acct-requisitions/beneficiary-master',
        label: 'Beneficiary Master',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
          </svg>
        )
      });
    }
    if (finItems.length > 0) {
      menuGroups.push({ title: 'Financial Twin', items: finItems });
    }

    // Group 3: Assignments & Mappings
    const mapItems = [];
    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      mapItems.push({
        to: '/work-order-mappings',
        label: 'Work Order Mappings',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4-4m-4 4l4 4" />
          </svg>
        )
      });
      mapItems.push({
        to: '/user-mappings',
        label: 'User Mappings',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        )
      });
    }
    if (mapItems.length > 0) {
      menuGroups.push({ title: 'Access & Mappings', items: mapItems });
    }

    // Group 4: Admin
    if (user?.role === 'admin') {
      menuGroups.push({
        title: 'Administrator',
        items: [
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10l8 4V3L4 7zm0 0h16v10l-8-4V3M4 7h16" />
              </svg>
            )
          }
        ]
      });
    }

    // Group 5: Digital Twins
    menuGroups.push({
      title: 'Digital Twins',
      items: [
        {
          to: '/analytics/digital-twin',
          label: 'Digital Twin Hub',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364.364l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          )
        },
        {
          to: '/analytics/audit',
          label: 'Audit & Compliance',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          )
        }
      ]
    });
  }

  return (
    <>
      <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {user && (
            <button
              onClick={() => setIsMenuOpen(true)}
              className="p-2 -ml-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 transition mr-1"
              aria-label="Open Navigation Drawer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="h-8 w-auto object-contain" />
            <span className="font-extrabold text-[11px] tracking-wider text-slate-100 uppercase">SN Polymers</span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2">
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
            <Link
              to="/profile"
              className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-black text-slate-950 text-xs shadow-md select-none transition-transform hover:scale-105 active:scale-95"
              title="View Profile"
            >
              {(user.display_name || 'U')[0].toUpperCase()}
            </Link>
          </div>
        )}
      </header>

      {/* Slide-out Navigation Drawer */}
      {isMenuOpen && user && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 md:hidden"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Drawer Panel */}
          <aside className="sidebar-drawer-panel sidebar-drawer-slide-in fixed top-0 left-0 bottom-0 w-72 border-r border-white/10 z-50 p-6 flex flex-col justify-between shadow-[5px_0_30px_rgba(0,0,0,0.3)] md:hidden">
            <div>
              {/* Header */}
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <img src="/assets/logo.png" alt="SN Polymers" className="h-6 w-auto" />
                  <span className="font-black text-xs uppercase tracking-widest text-slate-100">Navigation</span>
                </div>
                <button
                  onClick={() => setIsMenuOpen(false)}
                  className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition"
                  aria-label="Close menu"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Main Console Link */}
              <Link
                to="/dashboard"
                onClick={() => setIsMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all mb-6 ${
                  currentPath === '/dashboard' ? 'bg-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/10' : 'bg-white/5 hover:bg-white/10 text-slate-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
                </svg>
                Main Console
              </Link>

              {/* Grouped Links */}
              <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-230px)] no-scrollbar pr-1">
                {menuGroups.map((group, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-3">{group.title}</h4>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const active = currentPath === item.to || (item.to !== '/dashboard' && currentPath.startsWith(item.to));
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setIsMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                              active
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'text-slate-400 hover:text-slate-200 border border-transparent'
                            }`}
                          >
                            <span className={active ? 'text-amber-400' : 'text-slate-500'}>
                              {item.icon}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Profile & Sign out segment */}
            <div className="pt-4 border-t border-white/5 mt-auto flex flex-col gap-3">
              <div className="flex items-center gap-3 px-2">
                <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 font-extrabold text-sm uppercase">
                  {user.display_name ? user.display_name.charAt(0) : 'U'}
                </div>
                <div className="truncate flex-grow">
                  <p className="text-xs font-extrabold text-slate-200 truncate">{user.display_name || 'User Account'}</p>
                  <p className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{user.role}</p>
                </div>
              </div>

              <button
                onClick={() => { setIsMenuOpen(false); logout(); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-950/20 hover:bg-red-950/35 border border-red-900/30 hover:border-red-900/50 text-red-400 font-extrabold text-xs uppercase tracking-wider transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
};

const Sidebar = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const currentPath = location.pathname;
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const isExpanded = !isCollapsed || isHovered;
  const sidebarRef = useRef(null);

  const [pinnedProjects, setPinnedProjects] = useState([]);
  const storageKey = user?.mobile_number ? `pinnedProjects_${user.mobile_number}` : 'pinnedProjects';

  const loadPinnedProjects = useCallback(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setPinnedProjects(JSON.parse(stored));
      } else {
        setPinnedProjects([]);
      }
    } catch (e) {
      console.error(e);
      setPinnedProjects([]);
    }
  }, [storageKey]);

  useEffect(() => {
    loadPinnedProjects();
    window.addEventListener('pinned-projects-updated', loadPinnedProjects);
    return () => {
      window.removeEventListener('pinned-projects-updated', loadPinnedProjects);
    };
  }, [storageKey, loadPinnedProjects]);

  useEffect(() => {
    const handleCollapseEvent = (e) => {
      setIsCollapsed(e.detail);
    };
    window.addEventListener('sidebar-collapse', handleCollapseEvent);
    return () => {
      window.removeEventListener('sidebar-collapse', handleCollapseEvent);
    };
  }, []);

  // Handle ESC key and outside clicks to dismiss overlay
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsHovered(false);
        setIsCollapsed(true);
      }
    };
    const handleClickOutside = (e) => {
      if (isExpanded && sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setIsHovered(false);
        if (!isCollapsed) setIsCollapsed(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, isCollapsed]);

  // 1. Detect active module
  const isProjectModule = ['/estimates', '/materials', '/daily-progress'].some(p => currentPath.startsWith(p));
  const isFinanceModule = ['/requisitions', '/fund-requests', '/ra-final-bills', '/estimated-bills', '/zonal-balances', '/excess-fund-returns'].some(p => currentPath.startsWith(p));
  const isAccountsModule = currentPath.startsWith('/acct-requisitions');
  const isMappingModule = ['/work-order-mappings', '/user-mappings'].some(p => currentPath.startsWith(p));
  const isAdminModule = currentPath.startsWith('/admin');
  const isAnalyticsModule = currentPath.startsWith('/analytics') || currentPath.includes('/digital-twin');

  // 2. Define sub-navigation items based on active module and role access
  const navItems = [];

  if (isProjectModule) {
    navItems.push(
      {
        to: '/estimates',
        label: 'Cost Estimates',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
      }
    );

    if (['je', 'zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/daily-progress',
        label: 'Daily Progress',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
          </svg>
        )
      });
    }
  } else if (isFinanceModule) {
    if (['je', 'zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/requisitions',
        label: 'Requisitions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        )
      });
    }

    if (['zo', 'staff', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/fund-requests',
        label: 'Fund Requests',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }

    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push(
        {
          to: '/ra-final-bills',
          label: 'RA / Final Bills',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )
        },
        {
          to: '/estimated-bills',
          label: 'Estimated Bills',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )
        },

        {
          to: '/zonal-balances',
          label: 'Zonal Balances',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        },
        {
          to: '/excess-fund-returns',
          label: 'Excess Returns',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-6a4 4 0 00-8 0v6M5 18h14M8 15V9a4 4 0 118 0v6M12 18v-3" />
            </svg>
          )
        }
      );
    }

  } else if (isAccountsModule) {
    if (['accounts', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/acct-requisitions',
        label: 'Acct Requisitions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )
      });
    }
    if (['ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/acct-requisitions/ho-queue',
        label: 'HO Acct Queue',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }
    if (['accounts', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/acct-requisitions/bank-balances',
        label: 'Bank Balances',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M4 21V9l8-5 8 5v12M9 21v-6h6v6" />
          </svg>
        )
      });
      navItems.push({
        to: '/acct-requisitions/credit-ledger',
        label: 'Credit Ledger',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a4 4 0 00-8 0v2M5 9h14l-1 11H6L5 9z" />
          </svg>
        )
      });
      navItems.push({
        to: '/acct-requisitions/logs',
        label: 'Requisition Logs',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      });
    }
    if (['accounts', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/acct-requisitions/sub-titles',
        label: 'Sub-titles',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        )
      });
      navItems.push({
        to: '/acct-requisitions/particulars',
        label: 'Particulars',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V6a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V18a2 2 0 01-2 2z" />
          </svg>
        )
      });
      navItems.push({
        to: '/acct-requisitions/beneficiary-master',
        label: 'Beneficiary Master',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
          </svg>
        )
      });
    }
  } else if (isMappingModule) {
    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push(
        {
          to: '/work-order-mappings',
          label: 'Work Order Mappings',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4-4m-4 4l4 4" />
            </svg>
          )
        },
        {
          to: '/user-mappings',
          label: 'User Mappings',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          )
        }
      );
    }
  } else if (isAdminModule) {
    if (user?.role === 'admin') {
      navItems.push(
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
      );
    }
  } else if (isAnalyticsModule) {
    if (['ho', 'admin'].includes(user?.role)) {
      navItems.push(
        {
          to: '/analytics/ho',
          label: 'Executive Analytics',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          )
        },
        {
          to: '/analytics/audit',
          label: 'Audit Center',
          icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )
        }
      );
    }

    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/analytics/zo',
        label: 'Zonal Analytics',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        )
      });
    }

    if (['je', 'zo', 'ho', 'admin'].includes(user?.role)) {
      navItems.push({
        to: '/analytics/digital-twin',
        label: 'Digital Twin Hub',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )
      });
    }
  }

  return (
    <div
      ref={sidebarRef}
      className="relative z-40 md:w-20 shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Fixed 80px Rail in Flex Container (Maintains 100% constant layout width for dashboard) */}
      <aside
        className={`hidden md:flex flex-col glass-nav border-r border-white/5 sticky top-0 h-screen z-20 shrink-0 w-20 p-4 justify-between items-center transition-opacity duration-200 ${
          isExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Brand Logo Header (Fixed Rail) */}
        <div className="flex flex-col items-center gap-4 shrink-0">
          <Link to="/dashboard" className="flex items-center justify-center w-10 h-10">
            <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="w-auto h-9 object-contain" />
          </Link>
        </div>

        {/* Dynamic Icons (Fixed Rail) */}
        <nav className="flex flex-col items-center gap-3 my-auto">
          {currentPath !== '/dashboard' && (
            <button
              onClick={() => navigate(-1)}
              className="p-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 transition border border-transparent"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
          )}
          {navItems.map(({ to, label, icon }) => {
            const isActive = to === '/docs' ? currentPath.startsWith('/docs') : currentPath === to;
            return (
              <Link
                key={to}
                to={to}
                className={`p-2.5 rounded-xl transition-all ${
                  isActive
                    ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
                title={label}
              >
                {icon}
              </Link>
            );
          })}
        </nav>

        {/* Profile Avatar, Theme Switch, Privacy & Logout (Fixed Rail) */}
        <div className="flex flex-col items-center gap-2.5 shrink-0">
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 transition"
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
          {user && (
            <>
              <Link
                to="/profile"
                className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-extrabold text-slate-950 text-xs shadow-md select-none"
                title={`${user.display_name || 'Operator'} (${user.role})`}
              >
                {(user.display_name || 'U')[0].toUpperCase()}
              </Link>
              <Link
                to="/privacy-policy"
                title="Privacy Policy"
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </Link>
              <button
                onClick={logout}
                title="Sign Out"
                className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Floating Overlay Drawer (Renders over layout without causing reflow) */}
      <aside
        className={`sidebar-drawer-panel hidden md:flex fixed top-0 left-0 h-screen w-72 border-r border-white/10 z-40 flex-col p-4 justify-between transition-transform duration-300 ease-in-out shadow-[10px_0_30px_rgba(0,0,0,0.5)] ${
          isExpanded
            ? 'translate-x-0 pointer-events-auto'
            : '-translate-x-full pointer-events-none'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between mb-6 shrink-0 px-1">
          <Link to="/dashboard" className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="w-auto h-9 object-contain" />
            <div className="flex flex-col">
              <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">SN Polymers Pvt LTD</span>
              <span className="text-[10px] text-amber-500 font-extrabold tracking-widest uppercase mt-0.5">ERP Console</span>
            </div>
          </Link>
        </div>

        {/* Dynamic Contextual Sub-Nav Items */}
        <nav className="flex-grow space-y-2 overflow-y-auto pr-1 no-scrollbar min-w-0">
          {currentPath !== '/dashboard' && (
            <button
              onClick={() => navigate(-1)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 overflow-hidden mb-4 bg-slate-500/5 hover:bg-slate-500/10 border border-slate-500/25 text-slate-400"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back</span>
            </button>
          )}
          {navItems.map(({ to, label, icon }) => {
            const isActive = to === '/docs' ? currentPath.startsWith('/docs') : currentPath === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                  isActive
                    ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.02)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5'
                }`}
              >
                <div className={`w-5 h-5 flex items-center justify-center shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-400'}`}>
                  {icon}
                </div>
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Pinned Projects */}
        {pinnedProjects.length > 0 && ['zo', 'ho', 'admin'].includes(user?.role) && (
          <div className="border-t border-white/5 pt-4 mb-4 mt-auto shrink-0 flex flex-col gap-2 min-w-0">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-1">
              Pinned Twins
            </span>
            <div className="flex flex-col gap-1.5">
              {pinnedProjects.map((workOrderNo) => (
                <Link
                  key={workOrderNo}
                  to={`/projects/${workOrderNo}/digital-twin`}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-sky-500/5 hover:bg-sky-500/10 border border-sky-500/10 text-slate-300 hover:text-sky-400 transition-all duration-200"
                >
                  <svg className="w-3.5 h-3.5 text-sky-400 fill-current transform rotate-[30deg] shrink-0" viewBox="0 0 24 24">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                  <span className="text-xs font-mono font-bold truncate">{workOrderNo.replace('WO-', '')}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Operator Profile and Logout Footer */}
        {user && (
          <div className="border-t border-white/5 pt-4 shrink-0 min-w-0">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-slate-100 text-xs font-bold uppercase tracking-wider transition-all duration-200 mb-3 overflow-hidden shrink-0"
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {theme === 'light' ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                  </svg>
                )}
              </div>
              <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
            </button>

            <div className="flex flex-col gap-2">
              <Link
                to="/profile"
                className="flex items-center gap-3 px-3 py-2 rounded-xl group cursor-pointer transition-all duration-200 overflow-hidden"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-extrabold text-slate-950 text-xs select-none shadow-md shrink-0">
                  {(user.display_name || 'U')[0].toUpperCase()}
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-xs font-extrabold text-slate-200 truncate group-hover:text-amber-400 transition-colors">
                    {user.display_name || 'Operator'}
                  </span>
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">
                    {user.role}
                  </span>
                </div>
              </Link>

              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-wider transition-all duration-200 overflow-hidden shrink-0"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3h4a3 3 0 013 3v1" />
                </svg>
                <span>Sign Out</span>
              </button>

              <Link
                to="/privacy-policy"
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all duration-200 text-[10px] font-bold uppercase tracking-wider overflow-hidden shrink-0"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>Privacy Policy</span>
              </Link>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default Sidebar;
