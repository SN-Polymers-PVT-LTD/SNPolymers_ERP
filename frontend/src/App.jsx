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
                <AppLayout />
              }>
                <Route path="/dashboard" element={<React.Suspense fallback={<AppChunkLoader />}><Dashboard /></React.Suspense>} />
                <Route path="/profile" element={<React.Suspense fallback={<AppChunkLoader />}><Profile /></React.Suspense>} />
                <Route path="/fund-reports" element={<React.Suspense fallback={<AppChunkLoader />}><FundReports /></React.Suspense>} />
                <Route path="/materials" element={<React.Suspense fallback={<AppChunkLoader />}><MaterialMaster /></React.Suspense>} />
                <Route path="/estimates" element={<React.Suspense fallback={<AppChunkLoader />}><Estimates /></React.Suspense>} />
                <Route path="/estimates/new" element={<React.Suspense fallback={<AppChunkLoader />}><EstimateForm /></React.Suspense>} />
                <Route path="/estimates/:id" element={<React.Suspense fallback={<AppChunkLoader />}><EstimateView /></React.Suspense>} />
                <Route path="/estimates/:id/edit" element={<React.Suspense fallback={<AppChunkLoader />}><EstimateForm /></React.Suspense>} />

                {/* Requisitions & Daily Work Progress Protected Routes (JE, ZO, HO, Admin) */}
                <Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
                  <Route path="/requisitions" element={<React.Suspense fallback={<AppChunkLoader />}><Requisitions /></React.Suspense>} />
                  <Route path="/daily-progress" element={<React.Suspense fallback={<AppChunkLoader />}><DailyProgress /></React.Suspense>} />
                </Route>

                {/* Fund Requests Protected Routes (ZO, HO, Admin) */}
                <Route element={<ProtectedRoute allowedRoles={['zo', 'staff', 'ho', 'admin']} />}>
                  <Route path="/fund-requests" element={<React.Suspense fallback={<AppChunkLoader />}><FundRequests /></React.Suspense>} />
                </Route>

                {/* RA/Final Bills & User/Work Order Mappings Protected Routes (ZO, HO, Admin) */}
                <Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
                  <Route path="/ra-final-bills" element={<React.Suspense fallback={<AppChunkLoader />}><RAFinalBill /></React.Suspense>} />
                  <Route path="/user-mappings" element={<React.Suspense fallback={<AppChunkLoader />}><UserMappings /></React.Suspense>} />
                  <Route path="/work-order-mappings" element={<React.Suspense fallback={<AppChunkLoader />}><WorkOrderMappings /></React.Suspense>} />
                  <Route path="/zonal-balances" element={<React.Suspense fallback={<AppChunkLoader />}><ZonalBalances /></React.Suspense>} />
                  <Route path="/excess-fund-returns" element={<React.Suspense fallback={<AppChunkLoader />}><ExcessFundReturns /></React.Suspense>} />
                </Route>

                {/* Admin Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                  <Route path="/admin" element={<React.Suspense fallback={<AppChunkLoader />}><AdminPanel /></React.Suspense>} />
                  <Route path="/admin/sessions" element={<React.Suspense fallback={<AppChunkLoader />}><AuditLog /></React.Suspense>} />
                  <Route path="/admin/master-data" element={<React.Suspense fallback={<AppChunkLoader />}><MasterData /></React.Suspense>} />
                  <Route path="/admin/purchase-options" element={<React.Suspense fallback={<AppChunkLoader />}><PurchaseOptions /></React.Suspense>} />
                </Route>

                {/* HO/Admin Analytics Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['ho', 'admin']} />}>
                  <Route path="/analytics/ho" element={<React.Suspense fallback={<AppChunkLoader />}><HoDashboard /></React.Suspense>} />
                  <Route path="/analytics/audit" element={<React.Suspense fallback={<AppChunkLoader />}><AuditComplianceCenter /></React.Suspense>} />
                </Route>

                {/* ZO/HO/Admin Analytics Protected Routes */}
                <Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
                  <Route path="/analytics/zo" element={<React.Suspense fallback={<AppChunkLoader />}><ZoDashboard /></React.Suspense>} />
                </Route>

                {/* JE/ZO/HO/Admin Digital Twin & Leaderboard Routes */}
                <Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
                  <Route path="/projects/:work_order_no/digital-twin" element={<React.Suspense fallback={<AppChunkLoader />}><ProjectDigitalTwin /></React.Suspense>} />
                  <Route path="/analytics/digital-twin" element={<React.Suspense fallback={<AppChunkLoader />}><DigitalTwinHub /></React.Suspense>} />
                  <Route path="/analytics/leaderboard" element={<React.Suspense fallback={<AppChunkLoader />}><JeLeaderboard /></React.Suspense>} />
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
