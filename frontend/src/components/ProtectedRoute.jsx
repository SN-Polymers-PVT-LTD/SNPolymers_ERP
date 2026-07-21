import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

const ProtectedRoute = ({ allowedRoles }) => {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) {
    const isLight = theme === 'light';
    return (
      <div className={`flex items-center justify-center min-h-screen ${isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#030712] text-white'}`}>
        <div className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${isLight ? 'border-amber-500' : 'border-sky-500'}`}></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
