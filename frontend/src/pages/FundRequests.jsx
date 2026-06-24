import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';

// Subcomponents
import DashboardMetrics from '../components/fundRequests/DashboardMetrics';
import RequisitionCharts from '../components/fundRequests/RequisitionCharts';
import FundRequestTable from '../components/fundRequests/FundRequestTable';
import QuickFiltersSidebar from '../components/fundRequests/QuickFiltersSidebar';
import RequestDetailPanel from '../components/fundRequests/RequestDetailPanel';
import CancelFundRequestModal from '../components/fundRequests/CancelFundRequestModal';

// API Clients
import { getFundRequests, createFundRequest, cancelFundRequest, actOnFundRequest } from '../api/fundRequests';

const FundRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  
  // Dashboard navigation states
  const [activeRequest, setActiveRequest] = useState(null); // request details panel view
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, no }
  const [isCancelling, setIsCancelling] = useState(false);

  // Quick Filters State
  const [filters, setFilters] = useState({
    myRequests: false,
    pendingOnly: false,
    approvedThisMonth: false,
    onHoldRequests: false,
    largeAmount: false
  });

  const isZoUser = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const reqRes = await getFundRequests();
      setRequests(reqRes.data?.fundRequests ?? []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch fund requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-dismiss success message
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(timer);
  }, [success]);

  const handleCreate = async (formData) => {
    await createFundRequest(formData);
    setSuccess(`Fund request ${formData.zo_fr_no} submitted successfully.`);
    fetchData();
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setError('');
    try {
      await cancelFundRequest(cancelTarget.id);
      setSuccess(`Fund request ${cancelTarget.no} cancelled successfully.`);
      setCancelTarget(null);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel fund request.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelFromDetail = async (id) => {
    setError('');
    try {
      await cancelFundRequest(id);
      setSuccess('Fund request cancelled successfully.');
      setActiveRequest(null);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel fund request.');
    }
  };

  const handleAct = async (id, actionData) => {
    await actOnFundRequest(id, actionData);
    setSuccess(`Fund request successfully ${actionData.action === 'Approve' ? 'approved' : 'placed on hold'}.`);
    fetchData();
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleRowClick = (req) => {
    setActiveRequest(req);
  };

  const handleReviewNowTrigger = () => {
    setFilters(prev => ({ ...prev, pendingOnly: true }));
  };

  // Filter requests list based on search and quick checklist filters
  const getFilteredRequests = () => {
    let list = [...requests];

    if (filters.myRequests) {
      list = list.filter(r => r.zo_user_id === user?.mobile_number);
    }
    if (filters.pendingOnly) {
      list = list.filter(r => r.request_status === 'Pending');
    }
    if (filters.onHoldRequests) {
      list = list.filter(r => r.request_status === 'Hold');
    }
    if (filters.largeAmount) {
      list = list.filter(r => Number(r.zo_fr_amount) > 500000);
    }
    if (filters.approvedThisMonth) {
      list = list.filter(r => r.request_status === 'Approved');
    }

    const q = search.toLowerCase();
    if (q) {
      list = list.filter(r => 
        r.zo_fr_no?.toLowerCase().includes(q) ||
        r.zo_remarks?.toLowerCase().includes(q) ||
        r.request_status?.toLowerCase().includes(q)
      );
    }

    return list;
  };

  const filteredRequests = getFilteredRequests();

  // Create dynamic recent activity logs
  const activityLogs = requests
    .slice(0, 4)
    .map(r => {
      const time = r.updated_at ? new Date(r.updated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Just now';
      return {
        no: r.zo_fr_no,
        status: r.request_status,
        time: time
      };
    });

  const showDetailOrForm = activeRequest || showCreateFlow;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        
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

        {showDetailOrForm ? (
          /* Detail/Creation Mode Panel */
          <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
            <RequestDetailPanel
              user={user}
              request={activeRequest}
              onClose={() => {
                setActiveRequest(null);
                setShowCreateFlow(false);
              }}
              onSave={handleCreate}
              onAct={handleAct}
              onCancel={handleCancelFromDetail}
            />
          </div>
        ) : (
          /* Main Dashboard Mode View */
          <div>
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
              <div className="text-left">
                <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
                  Government Division · Requisition
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Fund Request Dashboard</h1>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  Monitor, review, and approve project fund request requisitions.
                </p>
              </div>
              {isZoUser && (
                <button
                  onClick={() => setShowCreateFlow(true)}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
                >
                  <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Request
                </button>
              )}
            </div>

            {/* Dashboard summary metric tiles */}
            <DashboardMetrics requests={requests} />

            {/* Snapshot gauges and queues */}
            <RequisitionCharts 
              requests={requests} 
              onReviewNowClick={handleReviewNowTrigger}
              isApprover={user?.role === 'ho' || user?.role === 'admin'}
            />

            {/* Lower Layout Panel: Left data table, Right sidebar filters */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
              
              {/* Left Data Grid (Table) */}
              <div className="lg:col-span-3 glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
                <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 text-left">Fund Requests List</span>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search requests..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 transition w-full sm:w-48"
                      />
                    </div>
                    <button
                      onClick={fetchData}
                      title="Refresh"
                      className="p-2 rounded-xl glass-input hover:border-white/20 transition text-slate-400 hover:text-slate-200"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center p-24">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
                  </div>
                ) : filteredRequests.length === 0 ? (
                  <div className="text-center p-24 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                    No requests matching filters.
                  </div>
                ) : (
                  <FundRequestTable
                    requests={filteredRequests}
                    user={user}
                    onRowClick={handleRowClick}
                    onCancelClick={(id, no) => setCancelTarget({ id, no })}
                  />
                )}
              </div>

              {/* Right Sidebar */}
              <div className="lg:col-span-1">
                <QuickFiltersSidebar
                  filters={filters}
                  onFilterChange={handleFilterChange}
                  activities={activityLogs}
                />
              </div>

            </div>
          </div>
        )}
      </main>

      {/* Confirm Cancel Modal */}
      {cancelTarget && (
        <CancelFundRequestModal
          requestNo={cancelTarget.no}
          isCancelling={isCancelling}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
};

export default FundRequests;
