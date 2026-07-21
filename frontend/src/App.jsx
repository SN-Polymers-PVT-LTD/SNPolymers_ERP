import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
import { ModalProvider } from './components/ModalContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Views (Static for auth entrypoints)
import Home from './pages/Home';
import Login from './pages/Login';
import OtpVerify from './pages/OtpVerify';
import TelegramSetup from './pages/TelegramSetup';
import Docs from './pages/docs/Docs';
import SystemPolicy from './pages/SystemPolicy';

// Dynamic Lazy Views for chunk splitting & optimistic preloading
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const AdminPanel = React.lazy(() => import('./pages/admin/AdminPanel'));
const AuditLog = React.lazy(() => import('./pages/admin/AuditLog'));
const MasterData = React.lazy(() => import('./pages/admin/MasterData'));
const PurchaseOptions = React.lazy(() => import('./pages/admin/PurchaseOptions'));
const FundReports = React.lazy(() => import('./pages/FundReports'));
const FundRequests = React.lazy(() => import('./pages/FundRequests'));
const MaterialMaster = React.lazy(() => import('./pages/MaterialMaster'));
const Estimates = React.lazy(() => import('./pages/Estimates'));
const EstimateForm = React.lazy(() => import('./pages/EstimateForm'));
const EstimateView = React.lazy(() => import('./pages/EstimateView'));
const Requisitions = React.lazy(() => import('./pages/Requisitions'));
const DailyProgress = React.lazy(() => import('./pages/DailyProgress'));
const RAFinalBill = React.lazy(() => import('./pages/RAFinalBill'));
const UserMappings = React.lazy(() => import('./pages/UserMappings'));
const WorkOrderMappings = React.lazy(() => import('./pages/WorkOrderMappings'));
const ZonalBalances = React.lazy(() => import('./pages/ZonalBalances'));
const ExcessFundReturns = React.lazy(() => import('./pages/ExcessFundReturns'));
const Profile = React.lazy(() => import('./pages/Profile'));
const HoDashboard = React.lazy(() => import('./pages/HoDashboard'));
const ZoDashboard = React.lazy(() => import('./pages/ZoDashboard'));
const AuditComplianceCenter = React.lazy(() => import('./pages/AuditComplianceCenter'));
const ProjectDigitalTwin = React.lazy(() => import('./pages/ProjectDigitalTwin'));
const DigitalTwinHub = React.lazy(() => import('./pages/DigitalTwinHub'));
const JeLeaderboard = React.lazy(() => import('./pages/JeLeaderboard'));



import { SkeletonPage } from './components/ui';

const AppChunkLoader = () => {
  return <SkeletonPage />;
};

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
              <Route element={
                <React.Suspense fallback={<AppChunkLoader />}>
                  <AppLayout />
                </React.Suspense>
              }>
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

                {/* JE/ZO/HO/Admin Digital Twin & Leaderboard Routes */}
                <Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
                  <Route path="/projects/:work_order_no/digital-twin" element={<ProjectDigitalTwin />} />
                  <Route path="/analytics/digital-twin" element={<DigitalTwinHub />} />
                  <Route path="/analytics/leaderboard" element={<JeLeaderboard />} />
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
