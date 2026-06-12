import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Views
import Home from './pages/Home';
import Login from './pages/Login';
import OtpVerify from './pages/OtpVerify';
import Dashboard from './pages/Dashboard';
import AdminPanel from './pages/admin/AdminPanel';
import AuditLog from './pages/admin/AuditLog';
import MasterData from './pages/admin/MasterData';
import FundReports from './pages/FundReports';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify-otp" element={<OtpVerify />} />

          {/* Protected Routes (Staff & Admin) */}
          <Route element={<ProtectedRoute allowedRoles={['staff', 'admin']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/fund-reports" element={<FundReports />} />
          </Route>

          {/* Admin Protected Routes */}
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/admin/sessions" element={<AuditLog />} />
            <Route path="/admin/master-data" element={<MasterData />} />
          </Route>

          {/* Fallback Catch All */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
