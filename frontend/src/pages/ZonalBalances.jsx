import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { getZonalBalances, getZonalLedger, reconcileZonalBalances } from '../api/zoBalancesApi';

const ZonalBalances = () => {
  const { user } = useAuth();
  const isZo = user?.role === 'zo';

  const [balances, setBalances] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 15;

  const [balancesPage, setBalancesPage] = useState(1);
  const balancesLimit = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    Promise.resolve().then(() => {
      setBalancesPage(1);
    });
  }, [searchQuery]);

  const fetchBalances = async () => {
    setLoadingBalances(true);
    try {
      const response = await getZonalBalances();
      if (response.data?.success) {
        // If ZO role, response is a single object or an array with one element
        const fetched = response.data.balances || response.data.balance;
        setBalances(Array.isArray(fetched) ? fetched : fetched ? [fetched] : []);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to fetch available balances.');
    } finally {
      setLoadingBalances(false);
    }
  };

  const fetchLedger = async (targetPage) => {
    setLoadingLedger(true);
    try {
      const response = await getZonalLedger(targetPage, limit);
      if (response.data?.success) {
        setLedger(response.data.ledger || []);
        setTotalCount(response.data.pagination?.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLedger(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchBalances();
      fetchLedger(page);
    });
  }, [page]);

  const handleReconcile = async () => {
    setReconciling(true);
    setReconcileResult(null);
    setSuccess('');
    setError('');
    try {
      const response = await reconcileZonalBalances();
      if (response.data?.success) {
        setSuccess('Zonal balances successfully reconciled with ledger logs.');
        setReconcileResult(response.data.results);
        fetchBalances();
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Reconciliation failed.');
    } finally {
      setReconciling(false);
    }
  };

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <>
        
        {/* Header Section */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Finance & Credit Control</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Zonal Office Credit Control</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5 font-semibold">
              {isZo 
                ? 'Monitor available credit balance and check ledger transaction postings for your Zonal Office.'
                : 'Oversee credit allocations, balances, and transaction ledgers across Zonal Offices.'}
            </p>
          </div>

          {!isZo && (
            <button
              onClick={handleReconcile}
              disabled={reconciling}
              className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase bg-white text-black hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center gap-2"
              title="Refresh and sync zonal balances"
            >
              <svg className={`w-4 h-4 ${reconciling ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
              </svg>
              {reconciling ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>

        {/* Alerts */}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center justify-between">
            <div>
              <span>Zonal balances refreshed successfully.</span>
              {reconcileResult && (
                <div className="text-[10px] text-emerald-400/80 mt-1 font-mono">
                  Checked: {reconcileResult.checked} | Updated: {reconcileResult.corrected}
                </div>
              )}
            </div>
            <button onClick={() => setSuccess('')} className="text-emerald-400/70 hover:text-emerald-400">&times;</button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400/70 hover:text-red-400">&times;</button>
          </div>
        )}

        {/* Zonal Balances Widget / Grid */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Available Zonal Balances</h2>
            {!isZo && balances.length > 0 && (
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  placeholder="Search Zonal Office by name/mobile..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all animate-in fade-in"
                />
              </div>
            )}
          </div>
          
          {loadingBalances ? (
            <div className="py-8 text-center text-xs text-slate-500">
              <span className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-amber-500 mr-2" />
              Loading balances...
            </div>
          ) : balances.length === 0 ? (
            <div className="glass-panel p-8 rounded-3xl text-center text-slate-500 text-xs shadow-lg">
              No balances configured.
            </div>
          ) : isZo ? (
            /* ZO Card view */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass-panel p-6 rounded-3xl glow-border-active shadow-[0_8px_32px_rgba(245,158,11,0.04)] relative overflow-hidden min-h-[140px] flex flex-col justify-between">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <svg className="w-24 h-24 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2" />
                  </svg>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold tracking-widest text-amber-500">Available Limit</span>
                  <div className="text-3xl font-black mt-2 text-slate-100 tracking-tight">
                    ₹{Number(balances[0].available_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mt-4 border-t border-white/5 pt-2">
                  Last updated: {new Date(balances[0].updated_at).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const filteredBalances = balances.filter(b => {
                const matchesSearch =
                  b.zo_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  b.zo_user_id?.includes(searchQuery);
                return matchesSearch;
              });

              if (filteredBalances.length === 0) {
                return (
                  <div className="glass-panel p-8 rounded-3xl text-center text-slate-500 text-xs shadow-lg">
                    No matching Zonal Offices found.
                  </div>
                );
              }

              const sortedBalances = [...filteredBalances].sort((a, b) => {
                let valA, valB;
                if (sortKey === 'balance') {
                  valA = Number(a.available_balance || 0);
                  valB = Number(b.available_balance || 0);
                } else if (sortKey === 'sync') {
                  valA = new Date(a.updated_at || 0).getTime();
                  valB = new Date(b.updated_at || 0).getTime();
                } else {
                  valA = (a.zo_name || a.zo_user_id || '').toLowerCase();
                  valB = (b.zo_name || b.zo_user_id || '').toLowerCase();
                }

                if (valA < valB) return sortAsc ? -1 : 1;
                if (valA > valB) return sortAsc ? 1 : -1;
                return 0;
              });

              const totalBalancesPages = Math.ceil(sortedBalances.length / balancesLimit);
              const currentBalances = sortedBalances.slice((balancesPage - 1) * balancesLimit, balancesPage * balancesLimit);

              const toggleSort = (key) => {
                if (sortKey === key) {
                  setSortAsc(!sortAsc);
                } else {
                  setSortKey(key);
                  setSortAsc(key === 'name'); // default asc for name, desc for others
                }
              };

               const renderSortIcon = (key) => {
                 if (sortKey !== key) return <span className="text-slate-500 dark:text-slate-400 ml-1 opacity-70">↕</span>;
                 return sortAsc ? <span className="text-amber-600 dark:text-amber-400 ml-1 font-bold">▲</span> : <span className="text-amber-600 dark:text-amber-400 ml-1 font-bold">▼</span>;
               };

              return (
                <div className="glass-panel rounded-3xl overflow-hidden shadow-xl border border-white/5">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                        <th className="px-6 py-4 cursor-pointer select-none hover:text-slate-200" onClick={() => toggleSort('name')}>
                          <div className="flex items-center">
                            <span>Zonal Office (User)</span>
                            {renderSortIcon('name')}
                          </div>
                        </th>
                        <th className="px-6 py-4 cursor-pointer select-none hover:text-slate-200" onClick={() => toggleSort('balance')}>
                          <div className="flex items-center">
                            <span>Available Balance</span>
                            {renderSortIcon('balance')}
                          </div>
                        </th>
                        <th className="px-6 py-4 cursor-pointer select-none hover:text-slate-200" onClick={() => toggleSort('sync')}>
                          <div className="flex items-center">
                            <span>Last Sync</span>
                            {renderSortIcon('sync')}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs font-semibold text-slate-300">
                      {currentBalances.map((b) => (
                        <tr key={b.zo_user_id} className="hover:bg-white/2 transition-all">
                          <td className="px-6 py-4">
                            <div className="text-slate-200">{b.zo_name || b.zo_user_id}</div>
                            <div className="text-[10px] text-slate-500 font-normal">{b.zo_user_id}</div>
                          </td>
                          <td className="px-6 py-4 text-base font-extrabold text-amber-500">
                            ₹{Number(b.available_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-[10px] font-normal text-slate-500">
                            {new Date(b.updated_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Balances Pagination controls */}
                  {totalBalancesPages > 1 && (
                    <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                        Page {balancesPage} of {totalBalancesPages} ({filteredBalances.length} entries)
                      </span>
                      
                      <div className="flex gap-2">
                        <button
                          disabled={balancesPage === 1}
                          onClick={() => setBalancesPage(p => Math.max(1, p - 1))}
                          className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                        >
                          Prev
                        </button>
                        <button
                          disabled={balancesPage === totalBalancesPages}
                          onClick={() => setBalancesPage(p => Math.min(totalBalancesPages, p + 1))}
                          className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>

        {/* Zonal Fund Ledger Tab */}
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Transaction Ledger Logs</h2>
          
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                    <th className="px-6 py-4">Date</th>
                    {!isZo && <th className="px-6 py-4">Zonal Office</th>
                    }<th className="px-6 py-4">Transaction Details</th>
                    <th className="px-6 py-4">Reference</th>
                    <th className="px-6 py-4">Work Order</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
                  {loadingLedger && page === 1 ? (
                    <tr>
                      <td colSpan={isZo ? 5 : 6} className="px-6 py-12 text-center text-slate-500">
                        <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-amber-500 mr-2" />
                        Loading ledger logs...
                      </td>
                    </tr>
                  ) : ledger.length === 0 ? (
                    <tr>
                      <td colSpan={isZo ? 5 : 6} className="px-6 py-12 text-center text-slate-500">
                        No transactions recorded in the ledger logs.
                      </td>
                    </tr>
                  ) : (
                    ledger.map((log) => {
                      const isCredit = Number(log.amount) > 0;
                      return (
                        <tr key={log.ledger_id} className="hover:bg-white/2 transition-colors">
                          <td className="px-6 py-4 text-[10px] text-slate-500 font-normal">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          {!isZo && (
                            <td className="px-6 py-4 font-semibold text-slate-200">
                              {log.zo_name || log.zo_user_id}
                            </td>
                          )}
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-200 tracking-wide text-[11px]">{log.transaction_type}</span>
                            <div className="text-[10px] text-slate-500 font-normal">By: {log.created_by_name || log.created_by}</div>
                          </td>
                          <td className="px-6 py-4 text-[10px] text-slate-400">
                            <span className="font-semibold block">{log.reference_type}</span>
                            <span className="font-mono text-[9px] text-slate-500">{log.reference_id}</span>
                          </td>
                          <td className="px-6 py-4 font-semibold text-slate-300">
                            {log.work_order_no || <span className="text-slate-600">-</span>}
                          </td>
                          <td className={`px-6 py-4 text-right font-extrabold text-sm ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isCredit ? '+' : ''}₹{Number(log.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Page {page} of {totalPages} ({totalCount} entries)
                </span>
                
                <div className="flex gap-2">
                  <button
                    disabled={page === 1 || loadingLedger}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                  >
                    Prev
                  </button>
                  <button
                    disabled={page === totalPages || loadingLedger}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  );
};

export default ZonalBalances;
