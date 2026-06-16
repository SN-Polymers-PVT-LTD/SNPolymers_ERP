import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import authApi from '../../api/authApi';
import BackgroundShapes from '../../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../../components/Sidebar';

// Small inline Telegram icon
const TelegramBadgeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="inline-block">
    <circle cx="120" cy="120" r="120" fill="#2AABEE" />
    <path d="M81.7 133.2l-4.1 43.9c5.9 0 8.4-2.5 11.4-5.5l27.3-26.1 56.6 41.4c10.4 5.7 17.7 2.7 20.5-9.6l37.2-174.4c3.3-15.4-5.6-21.5-15.7-17.8L11.2 98.5c-15 5.9-14.8 14.3-2.7 18.1l49.4 15.4 114.5-72c5.4-3.3 10.3-1.5 6.3 2.1L81.7 133.2z" fill="white" />
  </svg>
);

const AdminPanel = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [submitting, setSubmitting] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('staff');
  const [editActive, setEditActive] = useState(true);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('whitelist');
  const [purchaseOptions, setPurchaseOptions] = useState([]);
  const [loadingPurchase, setLoadingPurchase] = useState(false);
  const [showAddPurchaseModal, setShowAddPurchaseModal] = useState(false);
  const [newPurchaseName, setNewPurchaseName] = useState('');
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);

  const [showEditPurchaseModal, setShowEditPurchaseModal] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [editPurchaseName, setEditPurchaseName] = useState('');
  const [editPurchaseSubmitting, setEditPurchaseSubmitting] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchPurchaseOptions();
  }, []);

  const fetchPurchaseOptions = async () => {
    setLoadingPurchase(true);
    try {
      const response = await authApi.get('/purchase-data');
      if (response.data?.success) {
        setPurchaseOptions(response.data.options);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch purchase options.');
    } finally {
      setLoadingPurchase(false);
    }
  };

  const handleAddPurchaseOption = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!newPurchaseName.trim()) {
      setError('Option name cannot be blank.');
      return;
    }
    setPurchaseSubmitting(true);
    try {
      const response = await authApi.post('/purchase-data', {
        name: newPurchaseName.trim()
      });
      if (response.data?.success) {
        setSuccess('Purchase option created successfully.');
        setShowAddPurchaseModal(false);
        setNewPurchaseName('');
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create purchase option.');
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const openEditPurchaseModal = (option) => {
    setEditingPurchase(option);
    setEditPurchaseName(option.name || '');
    setError('');
    setSuccess('');
    setShowEditPurchaseModal(true);
  };

  const handleEditPurchaseOption = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!editPurchaseName.trim()) {
      setError('Option name cannot be blank.');
      return;
    }
    setEditPurchaseSubmitting(true);
    try {
      const response = await authApi.put(`/purchase-data/${editingPurchase.id}`, {
        name: editPurchaseName.trim()
      });
      if (response.data?.success) {
        setSuccess('Purchase option updated successfully.');
        setShowEditPurchaseModal(false);
        setEditingPurchase(null);
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update purchase option.');
    } finally {
      setEditPurchaseSubmitting(false);
    }
  };

  const togglePurchaseOption = async (option) => {
    setError('');
    setSuccess('');
    try {
      const response = await authApi.patch(`/purchase-data/${option.id}/status`, {
        is_active: !option.is_active
      });
      if (response.data?.success) {
        setSuccess('Purchase option status updated.');
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle status.');
    }
  };

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

  const openEditModal = (user) => {
    setEditingUser(user);
    setEditName(user.display_name || '');
    setEditRole(user.role || 'staff');
    setEditActive(user.is_active);
    setError('');
    setSuccess('');
    setShowEditModal(true);
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setEditSubmitting(true);

    try {
      const response = await authApi.patch(`/admin/users/${editingUser.id}`, {
        displayName: editName,
        role: editRole,
        isActive: editActive,
      });

      if (response.data?.success) {
        setSuccess('User updated successfully.');
        setShowEditModal(false);
        setEditingUser(null);
        fetchUsers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update user.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleClearTelegram = async () => {
    if (!editingUser) return;
    if (!window.confirm('Clear this user\'s Telegram link? They will need to complete Telegram setup again on next login.')) return;

    setError('');
    setSuccess('');
    setClearingTelegram(true);

    try {
      const response = await authApi.patch(`/admin/users/${editingUser.id}`, {
        telegramChatId: null,
      });

      if (response.data?.success) {
        setSuccess('Telegram link cleared. User will re-link on next login.');
        // Update the editingUser state to reflect cleared value
        setEditingUser((prev) => ({ ...prev, telegram_chat_id: null }));
        fetchUsers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to clear Telegram link.');
    } finally {
      setClearingTelegram(false);
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
        setSuccess('User credentials status modified successfully.');
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
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      {/* Background Silhouettes & Ambient Glows */}
      <BackgroundShapes />

      <Sidebar />
      <MobileHeader />

      {/* Content */}
      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10 font-sans">

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Console System Policies</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
              {activeTab === 'whitelist' ? 'Authorized Access Whitelist' : 'Material Purchase Options'}
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              {activeTab === 'whitelist' 
                ? 'Configure user accounts and mobile number tokens authorized to bypass firewall credentials.'
                : 'Configure material purchase sources available in Phase 2 estimate item selections.'}
            </p>
          </div>
          {activeTab === 'whitelist' ? (
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Authorize User Credentials
            </button>
          ) : (
            <button
              onClick={() => setShowAddPurchaseModal(true)}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Purchase Option
            </button>
          )}
        </div>

        {/* Tab switching buttons */}
        <div className="flex gap-6 mb-8 border-b border-white/5">
          <button
            onClick={() => setActiveTab('whitelist')}
            className={`pb-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeTab === 'whitelist' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Access Whitelist
          </button>
          <button
            onClick={() => setActiveTab('purchase')}
            className={`pb-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeTab === 'purchase' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Purchase Options
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {activeTab === 'whitelist' ? (
          /* Database Whitelist Table */
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loading ? (
              <div className="flex items-center justify-center p-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
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
                      <th className="py-4 px-6 font-extrabold">Authorized Account Name</th>
                      <th className="py-4 px-6 font-extrabold">Authentication Token</th>
                      <th className="py-4 px-6 font-extrabold">Privilege Level</th>
                      <th className="py-4 px-6 font-extrabold">Telegram</th>
                      <th className="py-4 px-6 font-extrabold">Last Verification Access</th>
                      <th className="py-4 px-6 font-extrabold">Verification Count</th>
                      <th className="py-4 px-6 font-extrabold text-center">Firewall Status</th>
                      <th className="py-4 px-6 font-extrabold text-right">Actions</th>
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
                            user.role === 'admin'
                              ? 'bg-indigo-950/40 text-indigo-400 border border-indigo-900/30'
                              : 'bg-white/5 text-slate-300 border border-white/5'
                          }`}>
                            {user.role}
                          </span>
                        </td>

                        {/* Telegram Status Column */}
                        <td className="py-4 px-6">
                          {user.telegram_chat_id ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider bg-emerald-950/40 text-emerald-400 border border-emerald-900/30">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Connected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider bg-red-950/40 text-red-400 border border-red-900/30">
                              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                              Not set
                            </span>
                          )}
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
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditModal(user)}
                              className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 hover:bg-white/10 px-3 py-1.5 rounded-xl transition-all duration-200"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteUser(user.id)}
                              className="text-[10px] font-bold uppercase tracking-wider bg-red-500/5 border border-red-500/20 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-xl transition-all duration-200"
                            >
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Purchase Options Whitelist Table */
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loadingPurchase ? (
              <div className="flex items-center justify-center p-24">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
              </div>
            ) : purchaseOptions.length === 0 ? (
              <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                No purchase options discovered. Click button above to initialize.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-slate-400">
                      <th className="py-4 px-6 font-extrabold">Option Name</th>
                      <th className="py-4 px-6 font-extrabold">Created By</th>
                      <th className="py-4 px-6 font-extrabold">Created At</th>
                      <th className="py-4 px-6 font-extrabold text-center">Status</th>
                      <th className="py-4 px-6 font-extrabold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                    {purchaseOptions.map((option) => (
                      <tr key={option.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                        <td className="py-4 px-6 font-bold text-slate-100">{option.name}</td>
                        <td className="py-4 px-6 font-mono text-slate-400">{option.created_by || 'System'}</td>
                        <td className="py-4 px-6 text-slate-400">{formatDate(option.created_at)}</td>
                        <td className="py-4 px-6 text-center">
                          <button
                            onClick={() => togglePurchaseOption(option)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] uppercase font-bold tracking-wider transition-all duration-300 shadow-md ${
                              option.is_active
                                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                                : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                            }`}
                          >
                            {option.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => openEditPurchaseModal(option)}
                            className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 hover:bg-white/10 px-3 py-1.5 rounded-xl transition-all duration-200"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ADD USER MODAL ── */}
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

                {/* Telegram Chat ID — read-only, auto-filled */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Telegram Chat ID
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-filled when user starts the bot"
                    readOnly
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-500 text-sm font-semibold transition cursor-not-allowed opacity-60"
                  />
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                    <TelegramBadgeIcon />
                    <span>This will be filled automatically when the user logs in for the first time and completes Telegram setup.</span>
                  </p>
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

        {/* ── EDIT USER MODAL ── */}
        {showEditModal && editingUser && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
            <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">Edit User Account</h3>
                <button
                  onClick={() => { setShowEditModal(false); setEditingUser(null); }}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleEditUser} className="space-y-5">
                {/* Mobile (read-only) */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    value={editingUser.mobile_number}
                    readOnly
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-400 text-sm font-mono font-semibold transition cursor-not-allowed opacity-70"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    disabled={editSubmitting}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Access Level
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-300 text-sm font-semibold transition"
                    disabled={editSubmitting}
                  >
                    <option value="staff" className="bg-slate-900 text-slate-100">Staff Operator (Standard Access)</option>
                    <option value="admin" className="bg-slate-900 text-slate-100">System Admin (Full Controls)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Account Status
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setEditActive(true)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${
                        editActive
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                      disabled={editSubmitting}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditActive(false)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${
                        !editActive
                          ? 'bg-red-500/15 border-red-500/30 text-red-400'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                      disabled={editSubmitting}
                    >
                      Deactivated
                    </button>
                  </div>
                </div>

                {/* Telegram Chat ID field */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Telegram Chat ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editingUser.telegram_chat_id || ''}
                      readOnly
                      placeholder="Not linked yet"
                      className="flex-1 glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-400 text-sm font-mono font-semibold transition cursor-not-allowed opacity-70"
                    />
                    {editingUser.telegram_chat_id && (
                      <button
                        type="button"
                        onClick={handleClearTelegram}
                        disabled={clearingTelegram || editSubmitting}
                        className="px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/20 transition-all duration-200 disabled:opacity-50 shrink-0"
                        title="Clear Telegram link"
                      >
                        {clearingTelegram ? '...' : 'Clear'}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                    <TelegramBadgeIcon />
                    <span>
                      {editingUser.telegram_chat_id
                        ? 'Telegram is connected. Use "Clear" if the user switches Telegram accounts.'
                        : 'This will be filled automatically when the user completes Telegram setup on login.'}
                    </span>
                  </p>
                </div>

                {/* Inline error/success inside modal */}
                {error && (
                  <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-3 bg-emerald-950/20 border border-emerald-900/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {success}
                  </div>
                )}

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    type="button"
                    onClick={() => { setShowEditModal(false); setEditingUser(null); }}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                    disabled={editSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
                    disabled={editSubmitting}
                  >
                    {editSubmitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── ADD PURCHASE DATA OPTION MODAL ── */}
        {showAddPurchaseModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
            <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">Add Purchase Option</h3>
                <button onClick={() => setShowAddPurchaseModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleAddPurchaseOption} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Option Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Local Market"
                    value={newPurchaseName}
                    onChange={(e) => setNewPurchaseName(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    required
                    disabled={purchaseSubmitting}
                  />
                </div>

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    type="button"
                    onClick={() => setShowAddPurchaseModal(false)}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                    disabled={purchaseSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
                    disabled={purchaseSubmitting}
                  >
                    {purchaseSubmitting ? 'Creating...' : 'Create Option'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── EDIT PURCHASE DATA OPTION MODAL ── */}
        {showEditPurchaseModal && editingPurchase && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
            <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">Edit Purchase Option Name</h3>
                <button
                  onClick={() => { setShowEditPurchaseModal(false); setEditingPurchase(null); }}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleEditPurchaseOption} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Option Name
                  </label>
                  <input
                    type="text"
                    value={editPurchaseName}
                    onChange={(e) => setEditPurchaseName(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    required
                    disabled={editPurchaseSubmitting}
                  />
                </div>

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    type="button"
                    onClick={() => { setShowEditPurchaseModal(false); setEditingPurchase(null); }}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                    disabled={editPurchaseSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
                    disabled={editPurchaseSubmitting}
                  >
                    {editPurchaseSubmitting ? 'Saving...' : 'Save Changes'}
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
