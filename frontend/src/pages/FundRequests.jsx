import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { Button, Input, Modal, SkeletonTable, Pagination } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Subcomponents
import DashboardMetrics from '../components/fundRequests/DashboardMetrics';
import RequisitionCharts from '../components/fundRequests/RequisitionCharts';
import FundRequestTable from '../components/fundRequests/FundRequestTable';
import WorkOrderFundSummaryTable from '../components/fundRequests/WorkOrderFundSummaryTable';
import QuickFiltersSidebar from '../components/fundRequests/QuickFiltersSidebar';
import RequestDetailPanel from '../components/fundRequests/RequestDetailPanel';
import CancelFundRequestModal from '../components/fundRequests/CancelFundRequestModal';
import ExportDateRangeModal from '../components/fundRequests/ExportDateRangeModal';

// API Clients
import { getFundRequests, createFundRequest, cancelFundRequest, actOnFundRequest } from '../api/fundRequests';
import { getProjects } from '../api/projectsApi';
import { getEstimatedBills } from '../api/estimatedBillsApi';
import { exportFundRequestsToExcel } from '../utils/exportHelpers';

const SUBMITTED_FR_STATUSES = new Set(['Pending', 'Hold', 'Approved']);

const buildSubmittedFrSumByWo = (requests) => {
  const frSumByWo = {};
  requests.forEach((r) => {
    if (!r.work_order_no || !SUBMITTED_FR_STATUSES.has(r.request_status)) return;
    frSumByWo[r.work_order_no] = (frSumByWo[r.work_order_no] || 0) + Number(r.zo_fr_amount || 0);
  });
  return frSumByWo;
};

