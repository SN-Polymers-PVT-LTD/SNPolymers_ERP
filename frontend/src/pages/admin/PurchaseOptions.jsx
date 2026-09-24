import React, { useState, useEffect, useMemo } from 'react';
import authApi from '../../api/authApi';
import { Modal, SuccessPopup, ErrorPopup } from '../../components/ui';
import { SkeletonTable } from '../../components/ui/Skeleton';
import Pagination from '../../components/ui/Pagination';
import { usePurchaseOptionsUrlState } from '../../hooks/usePurchaseOptionsUrlState';

const PurchaseOptions = () => {
  const [purchaseOptions, setPurchaseOptions] = useState([]);
  const [loadingPurchase, setLoadingPurchase] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    resetFilters,
    showAddModal,
    showEditModal,
    targetId,
    openAddModal,
    openEditModal,
    closeModal
  } = usePurchaseOptionsUrlState();

  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  // Add modal state
  const [newPurchaseName, setNewPurchaseName] = useState('');
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);

  // Edit modal state
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [editPurchaseName, setEditPurchaseName] = useState('');
  const [editPurchaseSubmitting, setEditPurchaseSubmitting] = useState(false);

  const fetchPurchaseOptions = async () => {
    setLoadingPurchase(true);
    setError('');
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

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchPurchaseOptions();
    });
  }, []);

  // Synchronize editingPurchase with URL targetId
  useEffect(() => {
    if (showEditModal && targetId && purchaseOptions.length > 0) {
      const matched = purchaseOptions.find((o) => String(o.id) === String(targetId));
      if (matched && (!editingPurchase || String(editingPurchase.id) !== String(matched.id))) {
        setEditingPurchase(matched);
        setEditPurchaseName(matched.name || '');
      }
    } else if (!showEditModal && editingPurchase) {
      setEditingPurchase(null);
    }
  }, [showEditModal, targetId, purchaseOptions, editingPurchase]);

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
        setSuccess('New purchase option added successfully.');
        closeModal();
        setNewPurchaseName('');
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add purchase option.');
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const handleStartEdit = (option) => {
    setEditingPurchase(option);
    setEditPurchaseName(option.name);
    setError('');
    setSuccess('');
    openEditModal(option.id);
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
      const response = await authApi.patch(`/purchase-data/${editingPurchase.id}`, {
        name: editPurchaseName.trim()
      });

      if (response.data?.success) {
        setSuccess('Purchase option updated successfully.');
        closeModal();
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
      const response = await authApi.patch(`/purchase-data/${option.id}`, {
        is_active: !option.is_active
      });

      if (response.data?.success) {
        setSuccess(`Purchase option "${option.name}" ${!option.is_active ? 'activated' : 'deactivated'}.`);
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update option status.');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Filtered & Paginated Options
  const filteredOptions = useMemo(() => {
    return purchaseOptions.filter((opt) => {
      // 1. Search Query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = (opt.name || '').toLowerCase().includes(q);
        const matchesUser = (opt.created_by || '').toLowerCase().includes(q);
        if (!matchesName && !matchesUser) return false;
      }

      // 2. Status Filter
      if (statusFilter === 'active' && !opt.is_active) return false;
      if (statusFilter === 'inactive' && opt.is_active) return false;

      return true;
    });
  }, [purchaseOptions, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredOptions.length / pageSize) || 1;
  const activePage = Math.min(page, totalPages);
  const startIndex = (activePage - 1) * pageSize;
  const paginatedOptions = filteredOptions.slice(startIndex, startIndex + pageSize);

  const hasActiveFilters = searchQuery || statusFilter !== 'all';

  return (
    <>
      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-full mx-auto w-full relative z-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
                System Configurations
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
                Purchase Options
              </h1>
              <p className="text-xs text-slate-400 font-medium mt-1.5">
                Manage the selectable options available when specifying payment modes or procurement routes.
              </p>
            </div>
            <button
              onClick={openAddModal}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Purchase Option
            </button>
          </div>

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

          {/* ── Search & Filter Controls ── */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-5">
            <div className="relative flex-1 max-w-sm">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search purchase options…"
                value={localSearch}
                onChange={(e) => {
                  setLocalSearch(e.target.value);
                  setSearchQuery(e.target.value);
                }}
                className="w-full glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 font-medium transition"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Status Filter Pills */}
              <div className="flex items-center gap-1 bg-white/[0.02] border border-white/5 p-1 rounded-xl">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Active' },
                  { id: 'inactive', label: 'Inactive' }
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStatusFilter(s.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                      statusFilter === s.id
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Page Size */}
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="glass-input focus:ring-0 outline-none rounded-xl px-3 py-2 text-xs text-slate-300 font-medium transition font-mono"
              >
                <option value="10" className="bg-slate-900 text-slate-100">10 / page</option>
                <option value="25" className="bg-slate-900 text-slate-100">25 / page</option>
                <option value="50" className="bg-slate-900 text-slate-100">50 / page</option>
              </select>

              {/* Reset Filters */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearch('');
                    resetFilters();
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition"
                >
                  Reset
                </button>
              )}

              <button
                onClick={fetchPurchaseOptions}
                title="Refresh"
                className="p-2.5 rounded-xl glass-input hover:border-white/20 transition-all duration-200 text-slate-400 hover:text-slate-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
            {loadingPurchase ? (
              <SkeletonTable rows={5} cols={5} />
            ) : filteredOptions.length === 0 ? (
              <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                {hasActiveFilters
                  ? 'No purchase options match your filter criteria.'
                  : 'No purchase options discovered. Click button above to initialize.'}
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
                    {paginatedOptions.map((option) => (
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
                            onClick={() => handleStartEdit(option)}
                            className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 hover:bg-white/10 px-3 py-1.5 rounded-xl transition-all duration-200"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                <div className="px-6 py-4 border-t border-white/5 bg-white/[0.01] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs select-none">
                  <span className="text-slate-400 font-medium font-mono text-[11px]">
                    Showing <span className="font-extrabold text-slate-200">{filteredOptions.length > 0 ? startIndex + 1 : 0}</span> to <span className="font-extrabold text-slate-200">{Math.min(startIndex + pageSize, filteredOptions.length)}</span> of <span className="font-extrabold text-slate-200">{filteredOptions.length}</span> options
                  </span>
                  {totalPages > 1 && (
                    <Pagination
                      currentPage={activePage}
                      totalPages={totalPages}
                      onPageChange={setPage}
                      maxVisible={5}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── ADD PURCHASE DATA OPTION MODAL ── */}
          <Modal
            isOpen={showAddModal}
            onClose={closeModal}
            title="Add Purchase Option"
            subtitle="Console System Policies"
          >
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
                  onClick={closeModal}
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
                  {purchaseSubmitting ? 'Adding...' : 'Add Option'}
                </button>
              </div>
            </form>
          </Modal>

          {/* ── EDIT PURCHASE DATA OPTION MODAL ── */}
          <Modal
            isOpen={showEditModal && !!editingPurchase}
            onClose={closeModal}
            title="Edit Purchase Option"
            subtitle="Console System Policies"
          >
            {editingPurchase && (
              <form onSubmit={handleEditPurchaseOption} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Option Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Local Market"
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
                    onClick={closeModal}
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
            )}
          </Modal>
        </main>
      </div>
    </>
  );
};

export default PurchaseOptions;
