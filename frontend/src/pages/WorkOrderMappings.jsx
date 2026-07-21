import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import Modal from '../components/ui/Modal';
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

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active', 'inactive', 'all'

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    Promise.resolve().then(() => {
      setPage(1);
    });
  }, [searchQuery, statusFilter]);

  const fetchMappings = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getWorkOrderMappings();
      if (response.data?.success) {
        setMappings(response.data.mappings || []);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to fetch work order mappings.');
    } finally {
      setLoading(false);
    }
  };

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
      fetchMappings();
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

  const filteredMappings = mappings.filter(m => {
    const matchesSearch =
      m.work_order_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_user_id?.includes(searchQuery);

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && m.is_active) ||
      (statusFilter === 'inactive' && !m.is_active);

    return matchesSearch && matchesStatus;
  });

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
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Map JE to Work Order
            </button>
          )}
        </div>

        {/* Success Alert */}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="text-emerald-400/70 hover:text-emerald-400">&times;</button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400/70 hover:text-red-400">&times;</button>
          </div>
        )}

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

          <div className="flex gap-2 w-full md:w-auto">
            {['active', 'inactive', 'all'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                  statusFilter === status
                    ? 'bg-white text-black border-white'
                    : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Data Grid */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[10px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                  <th className="px-6 py-4">Work Order No</th>
                  <th className="px-6 py-4">Junior Engineer</th>
                  <th className="px-6 py-4">Zonal Officer</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Assigned At/By</th>
                  <th className="px-6 py-4">Deactivation Info</th>
                  {!isReadOnly && <th className="px-6 py-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan={isReadOnly ? 6 : 7} className="px-6 py-12 text-center text-slate-500">
                      <span className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-amber-500 mr-2" />
                      Loading mappings data...
                    </td>
                  </tr>
                ) : filteredMappings.length === 0 ? (
                  <tr>
                    <td colSpan={isReadOnly ? 6 : 7} className="px-6 py-12 text-center text-slate-500">
                      No work order assignments found.
                    </td>
                  </tr>
                ) : (() => {
                  const currentMappings = filteredMappings.slice((page - 1) * limit, page * limit);

                  return (
                    <>
                      {currentMappings.map((mapping) => (
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
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                mapping.is_active
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
                              }`}
                            >
                              {mapping.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-slate-300 text-[11px]">
                              {new Date(mapping.assigned_at).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              By: {mapping.assigned_by_name}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {!mapping.is_active ? (
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
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
                          {!isReadOnly && (
                            <td className="px-6 py-4 text-right">
                              {mapping.is_active ? (
                                <button
                                  onClick={() => handleOpenDeactivateModal(mapping.id)}
                                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-red-900/30 text-red-400 bg-red-950/10 hover:bg-red-950/20 transition-all"
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <span className="text-slate-600 text-[10px] font-bold">Resolved</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </>
                  );
                })()}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {(() => {
              const totalPages = Math.ceil(filteredMappings.length / limit);
              if (totalPages <= 1) return null;
              return (
                <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Page {page} of {totalPages} ({filteredMappings.length} entries)
                  </span>
                  
                  <div className="flex gap-2">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                    >
                      Prev
                    </button>
                    <button
                      disabled={page === totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-30 transition"
                    >
                      Next
                    </button>
                  </div>
                </div>
              );
            })()}
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
              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Select Junior Engineer (JE)
                </label>
                <select
                  value={selectedJE}
                  onChange={(e) => handleJEChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  required
                >
                  <option value="" className="bg-neutral-900 text-slate-500">Select a JE...</option>
                  {eligibleJEs.map((je) => {
                    const zoName = je.active_zo_user_id 
                      ? (activeProjects.find(p => p.zo_user_id === je.active_zo_user_id)?.zo_user?.display_name || je.active_zo_user_id)
                      : '';
                    return (
                      <option key={je.mobile_number} value={je.mobile_number} className="bg-neutral-900 text-slate-100">
                        {je.display_name} {je.active_zo_user_id ? `[ZO: ${zoName}]` : '[Unmapped]'}
                      </option>
                    );
                  })}
                </select>
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
