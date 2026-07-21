import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import Dock from './ui/Dock';
import { useModalOverlay } from './ModalContext';

const TopNavbar = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { isModalOpen } = useModalOverlay();

  const role = user?.role || '';
  const isAdmin = role === 'admin';
  const isAuthorizedZOOrHOOrAdmin = ['zo', 'ho', 'admin'].includes(role);
  const isAuthorizedJEOrAbove = ['je', 'zo', 'ho', 'admin'].includes(role);
  const isAuthorizedFinance = ['je', 'zo', 'ho', 'admin', 'staff'].includes(role);

  // Helper to resolve the first route the user has access to for each module
  const getFinanceRoute = () => {
    if (['je', 'zo', 'ho', 'admin'].includes(role)) return '/requisitions';
    if (role === 'staff') return '/fund-requests';
    return null;
  };

  const getMappingRoute = () => {
    if (isAuthorizedZOOrHOOrAdmin) return '/work-order-mappings';
    return null;
  };

  const getAnalyticsRoute = () => {
    if (['ho', 'admin'].includes(role)) return '/analytics/ho';
    if (role === 'zo') return '/analytics/zo';
    return null;
  };

  const getAdminRoute = () => {
    if (isAdmin) return '/admin';
    return null;
  };

  // Define macro-modules
  const modules = [
    // 1. Home / Overview
    {
      label: 'Overview',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
        </svg>
      ),
      to: '/dashboard',
      isActive: currentPath === '/dashboard' || currentPath === '/profile'
    },
    // 2. Project Management
    {
      label: 'Projects',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      to: '/estimates',
      isActive: ['/estimates', '/materials', '/daily-progress'].some(p => currentPath.startsWith(p))
    },
    // 3. Finance & Requisitions
    ...(isAuthorizedFinance && getFinanceRoute()
      ? [
          {
            label: 'Finance',
            icon: (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            to: getFinanceRoute(),
            isActive: ['/requisitions', '/fund-requests', '/ra-final-bills', '/zonal-balances', '/excess-fund-returns'].some(p => currentPath.startsWith(p))
          }
        ]
      : []),
    // 4. Mappings & Setup
    ...(isAuthorizedZOOrHOOrAdmin && getMappingRoute()
      ? [
          {
            label: 'Mappings',
            icon: (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ),
            to: getMappingRoute(),
            isActive: ['/work-order-mappings', '/user-mappings'].some(p => currentPath.startsWith(p))
          }
        ]
      : []),
    // Analytics & Metrics Module
    ...(isAuthorizedZOOrHOOrAdmin && getAnalyticsRoute()
      ? [
          {
            label: 'Analytics',
            icon: (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
            to: getAnalyticsRoute(),
            isActive: ['/analytics', '/digital-twin'].some(p => currentPath.includes(p))
          }
        ]
      : []),
    // 5. System Administration (Admin only)
    ...(isAdmin && getAdminRoute()
      ? [
          {
            label: 'Admin',
            icon: (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ),
            to: getAdminRoute(),
            isActive: currentPath.startsWith('/admin')
          }
        ]
      : []),
    // 6. Documentation (All roles)
    {
      label: 'Documentation',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      to: '/docs',
      isActive: currentPath.startsWith('/docs')
    }
  ];

  const dockItems = modules.map((item) => {
    return {
      icon: item.icon,
      label: item.label,
      onClick: () => navigate(item.to),
      className: item.isActive ? 'border-amber-500 bg-amber-500/10 text-amber-500 font-extrabold scale-105' : ''
    };
  });

  return (
    <div className={`w-full py-4 px-8 hidden md:flex items-center justify-center relative z-20 h-24 overflow-visible bg-transparent transition-opacity duration-150 ${isModalOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      {dockItems.length > 0 && (
        <Dock 
          items={dockItems}
          panelHeight={60}
          baseItemSize={46}
          magnification={60}
          distance={140}
        />
      )}
    </div>
  );
};

export default TopNavbar;
