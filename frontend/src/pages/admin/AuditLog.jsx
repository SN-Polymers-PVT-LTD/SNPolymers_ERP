import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import authApi from '../../api/authApi';

const AuditLog = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [userIdFilter, setUserIdFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [usersList, setUsersList] = useState([]);

  useEffect(() => {
    fetchLogs();
    fetchUsersList();
  }, []);

  const fetchUsersList = async () => {
    try {
      const response = await authApi.get('/admin/users');
      if (response.data?.success) {
        setUsersList(response.data.users);
      }
    } catch (err) {
      console.error('Failed to retrieve user filter dropdown data:', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (userIdFilter) params.userId = userIdFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const response = await authApi.get('/admin/sessions', { params });
      if (response.data?.success) {
        setSessions(response.data.sessions);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch session audit logs.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = (e) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleResetFilters = () => {
    setUserIdFilter('');
    setDateFrom('');
    setDateTo('');
    setTimeout(() => {
      fetchLogs();
    }, 50);
  };

  const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return 'Active Operator';
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Header */}
      <header className="border-b border-admin-border/80 bg-admin-bg/95 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="h-8 w-8 rounded bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center font-bold text-slate-100 text-sm shadow">
              SNP
            </Link>
            <div className="flex flex-col">
              <span className="font-bold text-xs tracking-wider text-slate-100 uppercase">
                System Audit Trail
              </span>
              <span className="text-[9px] text-amber-500 font-bold tracking-wider uppercase">
                Verification Ledger
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold uppercase tracking-wider px-3 py-1.5 rounded transition">
              Whitelist Database
            </Link>
            <Link to="/dashboard" className="text-[11px] bg-amber-600 hover:bg-amber-700 text-slate-950 font-bold uppercase tracking-wider px-3 py-1.5 rounded transition">
              Console Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main Grid Panel */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-10">
        <div className="mb-8 border-b border-admin-border/60 pb-6">
          <h1 className="text-2xl font-bold uppercase tracking-wider text-slate-100">Session Audit & Integrity Trails</h1>
          <p className="text-xs text-slate-300 font-semibold mt-1">Review active system authorizations, login times, IP entries, and total elapsed duration.</p>
        </div>

        {/* Filter Toolbar */}
        <form onSubmit={handleApplyFilters} className="bg-admin-card border border-admin-border p-5 rounded mb-8 flex flex-wrap gap-4 items-end">
          <div className="flex-grow min-w-[200px]">
            <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">Filter By Operator</label>
            <select
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              className="w-full bg-slate-950 border border-admin-border outline-none rounded px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All Whitelisted Operators</option>
              {usersList.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name ? `${user.display_name} (${user.mobile_number})` : user.mobile_number}
                </option>
              ))}
            </select>
          </div>

          <div className="w-[180px]">
            <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">Query From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-slate-950 border border-admin-border outline-none rounded px-3 py-2 text-sm text-slate-200"
            />
          </div>

          <div className="w-[180px]">
            <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-2">Query To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-slate-950 border border-admin-border outline-none rounded px-3 py-2 text-sm text-slate-200"
            />
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResetFilters}
              className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition"
            >
              Reset
            </button>
            <button
              type="submit"
              className="bg-amber-600 hover:bg-amber-700 text-slate-100 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition"
            >
              Filter Ledger
            </button>
          </div>
        </form>

        {error && (
          <div className="p-3 bg-red-950/20 border border-red-900/40 rounded text-xs text-red-300 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
            {error}
          </div>
        )}

        {/* Sessions Table */}
        <div className="bg-admin-card border border-admin-border rounded overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-20">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center p-20 text-slate-400 text-xs uppercase font-bold tracking-wider">
              No session records match requested query specifications.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-admin-border bg-slate-950/50 text-[10px] uppercase tracking-wider text-slate-300">
                    <th className="py-3 px-6 font-bold">Operator</th>
                    <th className="py-3 px-6 font-bold">Verification Token</th>
                    <th className="py-3 px-6 font-bold">Verification Login Time</th>
                    <th className="py-3 px-6 font-bold">Session Expiry/Logout</th>
                    <th className="py-3 px-6 font-bold">Elapsed Duration</th>
                    <th className="py-3 px-6 font-bold">Network Location & Environment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 text-xs text-slate-200">
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-slate-900/10 transition">
                      <td className="py-3 px-6 font-semibold text-slate-200">
                        {session.authorised_users?.display_name || <span className="text-slate-400 italic font-medium">No Display Name</span>}
                      </td>
                      <td className="py-3 px-6 font-mono text-slate-300 font-semibold">{session.authorised_users?.mobile_number || 'Revoked User'}</td>
                      <td className="py-3 px-6 text-[11px] text-slate-300 font-medium">{formatDate(session.login_at)}</td>
                      <td className="py-3 px-6 text-[11px] text-slate-300 font-medium">
                        {session.is_active ? (
                          <span className="text-emerald-400 font-bold bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-900/30 text-[9px] uppercase tracking-wider">Active session</span>
                        ) : (
                          formatDate(session.logout_at)
                        )}
                      </td>
                      <td className="py-3 px-6 font-mono text-[11px] text-slate-200 font-semibold">{formatDuration(session.duration_seconds)}</td>
                      <td className="py-3 px-6 text-[11px] text-slate-300 font-medium">
                        <div className="font-mono">{session.ip_address || 'Unknown'}</div>
                        <div className="truncate max-w-[200px]" title={session.user_agent}>{session.user_agent || 'Unknown'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AuditLog;
