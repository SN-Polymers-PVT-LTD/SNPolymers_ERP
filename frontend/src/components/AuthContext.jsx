/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import authApi from '../api/authApi';

const AuthContext = createContext(null);

export const AuthProvider = ({
  children,
  initialUser = undefined,
  initialLoading = initialUser !== undefined ? false : true
}) => {
  const [user, setUser] = useState(initialUser !== undefined ? initialUser : null);
  const [loading, setLoading] = useState(initialLoading);
  const queryClient = useQueryClient();

  const checkAuth = async () => {
    try {
      const response = await authApi.get('/me');
      if (response.data?.success) {
        setUser(response.data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialUser === undefined) {
      Promise.resolve().then(() => {
        checkAuth();
      });
    }

    const handleAuthFailure = async () => {
      queryClient.clear();
      setUser(null);
      try {
        await authApi.post('/logout');
      } catch {
        // Ignore logout errors on expired sessions
      }
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    };

    window.addEventListener('auth-failure', handleAuthFailure);
    return () => {
      window.removeEventListener('auth-failure', handleAuthFailure);
    };
  }, [queryClient]);

  const login = (userData) => {
    queryClient.clear();
    setUser(userData);
  };

  const logout = async () => {
    try {
      await authApi.post('/logout');
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      queryClient.clear();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, checkAuth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
