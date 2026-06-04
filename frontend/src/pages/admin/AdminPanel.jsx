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
    <div className="min-h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] rounded-full bg-indigo-500/10 blur-[150px] pointer-events-none animate-pulse" style={{ animationDuration: '12s' }}></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-amber-500/5 blur-[130px] pointer-events-none animate-pulse" style={{ animationDuration: '18s' }}></div>

      {/* Left Sidebar Navigation - Desktop */}
      <aside className="hidden md:flex flex-col w-64 glass-nav border-r border-white/5 p-6 relative z-20 shrink-0">
        <div className="flex items-center gap-3.5 mb-10">
          <Link to="/dashboard">
            <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-10 w-auto object-contain" />
          </Link>
          <div className="flex flex-col">
            <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">
              S.N. Polymers
            </span>
            <span className="text-[9px] text-amber-500 font-extrabold tracking-widest uppercase">
              ERP Console
            </span>
          </div>
        </div>

        {/* Sidebar Nav Links */}
        <nav className="flex-grow space-y-2">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
            </svg>
            Command Center
          </Link>
          <Link
            to="/admin"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-100 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Access Whitelist
          </Link>
          <Link
            to="/admin/sessions"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Audit Trail Logs
          </Link>
        </nav>
      </aside>

      {/* Header bar for Mobile view */}
      <header className="md:hidden glass-nav sticky top-0 z-50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-8 w-auto object-contain" />
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">Whitelist DB</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg">
            Dashboard
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Console System Policies</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Authorized Access Whitelist</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Configure user accounts and mobile number tokens authorized to bypass firewall credentials.</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Authorize User Credentials
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
            {success}
          </div>
        )}

        {/* Database Whitelist Table */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
              No authorized system credentials discovered. Click button above to initialize.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="py-4.5 px-6 font-extrabold">Authorized Account Name</th>
                    <th className="py-4.5 px-6 font-extrabold">Authentication Token</th>
                    <th className="py-4.5 px-6 font-extrabold">Privilege Level</th>
                    <th className="py-4.5 px-6 font-extrabold">Last Verification Access</th>
                    <th className="py-4.5 px-6 font-extrabold">Verification Count</th>
                    <th className="py-4.5 px-6 font-extrabold text-center">Firewall Status</th>
                    <th className="py-4.5 px-6 font-extrabold text-right">Access Revocation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                      <td className="py-4 px-6 font-bold text-slate-100">
                        {user.display_name || <span className="text-slate-500 italic font-normal">No Display Name</span>}
                      </td>
                      <td className="py-4 px-6 font-mono text-slate-200 font-semibold">{user.mobile_number}</td>
                      <td className="py-4 px-6">
                        <span className={`px-2.5 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider ${
                          user.role === 'admin' ? 'bg-indigo-950/40 text-indigo-400 border border-indigo-900/30' : 'bg-white/5 text-slate-300 border border-white/5'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">{formatDate(user.last_login_at)}</td>
                      <td className="py-4 px-6 font-mono text-slate-200 font-semibold">{user.session_count || 0}</td>
                      <td className="py-4 px-6 text-center">
                        <button
                          onClick={() => toggleUserStatus(user)}
                          className={`px-3 py-1.5 rounded-xl text-[10px] uppercase font-bold tracking-wider transition-all duration-300 shadow-md ${
                            user.is_active
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                          }`}
                        >
                          {user.is_active ? 'Active' : 'Deactivated'}
                        </button>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-[10px] font-bold uppercase tracking-wider bg-red-500/5 border border-red-500/20 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-xl transition-all duration-200"
                        >
                          Revoke
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
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
            <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">Authorize New Account</h3>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleAddUser} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Authorized Mobile Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+919876543210"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    required
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Account User Display Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Console Access Level Privilege
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-300 text-sm font-semibold transition"
                    disabled={submitting}
                  >
                    <option value="staff" className="bg-slate-900 text-slate-100">Staff Operator (Standard Access)</option>
                    <option value="admin" className="bg-slate-900 text-slate-100">System Admin (Full Controls)</option>
                  </select>
                </div>

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
                    disabled={submitting}
                  >
                    {submitting ? 'Authorizing...' : 'Authorize Credentials'}
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
