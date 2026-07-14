import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const TopNavbar = () => {
  const { user } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;

  const role = user?.role || '';
  const isAdmin = role === 'admin';
  const isAuthorizedZOOrHOOrAdmin = ['zo', 'ho', 'admin'].includes(role);
  const isAuthorizedJEOrAbove = ['je', 'zo', 'ho', 'admin'].includes(role);

  const navItems = [
    // Zonal Balances & Excess Returns (zo, ho, admin)
    ...(isAuthorizedZOOrHOOrAdmin
      ? [
          {
            to: '/excess-fund-returns',
            label: 'Excess Returns',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-6a4 4 0 00-8 0v6M5 18h14M8 15V9a4 4 0 118 0v6M12 18v-3" />
              </svg>
            )
          },
          {
            to: '/zonal-balances',
            label: 'Zonal Balances',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )
          },
        ]
      : []),
    // Work Order Mapping (zo, ho, admin)
    ...(isAuthorizedZOOrHOOrAdmin
      ? [
          {
            to: '/work-order-mappings',
            label: 'Work Order Mappings',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4-4m-4 4l4 4" />
              </svg>
            )
          },
          {
            to: '/user-mappings',
            label: 'User Mappings',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            )
          }
        ]
      : []),
    // Access Whitelist (admin only)
    ...(isAdmin
      ? [
          {
            to: '/admin',
            label: 'Access Whitelist',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )
          }
        ]
      : []),
    // Daily Progress (je, zo, ho, admin)
    ...(isAuthorizedJEOrAbove
      ? [
          {
            to: '/daily-progress',
            label: 'Daily Progress',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
              </svg>
            )
          }
        ]
      : []),
    // Documentation (All roles)
    {
      to: '/docs',
      label: 'Documentation',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      )
    },
  ];

  return (
    <div className="w-full glass-nav border-b border-white/5 py-3 px-8 hidden md:flex items-center justify-end relative z-30">
      <nav className="flex items-center gap-1">
        {navItems.map(({ to, label, icon }) => {
          const isActive = to === '/docs' ? currentPath.startsWith('/docs') : currentPath === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-widest transition-all duration-300 border relative ${
                isActive
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-transparent hover:border-white/5'
              }`}
            >
              <span className={isActive ? 'text-amber-400 animate-pulse' : 'text-slate-400 group-hover:text-slate-200'}>
                {icon}
              </span>
              <span>{label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/3 h-[2px] bg-amber-500 rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default TopNavbar;
