import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import Modal from '../components/ui/Modal';
import { SkeletonTable, Pagination, SuccessPopup, ErrorPopup } from '../components/ui';
import { getWorkOrderMappings, createWorkOrderMapping, deactivateWorkOrderMapping } from '../api/workOrderMappingsApi';
import { getEligibleJEs } from '../api/userMappingsApi';
import { getProjects } from '../api/projectsApi';

const WorkOrderMappings = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === 'zo';

  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dropdown list options
  const [eligibleJEs, setEligibleJEs] = useState([]);
  const [activeProjects, setActiveProjects] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Map JE Modal State
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedWO, setSelectedWO] = useState('');
  const [selectedJE, setSelectedJE] = useState('');
  const [submittingMap, setSubmittingMap] = useState(false);
  const [mapError, setMapError] = useState('');

  // Deactivate Modal State
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('Removed');
  const [submittingDeactivate, setSubmittingDeactivate] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  // Active Assignments / History tabs - separate mental models, not a filter toggle
  // on one flat table (deactivated rows are audit history, not "just another status").
  const [activeTab, setActiveTab] = useState('active'); // 'active', 'history'
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination (server-side) & JE Search
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [jeSearch, setJeSearch] = useState('');

  useEffect(() => {
    Promise.resolve().then(() => {
      setPage(1);
    });
  }, [searchQuery, activeTab, pageSize]);

  const fetchMappings = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getWorkOrderMappings({
        status: activeTab === 'history' ? 'inactive' : 'active',
        sort: activeTab === 'history' ? 'deactivated_at' : 'assigned_at',
        page,
        pageSize
      });
      if (response.data?.success) {
        setMappings(response.data.mappings || []);
        setTotal(response.data.total ?? (response.data.mappings || []).length);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to fetch work order mappings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, page, pageSize]);

  const fetchDropdownOptions = async () => {
    if (isReadOnly) return;
    setLoadingOptions(true);
    try {
      const [jeRes, projRes] = await Promise.all([getEligibleJEs(), getProjects()]);
      if (jeRes.data?.success) setEligibleJEs(jeRes.data.jes || []);

      // Filter to non-closed projects for mapping
      if (projRes.data?.success) {
        const allProj = projRes.data.projects || [];
        setActiveProjects(allProj.filter(p => p.status !== 'Closed'));
      }
    } catch (err) {
      console.error('Failed to load work order mapping choices:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchDropdownOptions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenMapModal = () => {
    setMapError('');
    setSelectedWO('');
    setSelectedJE('');
    setShowMapModal(true);
  };

  const handleJEChange = (jeMobileNumber) => {
    setSelectedJE(jeMobileNumber);
    setSelectedWO(''); // reset selected workorder when JE changes
  };

  const selectedJeObj = eligibleJEs.find(j => j.mobile_number === selectedJE);
  const selectedJeZoId = selectedJeObj?.active_zo_user_id;

  const filteredProjectsForSelect = activeProjects.filter(p => {
    if (!selectedJE) return false;
    return p.zo_user_id === selectedJeZoId;
  });

  // Perform Client-Side Consistency Check
  const getZonalConsistencyDetails = () => {
    if (!selectedWO || !selectedJE) return { isConsistent: true, errorMsg: '' };

    const project = activeProjects.find(p => p.work_order_no === selectedWO);
    const je = eligibleJEs.find(j => j.mobile_number === selectedJE);

    if (!project) return { isConsistent: false, errorMsg: 'Selected Work Order not found.' };
    if (!je) return { isConsistent: false, errorMsg: 'Selected Junior Engineer not found.' };

    if (!project.zo_user_id) {
      return { isConsistent: false, errorMsg: 'Work Order has no assigned owning Zonal Office.' };
    }

    if (!je.active_zo_user_id) {
      return {
        isConsistent: false,
        errorMsg: 'Junior Engineer must have an active Zonal Office mapping before they can be assigned.'
      };
    }

    if (je.active_zo_user_id !== project.zo_user_id) {
      return {
        isConsistent: false,
        errorMsg: `Mismatched ZO assignment. Junior Engineer belongs to ZO (${je.active_zo_user_id}), but Work Order belongs to ZO (${project.zo_user_id}).`
      };
    }

    return { isConsistent: true, errorMsg: '' };
  };

  const { isConsistent, errorMsg: consistencyError } = getZonalConsistencyDetails();

  const handleCreateMapping = async (e) => {
    e.preventDefault();
    setMapError('');
    setSuccess('');

    if (!isConsistent) {
      setMapError(consistencyError);
      return;
    }

    setSubmittingMap(true);
    try {
      const response = await createWorkOrderMapping({
        work_order_no: selectedWO,
        je_mobile_number: selectedJE
      });

      if (response.data?.success) {
        setSuccess(response.data.message || 'JE successfully assigned to Work Order.');
        setShowMapModal(false);
        fetchMappings();
      }
    } catch (err) {
      console.error(err);
      setMapError(err.response?.data?.message || 'Failed to assign JE to Work Order.');
    } finally {
      setSubmittingMap(false);
    }
  };

  const handleOpenDeactivateModal = (id) => {
    setDeactivateError('');
    setDeactivateReason('Removed');
    setDeactivatingId(id);
    setShowDeactivateModal(true);
  };

  const handleDeactivate = async (e) => {
    e.preventDefault();
    setDeactivateError('');
    setSuccess('');

    if (!deactivatingId) return;

    setSubmittingDeactivate(true);
    try {
      const response = await deactivateWorkOrderMapping(deactivatingId, deactivateReason);
      if (response.data?.success) {
        setSuccess(response.data.message || 'Work Order assignment deactivated.');
        setShowDeactivateModal(false);
        fetchMappings();
      }
    } catch (err) {
      console.error(err);
      setDeactivateError(err.response?.data?.message || 'Failed to deactivate assignment.');
    } finally {
      setSubmittingDeactivate(false);
    }
  };

  // Search filters within the current server-fetched page/tab (status/sort/paging
  // are handled server-side - see fetchMappings above).
  const filteredMappings = mappings.filter(m => {
    return (
      m.work_order_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_user_id?.includes(searchQuery)
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

  const [jePage, setJePage] = useState(1);
  const jeLimit = 5;
  const jeTotalPages = Math.ceil(filteredEligibleJEs.length / jeLimit) || 1;
  const paginatedEligibleJEs = filteredEligibleJEs.slice((jePage - 1) * jeLimit, jePage * jeLimit);

  return (
    <>

      {/* Header Section */}
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">System Configurations</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Work Order Mappings</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            {isReadOnly
              ? 'Active assignments of JEs to mapped projects within your Zonal Office.'
              : 'Map Junior Engineers to specific active Work Orders.'}
          </p>
        </div>

        {!isReadOnly && (
          <button
            onClick={handleOpenMapModal}
            className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all duration-300 flex items-center gap-2"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Map JE to Work Order
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
            placeholder="Search by Work Order, JE Name/Mobile..."
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
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${activeTab === tab.key
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

      {/* Data Grid: Active tab is actionable (no Deactivation Info column, has Actions);
          History tab is read-only audit trail (no Actions column, has Deactivation Info). */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                <th className="px-6 py-4">Work Order No</th>
                <th className="px-6 py-4">Junior Engineer</th>
                <th className="px-6 py-4">Zonal Officer</th>
                <th className="px-6 py-4">Assigned At/By</th>
                {activeTab === 'history' && <th className="px-6 py-4">Deactivation Info</th>}
                {activeTab === 'active' && !isReadOnly && <th className="px-6 py-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
              {(() => {
                const colCount = 4 + (activeTab === 'history' ? 1 : 0) + (activeTab === 'active' && !isReadOnly ? 1 : 0);
                if (loading) {
                  return (
                    <tr>
                      <td colSpan={colCount} className="p-0">
                        <SkeletonTable rows={5} cols={colCount} />
                      </td>
                    </tr>
                  );
                }
                if (filteredMappings.length === 0) {
                  return (
                    <tr>
                      <td colSpan={colCount} className="px-6 py-12 text-center text-slate-500">
                        {activeTab === 'history' ? 'No deactivated assignments found.' : 'No active work order assignments found.'}
                      </td>
                    </tr>
                  );
                }
                return filteredMappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-100">
                      {mapping.work_order_no}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-100">{mapping.je_name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-100">{mapping.zo_name || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-300 text-[11px]">
                        {new Date(mapping.assigned_at).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        By: {mapping.assigned_by_name}
                      </div>
                    </td>
                    {activeTab === 'history' && (
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-slate-400 text-[11px]">
                            Reason: <span className="font-bold text-amber-500/90">{mapping.reason}</span>
                          </div>
                          <div className="text-slate-500 text-[10px]">
                            On: {new Date(mapping.deactivated_at).toLocaleString()}
                          </div>
                          <div className="text-slate-500 text-[10px]">
                            By: {mapping.deactivated_by_name}
                          </div>
                        </div>
                      </td>
                    )}
                    {activeTab === 'active' && !isReadOnly && (
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleOpenDeactivateModal(mapping.id)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-red-900/30 text-red-400 bg-red-950/10 hover:bg-red-950/20 transition-all"
                        >
                          Deactivate
                        </button>
                      </td>
                    )}
                  </tr>
                ));
              })()}
            </tbody>
          </table>

          {/* Pagination Controls (server-side - see fetchMappings) */}
          <Pagination
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            onPageChange={setPage}
            maxVisible={5}
          />
        </div>
      </div>

      {/* Map JE Modal */}
      <Modal
        isOpen={showMapModal}
        onClose={() => setShowMapModal(false)}
        title="Map JE to Work Order"
        subtitle="Work Order Allocations"
        size="md"
      >
        <form onSubmit={handleCreateMapping} className="space-y-6">
          {mapError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold leading-relaxed">
              <span className="block font-bold mb-1">Mapping Rejected</span>
              {mapError}
            </div>
          )}

          {/* Real-time Client-side validation message */}
          {selectedJE && selectedWO && !isConsistent && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold leading-relaxed">
              <span className="block font-bold mb-1">Zonal Consistency Check Failure</span>
              {consistencyError}
            </div>
          )}

          {loadingOptions ? (
            <div className="py-8 text-center text-xs text-slate-500">
              <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-amber-500 mr-2" />
              Loading choices...
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
                  placeholder="Filter JE by name, mobile, or ZO..."
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
                      const zoName = je.active_zo_user_id
                        ? (activeProjects.find(p => p.zo_user_id === je.active_zo_user_id)?.zo_user?.display_name || je.active_zo_user_id)
                        : null;

                      return (
                        <div
                          key={je.mobile_number}
                          onClick={() => handleJEChange(je.mobile_number)}
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
                            {zoName ? (
                              <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">
                                ZO: {zoName}
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
                  <div className="flex items-center justify-between pt-2 text-xs">
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

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Select Work Order
                </label>
                <select
                  value={selectedWO}
                  onChange={(e) => setSelectedWO(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedJE}
                  required
                >
                  {!selectedJE ? (
                    <option value="" className="bg-neutral-900 text-slate-500">Please select a JE first...</option>
                  ) : (
                    <>
                      <option value="" className="bg-neutral-900 text-slate-500">Select a project...</option>
                      {filteredProjectsForSelect.map((p) => (
                        <option key={p.work_order_no} value={p.work_order_no} className="bg-neutral-900 text-slate-100">
                          {p.work_order_no}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setShowMapModal(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
              disabled={submittingMap}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 transition"
              disabled={submittingMap || loadingOptions || !isConsistent}
            >
              {submittingMap ? 'Processing...' : 'Assign to Work Order'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Deactivate Assignment Modal */}
      <Modal
        isOpen={showDeactivateModal}
        onClose={() => setShowDeactivateModal(false)}
        title="Deactivate Work Order Mapping"
        subtitle="Work Order Allocations"
        size="sm"
      >
        <form onSubmit={handleDeactivate} className="space-y-6">
          {deactivateError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold leading-relaxed">
              {deactivateError}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
              Select Deactivation Reason
            </label>
            <select
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
              required
            >
              <option value="Removed" className="bg-neutral-900 text-slate-100">Removed (Manual De-allocation)</option>
              <option value="Project Closed" className="bg-neutral-900 text-slate-100">Project Closed</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1 leading-normal">
              *Note: Transfers are automatically processed via user mapping transfers.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setShowDeactivateModal(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
              disabled={submittingDeactivate}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-red-600 text-white hover:bg-red-500 transition"
              disabled={submittingDeactivate}
            >
              {submittingDeactivate ? 'Processing...' : 'Confirm Deactivation'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export default WorkOrderMappings;
