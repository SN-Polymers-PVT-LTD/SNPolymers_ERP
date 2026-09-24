import React, { useState, useEffect, useMemo } from 'react';
import authApi from '../../api/authApi';
import { SkeletonTable, Modal, Pagination } from '../../components/ui';
import { useAuditSessionsUrlState } from '../../hooks/useAuditSessionsUrlState';

const AuditLog = () => {
  const {
    userId,
    dateFrom,
    dateTo,
    status,
    searchQuery,
    page,
    pageSize,
    isInspectModalOpen,
    selectedSessionId,
    setStatus,
    setSearchQuery,
    setPage,
    setPageSize,
    openInspectModal,
    closeModal,
    applyFilters,
    resetFilters,
    hasActiveFilters,
  } = useAuditSessionsUrlState();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usersList, setUsersList] = useState([]);

  // Local form buffer states for immediate responsive typing
  const [formUserId, setFormUserId] = useState(userId);
  const [formDateFrom, setFormDateFrom] = useState(dateFrom);
  const [formDateTo, setFormDateTo] = useState(dateTo);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [copiedUa, setCopiedUa] = useState(false);

  // Sync local form state whenever URL state changes (e.g. Back/Forward button, deep link)
  useEffect(() => {
    setFormUserId(userId);
    setFormDateFrom(dateFrom);
    setFormDateTo(dateTo);
    setLocalSearch(searchQuery);
  }, [userId, dateFrom, dateTo, searchQuery]);

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
      if (userId) params.userId = userId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const response = await authApi.get('/admin/sessions', { params });
      if (response.data?.success) {
        setSessions(response.data.sessions || []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch session audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersList();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateFrom, dateTo]);

  const handleApplyFilters = (e) => {
    if (e) e.preventDefault();
    applyFilters({
      userId: formUserId,
      dateFrom: formDateFrom,
      dateTo: formDateTo,
      status,
      q: localSearch
    });
  };

  const handleResetFilters = () => {
    setFormUserId('');
    setFormDateFrom('');
    setFormDateTo('');
    setLocalSearch('');
    resetFilters();
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setLocalSearch(val);
    setSearchQuery(val, { debounce: true });
  };

  // Filter sessions in memory based on status and search query
  const filteredSessions = useMemo(() => {
    const searchTarget = (localSearch !== '' ? localSearch : searchQuery).trim().toLowerCase();
    return sessions.filter((session) => {
      // 1. Status Filter
      if (status === 'active' && !session.is_active) return false;
      if (status === 'expired' && session.is_active) return false;

      // 2. Search Query Filter
      if (searchTarget) {
        const userName = (session.authorised_users?.display_name || '').toLowerCase();
        const userMobile = (session.authorised_users?.mobile_number || '').toLowerCase();
        const userRole = (session.authorised_users?.role || '').toLowerCase();
        const ip = (session.ip_address || '').toLowerCase();
        const ua = (session.user_agent || '').toLowerCase();

        const matches =
          userName.includes(searchTarget) ||
          userMobile.includes(searchTarget) ||
          userRole.includes(searchTarget) ||
          ip.includes(searchTarget) ||
          ua.includes(searchTarget);

        if (!matches) return false;
      }

      return true;
    });
  }, [sessions, status, localSearch, searchQuery]);

  // Pagination calculation
  const totalCount = filteredSessions.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const activePage = Math.min(page, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const paginatedSessions = useMemo(() => {
    return filteredSessions.slice(startIndex, startIndex + pageSize);
  }, [filteredSessions, startIndex, pageSize]);

  // Selected session for Inspect Modal
  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return sessions.find((s) => String(s.id) === String(selectedSessionId)) || null;
  }, [sessions, selectedSessionId]);

  const handleCopyUa = (ua) => {
    if (!ua) return;
    navigator.clipboard.writeText(ua);
    setCopiedUa(true);
    setTimeout(() => setCopiedUa(false), 2000);
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

  const activeCount = useMemo(() => sessions.filter(s => s.is_active).length, [sessions]);
  const expiredCount = useMemo(() => sessions.filter(s => !s.is_active).length, [sessions]);

  return (
    <>
      {/* Main Grid Panel */}
      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
          
          {/* Header Section */}
          <div className="mb-8 pb-6 border-b border-white/5 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Console Verification Ledger</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Session Audit & Integrity Trails</h1>
              <p className="text-xs text-slate-400 font-medium mt-1.5">Review active system authorizations, login times, IP entries, and total elapsed duration.</p>
            </div>

            {/* Quick KPI Badges */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-center">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Logged</div>
                <div className="text-base font-extrabold text-slate-100">{sessions.length}</div>
              </div>
              <div className="px-4 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">Active Now</div>
                <div className="text-base font-extrabold text-emerald-400">{activeCount}</div>
              </div>
              <div className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 text-center">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Terminated</div>
                <div className="text-base font-extrabold text-slate-300">{expiredCount}</div>
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <form onSubmit={handleApplyFilters} className="glass-panel p-5 rounded-3xl mb-8 space-y-4 border border-white/5 shadow-lg">
            
            {/* Top Row: Search and Status Filters */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              
              {/* Quick Text Search */}
              <div className="relative flex-grow w-full md:max-w-md">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Search Operator, Mobile, IP, or Browser..."
                  value={localSearch}
                  onChange={handleSearchChange}
                  className="w-full pl-10 pr-9 py-2.5 rounded-xl text-xs glass-input text-slate-200 placeholder:text-slate-500 outline-none"
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalSearch('');
                      setSearchQuery('');
                    }}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Status Segmented Buttons */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/5 border border-white/10 shrink-0 w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setStatus('all')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    status === 'all'
                      ? 'bg-amber-500 text-slate-950 font-extrabold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  All Sessions
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('active')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    status === 'active'
                      ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  Active Only
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('expired')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    status === 'expired'
                      ? 'bg-slate-200 text-slate-950 font-extrabold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  Terminated
                </button>
              </div>
            </div>

            {/* Bottom Row: Operator Dropdown, Dates, Apply & Reset */}
            <div className="flex flex-wrap gap-4 items-end pt-2 border-t border-white/5">
              <div className="flex-grow min-w-[200px]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Filter By Operator</label>
                <select
                  value={formUserId}
                  onChange={(e) => setFormUserId(e.target.value)}
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

              <div className="w-full sm:w-[160px]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Query From</label>
                <input
                  type="date"
                  value={formDateFrom}
                  onChange={(e) => setFormDateFrom(e.target.value)}
                  className="w-full glass-input outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
                />
              </div>

              <div className="w-full sm:w-[160px]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Query To</label>
                <input
                  type="date"
                  value={formDateTo}
                  onChange={(e) => setFormDateTo(e.target.value)}
                  className="w-full glass-input outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
                />
              </div>

              <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 w-full sm:w-auto"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 w-full sm:w-auto transform hover:-translate-y-0.5"
                >
                  Filter Ledger
                </button>
              </div>
            </div>
          </form>

          {error && (
            <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              {error}
            </div>
          )}

          {/* Sessions Table */}
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loading ? (
              <SkeletonTable rows={6} cols={6} />
            ) : filteredSessions.length === 0 ? (
              <div className="text-center p-20 space-y-3">
                <div className="text-slate-500 text-3xl">🔍</div>
                <div className="text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                  No session records match requested query specifications.
                </div>
                {hasActiveFilters && (
                  <div>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="mt-2 text-xs font-bold text-amber-400 hover:text-amber-300 underline"
                    >
                      Reset all filters
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
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
                        <th className="py-4.5 px-6 font-extrabold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                      {paginatedSessions.map((session) => (
                        <tr
                          key={session.id}
                          className="hover:bg-white/[0.02] transition-colors duration-200 cursor-pointer"
                          onClick={() => openInspectModal(session.id)}
                        >
                          <td className="py-4 px-6 font-bold text-slate-100">
                            <div className="flex items-center gap-2">
                              <span>{session.authorised_users?.display_name || <span className="text-slate-500 italic font-normal font-sans">No Display Name</span>}</span>
                              {session.authorised_users?.role && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  {session.authorised_users.role}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6 font-mono text-slate-200 font-semibold">
                            {session.authorised_users?.mobile_number || 'Revoked User'}
                          </td>
                          <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">
                            {formatDate(session.login_at)}
                          </td>
                          <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">
                            {session.is_active ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-extrabold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg text-[9px] uppercase tracking-widest">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Active session
                              </span>
                            ) : (
                              formatDate(session.logout_at)
                            )}
                          </td>
                          <td className="py-4 px-6 font-mono text-[11px] text-slate-200 font-semibold">
                            {formatDuration(session.duration_seconds)}
                          </td>
                          <td className="py-4 px-6 text-[11px] text-slate-300 font-normal">
                            <div className="font-mono text-slate-200 font-semibold">{session.ip_address || 'Unknown'}</div>
                            <div className="truncate max-w-[200px] text-slate-400 font-mono text-[10px]" title={session.user_agent}>
                              {session.user_agent || 'Unknown'}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => openInspectModal(session.id)}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                              title="Inspect full session telemetry"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table Footer with Pagination & Page Size */}
                <div className="px-6 py-4 border-t border-white/5 bg-white/[0.01] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs select-none">
                  <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
                    <span>
                      Showing <span className="font-extrabold text-slate-200">{totalCount > 0 ? startIndex + 1 : 0}</span> to{' '}
                      <span className="font-extrabold text-slate-200">{Math.min(startIndex + pageSize, totalCount)}</span> of{' '}
                      <span className="font-extrabold text-slate-200">{totalCount}</span> sessions
                    </span>

                    <div className="flex items-center gap-1.5">
                      <span>Rows:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-slate-200 text-xs outline-none"
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>

                  {totalPages > 1 && (
                    <Pagination
                      currentPage={activePage}
                      totalPages={totalPages}
                      onPageChange={setPage}
                      maxVisible={5}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* ── SESSION INSPECT MODAL ── */}
      <Modal
        isOpen={isInspectModalOpen}
        onClose={closeModal}
        title="Session Integrity & Network Telemetry"
        subtitle={selectedSession ? `Session ID: ${selectedSession.id}` : 'Detailed audit telemetry'}
        size="lg"
      >
        {selectedSession ? (
          <div className="space-y-6 pt-2 text-xs">
            
            {/* Operator Information Header */}
            <div className="p-4 rounded-2xl bg-white/2 border border-white/5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-black text-slate-950 text-xl shadow-md">
                  {selectedSession.authorised_users?.display_name ? selectedSession.authorised_users.display_name[0].toUpperCase() : 'U'}
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-100">
                    {selectedSession.authorised_users?.display_name || 'Revoked / Unknown Operator'}
                  </div>
                  <div className="text-slate-400 font-mono text-[11px] mt-0.5">
                    {selectedSession.authorised_users?.mobile_number || 'No Mobile'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                {selectedSession.authorised_users?.role && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Role: {selectedSession.authorised_users.role}
                  </span>
                )}
                {selectedSession.is_active ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 font-extrabold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Session
                  </span>
                ) : (
                  <span className="text-slate-400 font-bold bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-wider">
                    Terminated
                  </span>
                )}
              </div>
            </div>

            {/* Timestamps & Duration Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Login Timestamp</div>
                <div className="text-slate-200 font-medium text-xs mt-1">{formatDate(selectedSession.login_at)}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{selectedSession.login_at || 'N/A'}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Logout / Expiry</div>
                <div className="text-slate-200 font-medium text-xs mt-1">
                  {selectedSession.is_active ? 'Active Now' : formatDate(selectedSession.logout_at)}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{selectedSession.logout_at || 'In-Progress'}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Elapsed Duration</div>
                <div className="text-amber-400 font-mono font-bold text-xs mt-1">{formatDuration(selectedSession.duration_seconds)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {selectedSession.duration_seconds ? `${selectedSession.duration_seconds} seconds` : 'Ongoing'}
                </div>
              </div>
            </div>

            {/* Network & Device Environment */}
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Origin IP Address</div>
                <div className="text-slate-100 font-mono font-bold text-sm mt-1">{selectedSession.ip_address || 'Unknown / Hidden'}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Full User-Agent String</div>
                  <button
                    type="button"
                    onClick={() => handleCopyUa(selectedSession.user_agent)}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    <span>{copiedUa ? '✓ Copied' : 'Copy String'}</span>
                  </button>
                </div>
                <div className="p-3 rounded-lg bg-black/40 border border-white/5 font-mono text-[11px] text-slate-300 break-all select-all">
                  {selectedSession.user_agent || 'No user agent provided'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/2 border border-white/5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Internal Session Identifier</div>
                <div className="font-mono text-slate-300 text-[11px] mt-1 select-all break-all">{selectedSession.id}</div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-white/10 text-slate-200 hover:bg-white/20 transition-all"
              >
                Close Telemetry
              </button>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400 text-xs">
            Loading session details or session no longer exists.
          </div>
        )}
      </Modal>
    </>
  );
};

export default AuditLog;
