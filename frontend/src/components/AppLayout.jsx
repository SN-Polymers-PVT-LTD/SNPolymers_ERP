import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar, { MobileHeader } from './Sidebar';
import TopNavbar from './TopNavbar';
import BackgroundShapes from './BackgroundShapes';
import { useTheme } from './ThemeContext';

const AppLayout = () => {
  const { isDark } = useTheme();

  return (
    <div className={`h-screen flex flex-col md:flex-row font-sans relative overflow-hidden bg-transparent ${
      isDark ? 'text-slate-100' : 'text-slate-900'
    }`}>
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-grow p-4 md:p-6 overflow-y-auto no-scrollbar w-full relative z-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
