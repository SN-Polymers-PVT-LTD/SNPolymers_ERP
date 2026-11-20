import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLog } from '../api/analyticsApi';
import { exportAuditLogToExcel } from '../utils/exportHelpers';
import { useAuditComplianceUrlState } from '../hooks/useAuditComplianceUrlState';

const MODULES = [
  'Project Management',
  'Daily Work Progress',
  'Fund Requests',
  'Requisitions',
  'RA & Final Bills',
  'User Mappings',
  'Work Order Mappings',
  'Excess Returns',
  'Zonal Balances',
  'Material Master'
];

const AuditComplianceCenter = () => {
  const {
    moduleName: urlModule,
    userId: urlUser,
    recordId: urlRecord,
    page,
    applyFilters,
    setPage,
    resetFilters
  } = useAuditComplianceUrlState();

  const [userId, setUserId] = useState(urlUser);
  const [moduleName, setModuleName] = useState(urlModule);
  const [recordId, setRecordId] = useState(urlRecord);
  const [expandedRows, setExpandedRows] = useState({});

  useEffect(() => {
    setUserId(urlUser);
    setModuleName(urlModule);
    setRecordId(urlRecord);
  }, [urlUser, urlModule, urlRecord]);

  // Query to fetch paginated logs
  const { data: auditRes, isLoading, isError } = useQuery({
    queryKey: ['auditLogs', urlUser, urlModule, urlRecord, page],
    queryFn: async () => {
      const res = await getAuditLog({
        user_id: urlUser || undefined,
        module_name: urlModule || undefined,
        record_identifier: urlRecord || undefined,
        page,
        limit: 50
      });
      return res.data;
    },
    staleTime: 60 * 1000
  });

  const logs = auditRes?.data || [];
  const totalCount = auditRes?.totalCount || 0;
  const totalPages = auditRes?.totalPages || 1;

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    applyFilters({
      user_id: userId.trim(),
      module_name: moduleName,
      record_identifier: recordId.trim()
    });
  };

  const handleClearFilters = () => {
    setUserId('');
    setModuleName('');
    setRecordId('');
    resetFilters();
  };

  const handlePrevPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  const handleNextPage = () => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  };

  const toggleRowExpand = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExport = () => {
    exportAuditLogToExcel(logs);
  };

  const hasActiveFilters = urlModule || urlUser || urlRecord;

  return (
    <>
      {/* Header Row */}
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Security & Compliance Log</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Audit Search Center</h1>
          <p className="text-xs text-slate-400 mt-1.5">Query and examine historical data edits, access records, and structural state overrides.</p>
        </div>

        <button
          onClick={handleExport}
          disabled={logs.length === 0}
          className={`px-5 py-2.5 rounded-xl border border-white/10 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all duration-300 ${
            logs.length === 0 
              ? 'opacity-40 cursor-not-allowed bg-white/5 text-slate-500' 
              : 'hover:bg-white/10 text-slate-200 cursor-pointer shadow-lg'
          }`}
        >
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Log (.xlsx)
        </button>
      </div>

      {/* Query Filter Toolbar */}
      <div className="glass-panel p-5 rounded-3xl mb-8 border border-white/5">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          
          {/* Module Select */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Module</label>
            <select
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              className="w-full bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition cursor-pointer"
            >
              <option value="">All Functional Modules</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* User ID Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">User Identification</label>
            <input
              type="text"
              placeholder="e.g. ZO_USER_9876543210"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* Record Identifier Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Record Identifier / Key</label>
            <input
              type="text"
              placeholder="e.g. REQ_101 or WO_202"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              className="w-full bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold uppercase tracking-wider text-xs py-2 px-4 rounded-xl transition shadow-lg shadow-amber-500/10 cursor-pointer"
            >
              Filter Ledger
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-4 py-2 border border-white/10 hover:bg-white/5 text-slate-400 hover:text-slate-200 text-xs font-bold uppercase rounded-xl transition cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Main Ledger Feed */}
      {isError ? (
        <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold text-center">
          Failed to load audit compliance records. Please verify connection credentials.
        </div>
      ) : isLoading ? (
        <div className="glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02]" />
      ) : logs.length === 0 ? (
        <div className="glass-panel p-16 rounded-3xl border border-white/5 bg-slate-900/10 text-center flex flex-col items-center justify-center">
          <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">No Audit Records Found</span>
          <p className="text-[11px] text-slate-600 mt-2">Adjust search terms or module filters above.</p>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Audit Table */}
          <div className="glass-panel p-6 rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 pb-3">
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Timestamp</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">User</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Action</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Module</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Identifier</th>
                    <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {logs.map((log) => {
                    const isExpanded = !!expandedRows[log.id];
                    const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : 'N/A';
                    
                    return (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-white/5 transition-colors">
                          <td className="py-4 text-xs font-bold text-slate-400">{dateStr}</td>
                          <td className="py-4">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-200">{log.user_name || 'System'}</span>
                              {log.user_id && <span className="text-[9px] font-mono text-slate-500 mt-0.5">{log.user_id}</span>}
                            </div>
                          </td>
                          <td className="py-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                              log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              log.action === 'EDIT' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                              log.action === 'STATUS_CHANGE' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              'bg-white/5 text-slate-400'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-4 text-xs font-bold text-slate-200">{log.module_name}</td>
                          <td className="py-4 text-xs font-mono text-slate-300 font-extrabold">{log.record_identifier}</td>
                          <td className="py-4 text-right">
                            <button
                              onClick={() => toggleRowExpand(log.id)}
                              className="px-3 py-1 rounded-lg border border-white/10 hover:bg-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 transition"
                            >
                              {isExpanded ? 'Hide' : 'Inspect'}
                            </button>
                          </td>
                        </tr>

                        {/* Collapsible details panel */}
                        {isExpanded && (
                          <tr>
                            <td colSpan="6" className="py-4 px-6 bg-slate-950/40 border-t border-white/5">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                                {/* Old Value */}
                                <div className="space-y-1.5">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">State Before (Old Value)</span>
                                  <pre className="p-4 rounded-xl bg-black border border-white/5 text-[10px] font-mono text-slate-400 overflow-x-auto max-h-[160px] no-scrollbar">
                                    {log.old_value ? JSON.stringify(log.old_value, null, 2) : '// No previous state (CREATE)'}
                                  </pre>
                                </div>
                                {/* New Value */}
                                <div className="space-y-1.5">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">State After (New Value)</span>
                                  <pre className="p-4 rounded-xl bg-black border border-white/5 text-[10px] font-mono text-slate-200 overflow-x-auto max-h-[160px] no-scrollbar">
                                    {log.new_value ? JSON.stringify(log.new_value, null, 2) : '// No changes recorded'}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination controls */}
          <div className="flex justify-between items-center bg-slate-900/30 border border-white/5 rounded-2xl p-4">
            <span className="text-xs text-slate-400 font-bold">
              Showing Page {page} of {totalPages} <span className="text-slate-600">({totalCount} records logged)</span>
            </span>
            
            <div className="flex gap-2">
              <button
                onClick={handlePrevPage}
                disabled={page === 1}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-300 ${
                  page === 1 
                    ? 'border-transparent text-slate-600 cursor-not-allowed' 
                    : 'border-white/10 hover:bg-white/5 text-slate-300'
                }`}
              >
                Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={page === totalPages}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-300 ${
                  page === totalPages 
                    ? 'border-transparent text-slate-600 cursor-not-allowed' 
                    : 'border-white/10 hover:bg-white/5 text-slate-300'
                }`}
              >
                Next
              </button>
            </div>
          </div>

        </div>
      )}
    </>
  );
};

export default AuditComplianceCenter;
