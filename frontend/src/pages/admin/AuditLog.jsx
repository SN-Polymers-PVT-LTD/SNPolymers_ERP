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
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent hover:border-white/5 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Access Whitelist
          </Link>
          <Link
            to="/admin/sessions"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-100 text-xs font-bold uppercase tracking-wider transition-all duration-300"
          >
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">Audit Trail</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-[10px] bg-slate-900 border border-white/10 text-slate-200 font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg">
            Dashboard
          </Link>
        </div>
      </header>

      {/* Main Grid Panel */}
      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        <div className="mb-10 pb-6 border-b border-white/5">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Console Verification Ledger</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Session Audit & Integrity Trails</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">Review active system authorizations, login times, IP entries, and total elapsed duration.</p>
        </div>

        {/* Filter Toolbar */}
        <form onSubmit={handleApplyFilters} className="glass-panel p-5 rounded-3xl mb-8 flex flex-wrap gap-4 items-end border border-white/5 shadow-lg">
          <div className="flex-grow min-w-[200px]">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Filter By Operator</label>
            <select
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              className="w-full glass-input outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
            >
              <option value="" className="bg-slate-900 text-slate-100">All Whitelisted Operators</option>
              {usersList.map((user) => (
                <option key={user.id} value={user.id} className="bg-slate-900 text-slate-100">
                  {user.display_name ? `${user.display_name} (${user.mobile_number})` : user.mobile_number}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-[180px]">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Query From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full glass-input outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
            />
          </div>

          <div className="w-full sm:w-[180px]">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Query To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full glass-input outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
            />
          </div>

          <div className="flex gap-2 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleResetFilters}
              className="bg-white/5 border border-white/5 hover:bg-white/10 text-slate-200 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 w-full sm:w-auto"
            >
              Reset
            </button>
            <button
              type="submit"
              className="bg-white text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 w-full sm:w-auto transform hover:-translate-y-0.5"
            >
              Filter Ledger
            </button>
          </div>
        </form>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
            {error}
          </div>
        )}

        {/* Sessions Table */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
              No session records match requested query specifications.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="py-4.5 px-6 font-extrabold">Operator</th>
                    <th className="py-4.5 px-6 font-extrabold">Verification Token</th>
                    <th className="py-4.5 px-6 font-extrabold">Verification Login Time</th>
                    <th className="py-4.5 px-6 font-extrabold">Session Expiry/Logout</th>
                    <th className="py-4.5 px-6 font-extrabold">Elapsed Duration</th>
                    <th className="py-4.5 px-6 font-extrabold font-sans">Network Location & Environment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                      <td className="py-4 px-6 font-bold text-slate-100">
                        {session.authorised_users?.display_name || <span className="text-slate-500 italic font-normal font-sans">No Display Name</span>}
                      </td>
                      <td className="py-4 px-6 font-mono text-slate-200 font-semibold">{session.authorised_users?.mobile_number || 'Revoked User'}</td>
                      <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">{formatDate(session.login_at)}</td>
                      <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">
                        {session.is_active ? (
                          <span className="text-emerald-400 font-extrabold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg text-[9px] uppercase tracking-widest">Active session</span>
                        ) : (
                          formatDate(session.logout_at)
                        )}
                      </td>
                      <td className="py-4 px-6 font-mono text-[11px] text-slate-200 font-semibold">{formatDuration(session.duration_seconds)}</td>
                      <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">
                        <div className="font-mono text-slate-200">{session.ip_address || 'Unknown'}</div>
                        <div className="truncate max-w-[200px] text-slate-400" title={session.user_agent}>{session.user_agent || 'Unknown'}</div>
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
