import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import Modal from '../components/ui/Modal';
import { SkeletonTable, Pagination, SuccessPopup, ErrorPopup } from '../components/ui';
import { getUserMappings, createUserMapping, deactivateUserMapping, getEligibleJEs, getEligibleZOs } from '../api/userMappingsApi';

const UserMappings = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === 'zo';

  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dropdown options
  const [eligibleJEs, setEligibleJEs] = useState([]);
  const [eligibleZOs, setEligibleZOs] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedJE, setSelectedJE] = useState('');
  const [selectedZO, setSelectedZO] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Active Assignments / History tabs - separate mental models, not a filter toggle
  // on one flat table (deactivated rows are audit history, not "just another status").
  const [activeTab, setActiveTab] = useState('active'); // 'active', 'history'
  const [searchQuery, setSearchQuery] = useState('');

  // Unmap (deactivate without transfer) modal state
  const [showUnmapModal, setShowUnmapModal] = useState(false);
  const [unmappingId, setUnmappingId] = useState(null);
  const [submittingUnmap, setSubmittingUnmap] = useState(false);
  const [unmapError, setUnmapError] = useState('');

  // Pagination & Modal JE Search
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jeSearch, setJeSearch] = useState('');
  const [jePage, setJePage] = useState(1);
  const jeLimit = 5;

  useEffect(() => {
    Promise.resolve().then(() => {
      setPage(1);
    });
  }, [searchQuery, activeTab, pageSize]);

  const fetchMappings = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getUserMappings({
        status: activeTab === 'history' ? 'inactive' : 'active',
        sort: activeTab === 'history' ? 'deactivated_at' : 'assigned_at'
      });
      if (response.data?.success) {
        setMappings(response.data.mappings || []);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to fetch user mappings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchDropdownOptions = async () => {
    if (isReadOnly) return;
    setLoadingOptions(true);
    try {
      const [jeRes, zoRes] = await Promise.all([getEligibleJEs(), getEligibleZOs()]);
      if (jeRes.data?.success) setEligibleJEs(jeRes.data.jes || []);
      if (zoRes.data?.success) setEligibleZOs(zoRes.data.zos || []);
    } catch (err) {
      console.error('Failed to load dropdown options:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const [zoSearch, setZoSearch] = useState('');
  const [zoPage, setZoPage] = useState(1);
  const zoLimit = 5;

  const filteredEligibleZOs = eligibleZOs.filter(z => {
    const q = zoSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      z.display_name?.toLowerCase().includes(q) ||
      z.mobile_number?.includes(q)
    );
  });

  const zoTotalPages = Math.ceil(filteredEligibleZOs.length / zoLimit) || 1;
  const paginatedEligibleZOs = filteredEligibleZOs.slice((zoPage - 1) * zoLimit, zoPage * zoLimit);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchDropdownOptions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenModal = () => {
    setModalError('');
    setSelectedJE('');
    setSelectedZO('');
    setJeSearch('');
    setJePage(1);
    setZoSearch('');
    setZoPage(1);
    setShowModal(true);
  };

  const handleCreateMapping = async (e) => {
    e.preventDefault();
    setModalError('');
    setSuccess('');

    if (!selectedJE || !selectedZO) {
      setModalError('Both Junior Engineer and Zonal Office selections are required.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await createUserMapping({
        je_mobile_number: selectedJE,
        zo_mobile_number: selectedZO
      });

      if (response.data?.success) {
        setSuccess(response.data.message || 'JE successfully mapped.');
        setShowModal(false);
        fetchMappings();
        // Refresh JEs to update their current ZO mappings
        fetchDropdownOptions();
      }
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.message || 'Failed to create user mapping.';
      setModalError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenUnmapModal = (id) => {
    setUnmapError('');
    setUnmappingId(id);
    setShowUnmapModal(true);
  };

  const handleUnmap = async (e) => {
    e.preventDefault();
    setUnmapError('');
    setSuccess('');

    if (!unmappingId) return;

    setSubmittingUnmap(true);
    try {
      const response = await deactivateUserMapping(unmappingId);
      if (response.data?.success) {
        setSuccess(response.data.message || 'Junior Engineer unmapped.');
        setShowUnmapModal(false);
        fetchMappings();
        fetchDropdownOptions();
      }
    } catch (err) {
      console.error(err);
      setUnmapError(err.response?.data?.message || 'Failed to unmap Junior Engineer.');
    } finally {
      setSubmittingUnmap(false);
    }
  };

  // Search filters within the current server-fetched tab (status/sort handled
  // server-side - see fetchMappings above).
  const filteredMappings = mappings.filter(m => {
    return (
      m.je_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_user_id?.includes(searchQuery) ||
      m.zo_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.zo_user_id?.includes(searchQuery)
    );
  });

  const filteredEligibleJEs = eligibleJEs.filter(j => {
    const q = jeSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      j.display_name?.toLowerCase().includes(q) ||
      j.mobile_number?.includes(q) ||
      j.active_zo_user_id?.toLowerCase().includes(q)
    );
  });

  const jeTotalPages = Math.ceil(filteredEligibleJEs.length / jeLimit) || 1;
  const paginatedEligibleJEs = filteredEligibleJEs.slice((jePage - 1) * jeLimit, jePage * jeLimit);

  return (
    <>
        
        {/* Header Section */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">System Configurations</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">JE-to-ZO User Mappings</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              {isReadOnly
                ? 'List of active Junior Engineers mapped to your Zonal Office.'
                : 'Manage and transfer Junior Engineers (JEs) to Zonal Offices (ZOs).'}
            </p>
          </div>
          
          {!isReadOnly && (
            <button
              onClick={handleOpenModal}
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all duration-300 flex items-center gap-2"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Assign / Transfer JE
            </button>
          )}
        </div>

        {/* Global Notifications via Premium Popups */}
        <SuccessPopup
          isOpen={!!success}
          title="Success"
          description={success}
          onClose={() => setSuccess('')}
        />
        <ErrorPopup
          isOpen={!!error}
          title="Error"
          description={error}
          onClose={() => setError('')}
        />

        {/* Filter Controls */}
        <div className="glass-panel p-4 rounded-2xl mb-6 flex flex-col md:flex-row gap-4 items-center justify-between shadow-lg">
          <div className="relative w-full md:w-80">
            <input
              type="text"
              placeholder="Search JEs or ZOs by name/mobile..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Show:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-xl text-xs bg-slate-950/80 border border-white/10 text-slate-300 focus:outline-none focus:border-amber-500/50 font-bold cursor-pointer"
              >
                <option value={5}>5 / pg</option>
                <option value={10}>10 / pg</option>
                <option value={20}>20 / pg</option>
                <option value={50}>50 / pg</option>
              </select>
            </div>

            <div className="flex gap-2">
              {[
                { key: 'active', label: 'Active Assignments' },
                { key: 'history', label: 'History' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    activeTab === tab.key
                      ? 'bg-white text-black border-white'
                      : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Data Grid: Active tab is actionable (no Deactivation Info column, has an
            Unmap action); History tab is read-only audit trail (no action column,
            has Deactivation Info). */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[10px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                  <th className="px-6 py-4">Junior Engineer</th>
                  <th className="px-6 py-4">Zonal Office</th>
                  <th className="px-6 py-4">Assigned At</th>
                  <th className="px-6 py-4">Assigned By</th>
                  {activeTab === 'history' && <th className="px-6 py-4">Deactivation Info</th>}
                  {activeTab === 'active' && !isReadOnly && <th className="px-6 py-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
                {(() => {
                  const colCount = 4 + (activeTab === 'history' ? 1 : 0) + (activeTab === 'active' && !isReadOnly ? 1 : 0);
                  const currentMappings = filteredMappings.slice((page - 1) * pageSize, page * pageSize);

                  if (loading) {
                    return (
                      <tr>
                        <td colSpan={colCount} className="p-0">
                          <SkeletonTable rows={5} cols={colCount} />
                        </td>
                      </tr>
                    );
                  }
                  if (currentMappings.length === 0) {
                    return (
                      <tr>
                        <td colSpan={colCount} className="px-6 py-12 text-center text-slate-500">
                          {activeTab === 'history' ? 'No deactivated mappings found.' : 'No active user mappings found.'}
                        </td>
                      </tr>
                    );
                  }
                  return currentMappings.map((mapping) => (
                    <tr key={mapping.id} className="hover:bg-white/2 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-100">{mapping.je_name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-100">{mapping.zo_name}</div>
                      </td>
                      <td className="px-6 py-4 text-[11px] text-slate-400">
                        {new Date(mapping.assigned_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-slate-300">{mapping.assigned_by_name}</div>
                      </td>
                      {activeTab === 'history' && (
                        <td className="px-6 py-4">
                          <div>
                            <div className="text-slate-400 text-[11px]">
                              Deactivated: {new Date(mapping.deactivated_at).toLocaleString()}
                            </div>
                            <div className="text-slate-500 text-[10px]">
                              By:{' '}
                              {mapping.deactivated_by_name ? (
                                mapping.deactivated_by_name
                              ) : (
                                <span className="text-amber-500/80 font-semibold">Auto (Project Inactive)</span>
                              )}
                            </div>
                          </div>
                        </td>
                      )}
                      {activeTab === 'active' && !isReadOnly && (
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleOpenUnmapModal(mapping.id)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-red-900/30 text-red-400 bg-red-950/10 hover:bg-red-950/20 transition-all"
                          >
                            Unmap
                          </button>
                        </td>
                      )}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {(() => {
              const totalPages = Math.ceil(filteredMappings.length / pageSize);
              return <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} maxVisible={5} />;
            })()}
          </div>
        </div>

      {/* Assign / Transfer Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Assign / Transfer Junior Engineer"
        subtitle="Zonal Administration Settings"
        size="md"
      >
        <form onSubmit={handleCreateMapping} className="space-y-6">
          {modalError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold leading-relaxed">
              <span className="block font-bold mb-1">Transfer Blocked</span>
              {modalError}
            </div>
          )}

          {loadingOptions ? (
            <div className="py-8 text-center text-xs text-slate-500">
              <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-amber-500 mr-2" />
              Loading eligible users...
            </div>
          ) : (
            <>
              {/* Paginated Junior Engineer Selection */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Select Junior Engineer (JE)
                  </label>
                  <span className="text-[10px] text-amber-400 font-extrabold font-mono">
                    {filteredEligibleJEs.length} JEs Found
                  </span>
                </div>

                <input
                  type="text"
                  placeholder="Search JE by name or mobile..."
                  value={jeSearch}
                  onChange={(e) => {
                    setJeSearch(e.target.value);
                    setJePage(1);
                  }}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                />

                {/* JE Cards List */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {paginatedEligibleJEs.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-xs italic bg-white/2 rounded-xl border border-white/5">
                      No Junior Engineers found matching search.
                    </div>
                  ) : (
                    paginatedEligibleJEs.map((je) => {
                      const isSelected = selectedJE === je.mobile_number;
                      const mappedZo = mappingMapToZoName(je.active_zo_user_id);

                      return (
                        <div
                          key={je.mobile_number}
                          onClick={() => setSelectedJE(je.mobile_number)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500 text-slate-100 shadow-md shadow-amber-500/10'
                              : 'bg-white/2 border-white/5 hover:border-white/20 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                              isSelected ? 'border-amber-400 bg-amber-500' : 'border-white/30'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                            </div>
                            <div className="text-left">
                              <div className="text-xs font-bold text-slate-100">{je.display_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{je.mobile_number}</div>
                            </div>
                          </div>

                          <div>
                            {mappedZo ? (
                              <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">
                                Current: {mappedZo}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                                Unmapped
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* JE Modal Pagination Footer */}
                {jeTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 text-xs select-none">
                    <span className="text-[10px] text-slate-400 font-bold">
                      Page {jePage} of {jeTotalPages} ({filteredEligibleJEs.length} total)
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={jePage === 1}
                        onClick={() => setJePage(p => Math.max(1, p - 1))}
                        className="px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-slate-300 hover:bg-white/5 disabled:opacity-30 cursor-pointer"
                      >
                        ‹ Prev
                      </button>
                      <button
                        type="button"
                        disabled={jePage === jeTotalPages}
                        onClick={() => setJePage(p => Math.min(jeTotalPages, p + 1))}
                        className="px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-slate-300 hover:bg-white/5 disabled:opacity-30 cursor-pointer"
                      >
                        Next ›
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Paginated Zonal Office Selection */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Select Owning Zonal Office (ZO)
                  </label>
                  <span className="text-[10px] text-amber-400 font-extrabold font-mono">
                    {filteredEligibleZOs.length} ZOs Found
                  </span>
                </div>

                <input
                  type="text"
                  placeholder="Search ZO by name or mobile..."
                  value={zoSearch}
                  onChange={(e) => {
                    setZoSearch(e.target.value);
                    setZoPage(1);
                  }}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                />

                {/* ZO Cards List */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {paginatedEligibleZOs.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-xs italic bg-white/2 rounded-xl border border-white/5">
                      No Zonal Offices found matching search.
                    </div>
                  ) : (
                    paginatedEligibleZOs.map((zo) => {
                      const isSelected = selectedZO === zo.mobile_number;

                      return (
                        <div
                          key={zo.mobile_number}
                          onClick={() => setSelectedZO(zo.mobile_number)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500 text-slate-100 shadow-md shadow-amber-500/10'
                              : 'bg-white/2 border-white/5 hover:border-white/20 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                              isSelected ? 'border-amber-400 bg-amber-500' : 'border-white/30'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                            </div>
                            <div className="text-left">
                              <div className="text-xs font-bold text-slate-100">{zo.display_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{zo.mobile_number}</div>
                            </div>
                          </div>

                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            Zonal Office
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* ZO Modal Pagination Footer */}
                {zoTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 text-xs select-none">
                    <span className="text-[10px] text-slate-400 font-bold">
                      Page {zoPage} of {zoTotalPages} ({filteredEligibleZOs.length} total)
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={zoPage === 1}
                        onClick={() => setZoPage(p => Math.max(1, p - 1))}
                        className="px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-slate-300 hover:bg-white/5 disabled:opacity-30 cursor-pointer"
                      >
                        ‹ Prev
                      </button>
                      <button
                        type="button"
                        disabled={zoPage === zoTotalPages}
                        onClick={() => setZoPage(p => Math.min(zoTotalPages, p + 1))}
                        className="px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-bold uppercase text-slate-300 hover:bg-white/5 disabled:opacity-30 cursor-pointer"
                      >
                        Next ›
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 transition"
              disabled={submitting || loadingOptions}
            >
              {submitting ? 'Processing...' : 'Confirm Assignment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Unmap Confirmation Modal - removes a JE from a ZO without requiring an
          immediate replacement (previously only possible implicitly via transfer). */}
      <Modal
        isOpen={showUnmapModal}
        onClose={() => setShowUnmapModal(false)}
        title="Unmap Junior Engineer"
        subtitle="Zonal Administration Settings"
        size="sm"
      >
        <form onSubmit={handleUnmap} className="space-y-6">
          {unmapError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold leading-relaxed">
              {unmapError}
            </div>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            This removes the Junior Engineer's Zonal Office assignment without assigning a
            replacement. They will not be able to receive new Work Order mappings until
            re-assigned.
          </p>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setShowUnmapModal(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
              disabled={submittingUnmap}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-red-600 text-white hover:bg-red-500 transition"
              disabled={submittingUnmap}
            >
              {submittingUnmap ? 'Processing...' : 'Confirm Unmap'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );

  // Helper function to resolve mapping active ZO label
  function mappingMapToZoName(zoUserId) {
    if (!zoUserId) return '';
    const zoOption = eligibleZOs.find(z => z.mobile_number === zoUserId);
    if (zoOption) return zoOption.display_name;
    
    // Fallback search inside active mapping records
    const mapping = mappings.find(m => m.zo_user_id === zoUserId && m.is_active);
    return mapping ? mapping.zo_name : zoUserId;
  }
};

export default UserMappings;
