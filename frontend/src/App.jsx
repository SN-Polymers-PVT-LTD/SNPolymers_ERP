import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Views
import Home from './pages/Home';
import Login from './pages/Login';
import OtpVerify from './pages/OtpVerify';
import TelegramSetup from './pages/TelegramSetup';
import Dashboard from './pages/Dashboard';
import AdminPanel from './pages/admin/AdminPanel';
import AuditLog from './pages/admin/AuditLog';
import MasterData from './pages/admin/MasterData';
import PurchaseOptions from './pages/admin/PurchaseOptions';
import FundReports from './pages/FundReports';
import MaterialMaster from './pages/MaterialMaster';
import Estimates from './pages/Estimates';
import EstimateForm from './pages/EstimateForm';
import EstimateView from './pages/EstimateView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify-otp" element={<OtpVerify />} />
          <Route path="/telegram-setup" element={<TelegramSetup />} />

          {/* Protected Routes (All Phase 2 Roles) */}
          <Route element={<ProtectedRoute allowedRoles={['staff', 'admin', 'je', 'zo', 'ho']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/fund-reports" element={<FundReports />} />
            <Route path="/materials" element={<MaterialMaster />} />
            <Route path="/estimates" element={<Estimates />} />
            <Route path="/estimates/new" element={<EstimateForm />} />
            <Route path="/estimates/:id" element={<EstimateView />} />
            <Route path="/estimates/:id/edit" element={<EstimateForm />} />
          </Route>

          {/* Admin Protected Routes */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/admin/sessions" element={<AuditLog />} />
            <Route path="/admin/master-data" element={<MasterData />} />
            <Route path="/admin/purchase-options" element={<PurchaseOptions />} />
          </Route>

          {/* Fallback Catch All */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
