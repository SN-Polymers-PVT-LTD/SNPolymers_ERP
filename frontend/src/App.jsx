import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
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
import FundRequests from './pages/FundRequests';
import MaterialMaster from './pages/MaterialMaster';
import Estimates from './pages/Estimates';
import EstimateForm from './pages/EstimateForm';
import EstimateView from './pages/EstimateView';
import Requisitions from './pages/Requisitions';
import DailyProgress from './pages/DailyProgress';
import RAFinalBill from './pages/RAFinalBill';
import Docs from './pages/docs/Docs';
import SystemPolicy from './pages/SystemPolicy';
import UserMappings from './pages/UserMappings';
import WorkOrderMappings from './pages/WorkOrderMappings';


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
      <ThemeProvider>
        <AuthProvider>
          <Router>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify-otp" element={<OtpVerify />} />
            <Route path="/telegram-setup" element={<TelegramSetup />} />
            <Route path="/privacy-policy" element={<SystemPolicy />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/docs/:pageId" element={<Docs />} />

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

            {/* Requisitions & Daily Work Progress Protected Routes (JE, ZO, HO, Admin) */}
            <Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
              <Route path="/requisitions" element={<Requisitions />} />
              <Route path="/daily-progress" element={<DailyProgress />} />
            </Route>

            {/* Fund Requests Protected Routes (ZO, HO, Admin) */}
            <Route element={<ProtectedRoute allowedRoles={['zo', 'staff', 'ho', 'admin']} />}>
              <Route path="/fund-requests" element={<FundRequests />} />
            </Route>

            {/* RA/Final Bills & User/Work Order Mappings Protected Routes (ZO, HO, Admin) */}
            <Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
              <Route path="/ra-final-bills" element={<RAFinalBill />} />
              <Route path="/user-mappings" element={<UserMappings />} />
              <Route path="/work-order-mappings" element={<WorkOrderMappings />} />
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
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