const FundRequests = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  
  // Dashboard navigation states
  const [activeRequest, setActiveRequest] = useState(null); // request details panel view
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, no }
  const [isCancelling, setIsCancelling] = useState(false);
  const [createWorkOrder, setCreateWorkOrder] = useState('');

  // Quick Filters State
  const [filters, setFilters] = useState({
    myRequests: false,
    pendingOnly: false,
    approvedThisMonth: false,
    onHoldRequests: false,
    largeAmount: false,
    notSentToHo: false,
    remainingFundRequest: false
  });

  const isZoUser = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filters, pageSize]);

  // Fetch fund requests using React Query
  const { data: requestsData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['fundRequests'],
    queryFn: async () => {
      const res = await getFundRequests();
      return res.data?.fundRequests ?? [];
    },
    staleTime: 30 * 1000
  });

  const requests = requestsData || [];
  const displayError = error || queryError?.response?.data?.message || queryError?.message;

  const isWoLevelView = filters.notSentToHo || filters.remainingFundRequest;

  const { data: projectsList = [], isLoading: loadingProjects } = useQuery({
    queryKey: ['projects', 'fundRequestWoFilters'],
    queryFn: async () => {
      const res = await getProjects({ has_approved_estimate: true });
      return res.data?.projects ?? [];
    },
    enabled: isWoLevelView,
    staleTime: 60 * 1000
  });

  const { data: estimatedBillsList = [], isLoading: loadingEstimatedBills } = useQuery({
    queryKey: ['estimatedBills', 'fundRequestWoFilters'],
    queryFn: async () => {
      const res = await getEstimatedBills({ status: 'all' });
      return res.data?.data ?? [];
    },
    enabled: isWoLevelView,
    staleTime: 60 * 1000
  });

  const loadingWoView = isWoLevelView && (loadingProjects || loadingEstimatedBills);

  // Auto-dismiss success message
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(timer);
  }, [success]);

  const handleCreate = async (formData) => {
    try {
      await createFundRequest(formData);
      setSuccess(`Fund request ${formData.zo_fr_no} submitted successfully.`);
      queryClient.invalidateQueries({ queryKey: ['fundRequests'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create fund request.');
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setError('');
    try {
      await cancelFundRequest(cancelTarget.id);
      setSuccess(`Fund request ${cancelTarget.no} cancelled successfully.`);
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['fundRequests'] });
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
      queryClient.invalidateQueries({ queryKey: ['fundRequests'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel fund request.');
    }
  };

  const handleAct = async (id, actionData) => {
    try {
      await actOnFundRequest(id, actionData);
      setSuccess(`Fund request successfully ${actionData.action === 'Approve' ? 'approved' : 'placed on hold'}.`);
      queryClient.invalidateQueries({ queryKey: ['fundRequests'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to act on fund request.');
    }
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

  const handleCreateForWorkOrder = (workOrderNo) => {
    setCreateWorkOrder(workOrderNo || '');
    setShowCreateFlow(true);
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

  const woSummaryRows = useMemo(() => {
    if (!isWoLevelView || projectsList.length === 0) return [];

    const frSumByWo = buildSubmittedFrSumByWo(requests);
    const wosWithAnyFr = new Set(requests.map((r) => r.work_order_no).filter(Boolean));

    const estimatedValueByWo = {};
    estimatedBillsList.forEach((bill) => {
      estimatedValueByWo[bill.work_order_no] = Number(bill.estimated_bill_amount || 0);
    });
    requests.forEach((r) => {
      if (r.work_order_no && r.estimated_value != null) {
        estimatedValueByWo[r.work_order_no] = Number(r.estimated_value);
      }
    });

    let rows = projectsList.map((p) => {
      const estimatedValue = estimatedValueByWo[p.work_order_no] ?? null;
      const totalFrAmount = frSumByWo[p.work_order_no] || 0;
      return {
        work_order_no: p.work_order_no,
        zo_name: p.zo_user?.display_name || null,
        zo_user_id: p.zo_user_id,
        work_order_value: p.work_order_value != null ? Number(p.work_order_value) : null,
        estimated_value: estimatedValue,
        total_fr_amount: totalFrAmount,
        remaining_amount: estimatedValue != null ? estimatedValue - totalFrAmount : null
      };
    });

    if (filters.myRequests) {
      rows = rows.filter((r) => r.zo_user_id === user?.mobile_number);
    }
    if (filters.notSentToHo) {
      rows = rows.filter((r) => !wosWithAnyFr.has(r.work_order_no));
    }
    if (filters.remainingFundRequest) {
      rows = rows.filter((r) => r.estimated_value != null && r.remaining_amount > 0);
    }

    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.work_order_no?.toLowerCase().includes(q));
    }

    return rows.sort((a, b) => a.work_order_no.localeCompare(b.work_order_no));
  }, [isWoLevelView, projectsList, estimatedBillsList, requests, filters, search, user?.mobile_number]);

  const woViewMode = filters.notSentToHo && filters.remainingFundRequest
    ? 'remainingFundRequest'
    : filters.notSentToHo
      ? 'notSentToHo'
      : 'remainingFundRequest';

  const activeList = isWoLevelView ? woSummaryRows : filteredRequests;
  const totalPages = Math.ceil(activeList.length / pageSize) || 1;
  const paginatedRequests = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequests.slice(start, start + pageSize);
  }, [filteredRequests, currentPage, pageSize]);

  const paginatedWoRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return woSummaryRows.slice(start, start + pageSize);
  }, [woSummaryRows, currentPage, pageSize]);

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
    <>
        
         {showDetailOrForm ? (
          /* Detail/Creation Mode Panel */
          <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
            <RequestDetailPanel
              user={user}
              request={activeRequest ? (requests.find(r => r.fund_request_id === activeRequest.fund_request_id) || activeRequest) : null}
              onClose={() => {
                setActiveRequest(null);
                setShowCreateFlow(false);
                setCreateWorkOrder('');
              }}
              initialWorkOrder={createWorkOrder}
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
                <Button
                  onClick={() => {
                    setCreateWorkOrder('');
                    setShowCreateFlow(true);
                  }}
                  icon={
                    <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  }
                >
                  New Request
                </Button>
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
              <div className="lg:col-span-3 glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#0d131f]/90 backdrop-blur-xl">
                <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-300 text-left">
                    {isWoLevelView ? 'Work Order Summary' : 'Fund Requests List'}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="text"
                      placeholder="Search requests..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      size="sm"
                      iconLeft={
                        <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      }
                      containerClassName="w-full sm:w-48"
                    />

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

                    <Button
                      onClick={() => setShowExportModal(true)}
                      title="Export Excel"
                      variant="glass"
                      size="sm"
                      className="border-white/10 hover:border-amber-500/30 text-slate-300 hover:text-amber-400"
                    >
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export Excel
                    </Button>
                    <Button
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['fundRequests'] })}
                      title="Refresh"
                      variant="glass"
                      size="sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </Button>
                  </div>
                </div>

                {(loading || loadingWoView) ? (
                  <SkeletonTable rows={6} cols={6} />
                ) : activeList.length === 0 ? (
                  <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                    No {isWoLevelView ? 'work orders' : 'requests'} matching filters.
                  </div>
                ) : isWoLevelView ? (
                  <>
                    <WorkOrderFundSummaryTable
                      rows={paginatedWoRows}
                      mode={woViewMode}
                      isZoUser={isZoUser}
                      onCreateRequest={handleCreateForWorkOrder}
                    />
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} maxVisible={5} />
                  </>
                ) : (
                  <>
                    <FundRequestTable
                      requests={paginatedRequests}
                      user={user}
                      onRowClick={handleRowClick}
                      onActionClick={handleRowClick}
                      onCancelClick={(id, no) => setCancelTarget({ id, no })}
                    />

                    {/* Pagination Controls Footer */}
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} maxVisible={5} />
                  </>
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

      {/* Confirm Cancel Modal */}
      {cancelTarget && (
        <CancelFundRequestModal
          requestNo={cancelTarget.no}
          isCancelling={isCancelling}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* Export Date Range Modal */}
      {showExportModal && (
        <ExportDateRangeModal
          onClose={() => setShowExportModal(false)}
          onConfirm={(dateRange) => {
            setShowExportModal(false);
            exportFundRequestsToExcel(filteredRequests, dateRange);
          }}
        />
      )}
      {/* ── PREMIUM SUCCESS MODAL ── */}
      {success && (
        <Modal
          isOpen={true}
          onClose={() => setSuccess('')}
          title="Action Successful"
          subtitle="Fund Request Management"
          size="sm"
          footer={
            <Button
              variant="amber"
              onClick={() => setSuccess('')}
              className="w-full py-3 text-xs uppercase tracking-wider font-extrabold"
            >
              Continue
            </Button>
          }
        >
          <div className="text-center py-6 space-y-5 animate-fadeIn">
            {/* Animated checkmark container */}
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 p-0.5 shadow-lg shadow-emerald-500/20 flex items-center justify-center animate-bounce">
              <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-500 font-bold">Transaction Complete</span>
              <h3 className="text-lg font-extrabold text-white tracking-tight">Ledger Status Updated</h3>
              <p className="text-xs text-slate-400 leading-relaxed px-4">{success}</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── VALIDATION ERROR MODAL ── */}
      {displayError && (
        <Modal
          isOpen={true}
          onClose={() => setError('')}
          title="Action Blocked"
          subtitle="Validation Alert"
          size="sm"
          footer={
            <Button
              variant="primary"
              onClick={() => setError('')}
              className="w-full"
            >
              Understood
            </Button>
          }
        >
          <div className="text-center py-4 space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-xs text-slate-300 px-4 leading-relaxed font-semibold">
              {displayError}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
};

export default FundRequests;
