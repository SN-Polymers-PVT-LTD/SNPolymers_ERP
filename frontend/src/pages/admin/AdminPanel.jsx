import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import authApi from '../../api/authApi';

const AdminPanel = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await authApi.get('/admin/users');
      if (response.data?.success) {
        setUsers(response.data.users);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Authorization error: Failed to fetch user credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    let formattedNumber = newMobile.trim();
    if (/^\d{10}$/.test(formattedNumber)) {
      formattedNumber = `+91${formattedNumber}`;
    }

    try {
      const response = await authApi.post('/admin/users', {
        mobileNumber: formattedNumber,
        displayName: newName,
        role: newRole
      });

      if (response.data?.success) {
        setSuccess('New user authorized and added to system whitelist.');
        setShowAddModal(false);
        setNewMobile('');
        setNewName('');
        setNewRole('staff');
        fetchUsers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to authorize new credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserStatus = async (user) => {
    setError('');
    setSuccess('');
    try {
      const response = await authApi.patch(`/admin/users/${user.id}`, {
        isActive: !user.is_active
      });
      if (response.data?.success) {
        setSuccess(`User credentials status modified successfully.`);
        fetchUsers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to modify credential status.');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('WARNING: Deleting this user will instantly revoke their access and terminate all active sessions. Confirm deletion?')) {
      return;
    }
    setError('');
    setSuccess('');
    try {
      const response = await authApi.delete(`/admin/users/${userId}`);
      if (response.data?.success) {
        setSuccess('Access authorization revoked. User deleted.');
        fetchUsers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to revoke authorization.');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Header */}
      <header className="border-b border-admin-border/80 bg-admin-bg/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard">
              <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-8 w-auto object-contain" />
            </Link>
            <div className="flex flex-col">
              <span className="font-bold text-xs tracking-wider text-slate-100 uppercase">
                Access Whitelist Admin
              </span>
              <span className="text-[9px] text-amber-500 font-bold tracking-wider uppercase">
                Database Policy Console
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold uppercase tracking-wider px-3 py-1.5 rounded transition">
              Console Dashboard
            </Link>
            <Link to="/admin/sessions" className="text-[11px] bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/40 text-amber-400 font-bold uppercase tracking-wider px-3 py-1.5 rounded transition">
              System Audit Logs
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-10">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 border-b border-admin-border/60 pb-6">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-wider text-slate-100">Authorized System Access Whitelist</h1>
            <p className="text-xs text-slate-300 font-semibold mt-1">Configure user accounts and mobile number tokens authorized to bypass firewall credentials.</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-amber-600 hover:bg-amber-700 text-slate-100 px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider border border-amber-500/20 shadow transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Authorize User Credentials
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-950/20 border border-red-900/40 rounded text-xs text-red-300 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded text-xs text-emerald-300 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            {success}
          </div>
        )}

        {/* Database Whitelist Table */}
        <div className="bg-admin-card border border-admin-border rounded overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center p-20 text-slate-400 text-xs uppercase font-bold tracking-wider">
              No authorized system credentials discovered. Click button above to initialize.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-admin-border bg-slate-950/50 text-[10px] uppercase tracking-wider text-slate-300">
                    <th className="py-3 px-6 font-bold">Authorized Account Name</th>
                    <th className="py-3 px-6 font-bold">Authentication Token (Mobile)</th>
                    <th className="py-3 px-6 font-bold">System Privilege Role</th>
                    <th className="py-3 px-6 font-bold">Last Verification Access</th>
                    <th className="py-3 px-6 font-bold">Verification Count</th>
                    <th className="py-3 px-6 font-bold text-center">Firewall Status</th>
                    <th className="py-3 px-6 font-bold text-right">Access Revocation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 text-xs text-slate-200">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-900/10 transition">
                      <td className="py-3.5 px-6 font-semibold text-slate-200">
                        {user.display_name || <span className="text-slate-400 italic font-medium">No Display Name</span>}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-slate-300 font-semibold">{user.mobile_number}</td>
                      <td className="py-3.5 px-6">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          user.role === 'admin' ? 'bg-indigo-950/30 text-indigo-400 border border-indigo-900/30' : 'bg-slate-950 text-slate-300 border border-slate-900'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-[11px] text-slate-300 font-medium">{formatDate(user.last_login_at)}</td>
                      <td className="py-3.5 px-6 font-mono text-slate-300 font-semibold">{user.session_count || 0}</td>
                      <td className="py-3.5 px-6 text-center">
                        <button
                          onClick={() => toggleUserStatus(user)}
                          className={`px-3 py-1 rounded text-[10px] uppercase font-bold tracking-wider transition ${
                            user.is_active
                              ? 'bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 hover:bg-emerald-900/20'
                              : 'bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-900/20'
                          }`}
                        >
                          {user.is_active ? 'Authorized' : 'Deactivated'}
                        </button>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-[10px] font-bold uppercase tracking-wider bg-red-950/20 border border-red-900/40 text-red-400 hover:bg-red-900/40 px-2 py-1 rounded transition"
                        >
                          Revoke Access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add User Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-admin-card border border-admin-border p-6 rounded max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">Authorize New Account</h3>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Authorized Mobile Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+919876543210"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    className="w-full bg-slate-950 border border-admin-border focus:border-amber-600 outline-none rounded px-3 py-2 text-slate-100 text-sm font-semibold transition"
                    required
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Account User Display Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-950 border border-admin-border focus:border-amber-600 outline-none rounded px-3 py-2 text-slate-100 text-sm font-semibold transition"
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Console Access Level Privilege
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full bg-slate-950 border border-admin-border focus:border-amber-600 outline-none rounded px-3 py-2 text-slate-100 text-sm font-semibold transition"
                    disabled={submitting}
                  >
                    <option value="staff">Staff Operators (Standard Modules Access)</option>
                    <option value="admin">System Administrators (Full Whitelist Controls & System Logs)</option>
                  </select>
                </div>

                <div className="flex gap-3 justify-end mt-6">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-amber-600 hover:bg-amber-700 text-slate-100 px-5 py-2.5 rounded text-xs font-bold uppercase tracking-wider border border-amber-500/20 transition"
                    disabled={submitting}
                  >
                    {submitting ? 'Authorizing...' : 'Submit Authentication Whitelist'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPanel;
