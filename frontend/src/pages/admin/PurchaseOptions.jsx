import React, { useState, useEffect } from 'react';
import authApi from '../../api/authApi';
import BackgroundShapes from '../../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import Modal from '../../components/ui/Modal';

const PurchaseOptions = () => {
  const [purchaseOptions, setPurchaseOptions] = useState([]);
  const [loadingPurchase, setLoadingPurchase] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add modal state
  const [showAddPurchaseModal, setShowAddPurchaseModal] = useState(false);
  const [newPurchaseName, setNewPurchaseName] = useState('');
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);

  // Edit modal state
  const [showEditPurchaseModal, setShowEditPurchaseModal] = useState(false);
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
        setSuccess('Purchase option created successfully.');
        setShowAddPurchaseModal(false);
        setNewPurchaseName('');
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create purchase option.');
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  const openEditPurchaseModal = (option) => {
    setEditingPurchase(option);
    setEditPurchaseName(option.name || '');
    setError('');
    setSuccess('');
    setShowEditPurchaseModal(true);
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
      const response = await authApi.put(`/purchase-data/${editingPurchase.id}`, {
        name: editPurchaseName.trim()
      });
      if (response.data?.success) {
        setSuccess('Purchase option updated successfully.');
        setShowEditPurchaseModal(false);
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
      const response = await authApi.patch(`/purchase-data/${option.id}/status`, {
        is_active: !option.is_active
      });
      if (response.data?.success) {
        setSuccess(`Purchase option status updated to ${!option.is_active ? 'Active' : 'Inactive'}.`);
        fetchPurchaseOptions();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle status.');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <>
      {/* Content */}
      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10 font-sans">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Console System Policies</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
              Material Purchase Options
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              Configure material purchase sources available in Phase 2 estimate item selections.
            </p>
          </div>
          <button
            onClick={() => setShowAddPurchaseModal(true)}
            className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Purchase Option
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5 animate-headShake">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loadingPurchase ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : purchaseOptions.length === 0 ? (
            <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
              No purchase options discovered. Click button above to initialize.
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
                  {purchaseOptions.map((option) => (
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
                          onClick={() => openEditPurchaseModal(option)}
                          className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100 hover:bg-white/10 px-3 py-1.5 rounded-xl transition-all duration-200"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── ADD PURCHASE DATA OPTION MODAL ── */}
        <Modal
          isOpen={showAddPurchaseModal}
          onClose={() => setShowAddPurchaseModal(false)}
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
                onClick={() => setShowAddPurchaseModal(false)}
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
          isOpen={showEditPurchaseModal && !!editingPurchase}
          onClose={() => { setShowEditPurchaseModal(false); setEditingPurchase(null); }}
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
                  onClick={() => { setShowEditPurchaseModal(false); setEditingPurchase(null); }}
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
