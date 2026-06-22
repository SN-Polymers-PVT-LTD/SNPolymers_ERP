import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';

// Subcomponents
import FundRequestTable from '../components/fundRequests/FundRequestTable';
import NewFundRequestModal from '../components/fundRequests/NewFundRequestModal';
import CancelFundRequestModal from '../components/fundRequests/CancelFundRequestModal';
import HOActionModal from '../components/fundRequests/HOActionModal';
import EmptyState from '../components/fundRequests/EmptyState';

// API Client
import { getFundRequests, createFundRequest, cancelFundRequest, actOnFundRequest } from '../api/fundRequests';

const FundRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, no }
  const [actionTarget, setActionTarget] = useState(null); // request object
  const [isCancelling, setIsCancelling] = useState(false);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'history' (used for HO/Admin)

  const isZoUser = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';
  const isHoUser = user?.role === 'ho' || user?.role === 'admin';

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getFundRequests();
      setRequests(response.data?.fundRequests ?? []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch fund requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Auto-dismiss success message
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(timer);
  }, [success]);

  const handleCreate = async (formData) => {
    await createFundRequest(formData);
    setSuccess(`Fund request ${formData.zo_fr_no} created successfully.`);
    fetchRequests();
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setError('');
    try {
      await cancelFundRequest(cancelTarget.id);
      setSuccess(`Fund request ${cancelTarget.no} cancelled successfully.`);
      setCancelTarget(null);
      fetchRequests();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel fund request.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleAct = async (actionData) => {
    if (!actionTarget) return;
    // actOnFundRequest handles API call
    await actOnFundRequest(actionTarget.fund_request_id, actionData);
    setSuccess(`Fund request ${actionTarget.zo_fr_no} successfully ${actionData.action === 'Approve' ? 'approved' : 'placed on hold'}.`);
    setActionTarget(null);
    fetchRequests();
  };

  // Filter requests based on tab for HO/Admin, or show all for ZO
  const getTabFilteredRequests = () => {
    if (!isHoUser) {
      return requests; // ZO/staff sees all their own requests in one list
    }
    if (activeTab === 'pending') {
      return requests.filter((r) => r.request_status === 'Pending');
    } else {
      return requests.filter((r) => r.request_status !== 'Pending');
    }
  };

  const tabFiltered = getTabFilteredRequests();

  const filteredRequests = tabFiltered.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.zo_fr_no?.toLowerCase().includes(q) ||
      r.zo_remarks?.toLowerCase().includes(q) ||
      r.request_status?.toLowerCase().includes(q) ||
      r.transfer_from_account?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              Government Division · Requisition
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Fund Requests</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              Submit and manage fund requests. Approved requests will display the source accounts (CC / OD / CR).
            </p>
          </div>
          {isZoUser && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Request
            </button>
          )}
        </div>

        {/* Notifications */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* Actions Panel with Tab Bar for HO/Admin */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-5">
          {isHoUser ? (
            <div className="flex items-center gap-1 glass-panel p-1 rounded-xl border border-white/5 self-start">
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  activeTab === 'pending'
                    ? 'bg-white/10 text-slate-100 border border-white/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pending Requests ({requests.filter(r => r.request_status === 'Pending').length})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  activeTab === 'history'
                    ? 'bg-white/10 text-slate-100 border border-white/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                History ({requests.filter(r => r.request_status !== 'Pending').length})
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 glass-panel p-1 rounded-xl border border-white/5 self-start">
              <span className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/10 text-slate-100 border border-white/10">
                All Requests ({requests.length})
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="relative flex-grow">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search requests..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 font-medium transition w-full sm:w-52"
              />
            </div>
            <button
              onClick={fetchRequests}
              title="Refresh"
              className="p-2.5 rounded-xl glass-input hover:border-white/20 transition-all duration-200 text-slate-400 hover:text-slate-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Requests Render Panel */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              onActionClick={() => setShowCreateModal(true)}
              showAction={isZoUser && !search}
            />
          ) : (
            <FundRequestTable
              requests={filteredRequests}
              user={user}
              onCancelClick={(id, no) => setCancelTarget({ id, no })}
              onActionClick={(req) => setActionTarget(req)}
            />
          )}
        </div>
      </main>

      {/* New Request Modal */}
      {showCreateModal && (
        <NewFundRequestModal
          user={user}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
        />
      )}

      {/* Confirm Cancel Modal */}
      {cancelTarget && (
        <CancelFundRequestModal
          requestNo={cancelTarget.no}
          isCancelling={isCancelling}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* HO Action Modal */}
      {actionTarget && (
        <HOActionModal
          user={user}
          request={actionTarget}
          onClose={() => setActionTarget(null)}
          onSave={handleAct}
        />
      )}
    </div>
  );
};

export default FundRequests;
