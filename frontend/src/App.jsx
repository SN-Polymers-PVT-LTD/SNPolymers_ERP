import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
import { ModalProvider } from './components/ModalContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
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
import ZonalBalances from './pages/ZonalBalances';
import ExcessFundReturns from './pages/ExcessFundReturns';
import Profile from './pages/Profile';
import HoDashboard from './pages/HoDashboard';
import ZoDashboard from './pages/ZoDashboard';
import AuditComplianceCenter from './pages/AuditComplianceCenter';
import ProjectDigitalTwin from './pages/ProjectDigitalTwin';
import DigitalTwinHub from './pages/DigitalTwinHub';



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
        <ModalProvider>
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

            {/* Protected Routes utilizing Persistent AppLayout */}
            <Route element={<ProtectedRoute allowedRoles={['staff', 'admin', 'je', 'zo', 'ho']} />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/fund-reports" element={<FundReports />} />
                <Route path="/materials" element={<MaterialMaster />} />
                <Route path="/estimates" element={<Estimates />} />
                <Route path="/estimates/new" element={<EstimateForm />} />
                <Route path="/estimates/:id" element={<EstimateView />} />
                <Route path="/estimates/:id/edit" element={<EstimateForm />} />

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
                  <Route path="/zonal-balances" element={<ZonalBalances />} />
                  <Route path="/excess-fund-returns" element={<ExcessFundReturns />} />
                </Route>

                {/* Admin Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                  <Route path="/admin" element={<AdminPanel />} />
                  <Route path="/admin/sessions" element={<AuditLog />} />
                  <Route path="/admin/master-data" element={<MasterData />} />
                  <Route path="/admin/purchase-options" element={<PurchaseOptions />} />
                </Route>

                {/* HO/Admin Analytics Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['ho', 'admin']} />}>
                  <Route path="/analytics/ho" element={<HoDashboard />} />
                  <Route path="/analytics/audit" element={<AuditComplianceCenter />} />
                </Route>

                {/* ZO/HO/Admin Analytics Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
                  <Route path="/analytics/zo" element={<ZoDashboard />} />
                </Route>

                {/* JE/ZO/HO/Admin Digital Twin Route */}
                <Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
                  <Route path="/projects/:work_order_no/digital-twin" element={<ProjectDigitalTwin />} />
                  <Route path="/analytics/digital-twin" element={<DigitalTwinHub />} />
                </Route>
              </Route>
            </Route>

            {/* Fallback Catch All */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
