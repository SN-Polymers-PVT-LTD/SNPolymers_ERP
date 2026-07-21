import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import Modal from '../components/ui/Modal';
import { getUserMappings, createUserMapping, getEligibleJEs, getEligibleZOs } from '../api/userMappingsApi';

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

  // Table filters
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
      const response = await getUserMappings();
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

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchMappings();
      fetchDropdownOptions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenModal = () => {
    setModalError('');
    setSelectedJE('');
    setSelectedZO('');
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

  // Filter and search mappings list
  const filteredMappings = mappings.filter(m => {
    const matchesSearch =
      m.je_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.je_user_id?.includes(searchQuery) ||
      m.zo_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.zo_user_id?.includes(searchQuery);

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
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Assign / Transfer JE
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
              placeholder="Search JEs or ZOs by name/mobile..."
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
                  <th className="px-6 py-4">Junior Engineer</th>
                  <th className="px-6 py-4">Zonal Office</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Assigned At</th>
                  <th className="px-6 py-4">Assigned By</th>
                  <th className="px-6 py-4">Deactivation Info</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                      <span className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-amber-500 mr-2" />
                      Loading mappings data...
                    </td>
                  </tr>
                ) : filteredMappings.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                      No user mappings found matching the criteria.
                    </td>
                  </tr>
                ) : (() => {
                  const currentMappings = filteredMappings.slice((page - 1) * limit, page * limit);

                  return (
                    <>
                      {currentMappings.map((mapping) => (
                        <tr key={mapping.id} className="hover:bg-white/2 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-100">{mapping.je_name}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-100">{mapping.zo_name}</div>
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
                          <td className="px-6 py-4 text-[11px] text-slate-400">
                            {new Date(mapping.assigned_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-slate-300">{mapping.assigned_by_name}</div>
                          </td>
                          <td className="px-6 py-4">
                            {!mapping.is_active ? (
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
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
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
              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Select Junior Engineer (JE)
                </label>
                <select
                  value={selectedJE}
                  onChange={(e) => setSelectedJE(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  required
                >
                  <option value="" className="bg-neutral-900 text-slate-500">Select a JE...</option>
                  {eligibleJEs.map((je) => {
                    const mappedZo = mappingMapToZoName(je.active_zo_user_id);
                    return (
                      <option key={je.mobile_number} value={je.mobile_number} className="bg-neutral-900 text-slate-100">
                        {je.display_name} {mappedZo ? `[Current: ${mappedZo}]` : '[Unmapped]'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Select Owning Zonal Office (ZO)
                </label>
                <select
                  value={selectedZO}
                  onChange={(e) => setSelectedZO(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  required
                >
                  <option value="" className="bg-neutral-900 text-slate-500">Select a Zonal Office...</option>
                  {eligibleZOs.map((zo) => (
                    <option key={zo.mobile_number} value={zo.mobile_number} className="bg-neutral-900 text-slate-100">
                      {zo.display_name}
                    </option>
                  ))}
                </select>
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
