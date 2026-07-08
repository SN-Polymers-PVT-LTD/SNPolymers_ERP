import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import { Button, Input, Modal } from '../components/ui';
import authApi from '../api/authApi';
import { exportToExcel } from '../utils/exportHelpers';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const ESTIMATE_STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_ZO_REVIEW: 'Under ZO Review',
  ZO_APPROVED: 'ZO Approved',
  UNDER_HO_REVIEW: 'Under HO Review',
  FINAL_APPROVED: 'Final Approved',
  REJECTED_BY_ZO: 'Rejected by ZO',
  REJECTED_BY_HO: 'Rejected by HO',
  ZO_REVISION_REQUESTED: 'ZO Revision Requested',
  HO_REVISION_REQUESTED: 'HO Revision Requested'
};

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const EstimateView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Tab control: 'items' | 'revisions'
  const [activeViewTab, setActiveViewTab] = useState('items');

  // Filter state for line items
  const [zoFilter, setZoFilter] = useState('all'); // 'all' | 'Approve' | 'Not Approve' | 'Pending'
  const [hoFilter, setHoFilter] = useState('all');

  // Review & Decisions States (ZO & HO)
  const [rowDecisions, setRowDecisions] = useState({}); // item_id -> { approve_status: 'Approve'|'Not Approve', remarks: '' }

  // Revision Modal State
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);

  // General States
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch estimate details using React Query
  const { data: estimateData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['estimate', id],
    queryFn: async () => {
      const [detailRes, revisionRes, purchaseRes] = await Promise.all([
        authApi.get(`/estimates/${id}`),
        authApi.get(`/estimates/${id}/revisions`),
        authApi.get('/purchase-data').catch(() => ({ data: { options: [] } }))
      ]);

      return {
        estimate: detailRes.data?.estimate,
        items: detailRes.data?.items || [],
        summary: detailRes.data?.summary,
        revisions: revisionRes.data?.revisions || [],
        purchaseOptions: purchaseRes.data?.options || []
      };
    }
  });

  const estimate = estimateData?.estimate;
  const items = useMemo(() => estimateData?.items || [], [estimateData?.items]);
  const summary = estimateData?.summary;
  const revisions = useMemo(() => estimateData?.revisions || [], [estimateData?.revisions]);
  const purchaseOptions = useMemo(() => estimateData?.purchaseOptions || [], [estimateData?.purchaseOptions]);

  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  // Initialize row decisions when estimateData is loaded
  useEffect(() => {
    if (!estimateData) return;
    const initialDecisions = {};
    const isZoStage = estimate?.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW;
    const isHoStage = estimate?.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW;
    
    items.forEach(item => {
      initialDecisions[item.item_id] = {
        approve_status: isZoStage ? (item.zo_office_approve || '') : isHoStage ? (item.ho_office_approve || '') : '',
        remarks: isZoStage ? (item.zo_remarks || '') : isHoStage ? (item.ho_remarks || '') : '',
        source_of_purchase: item.source_of_purchase || ''
      };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRowDecisions(initialDecisions);
  }, [estimateData, estimate, items]);

  const runningApprovedTotal = useMemo(() => {
    return items.reduce((acc, item) => {
      const dec = rowDecisions[item.item_id];
      if (estimate?.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW) {
        if (dec?.approve_status === 'Approve') {
          return acc + (Number(item.amount) || 0);
        }
      } else if (estimate?.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW) {
        if (item.zo_office_approve === 'Approve' && dec?.approve_status === 'Approve') {
          return acc + (Number(item.amount) || 0);
        }
      }
      return acc;
    }, 0);
  }, [items, rowDecisions, estimate]);

  const handleDecisionChange = (itemId, field, value) => {
    const updated = {
      ...rowDecisions,
      [itemId]: {
        ...rowDecisions[itemId],
        [field]: value
      }
    };
    
    // Auto-clear remarks if toggled back to Approve
    if (field === 'approve_status' && value === 'Approve') {
      updated[itemId].remarks = '';
    }

    setRowDecisions(updated);
  };

  const handleStartReview = async () => {
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const res = await authApi.patch(`/estimates/${id}/review`);
      if (res.data?.success) {
        setSuccess(res.data.message || 'Review stage opened.');
        queryClient.invalidateQueries({ queryKey: ['estimate', id] });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRowApprovals = async () => {
    setError('');
    setSuccess('');
    setSubmitting(true);

    const approvalsPayload = Object.keys(rowDecisions)
      .filter(itemId => rowDecisions[itemId].approve_status)
      .map(itemId => ({
        item_id: itemId,
        approve_status: rowDecisions[itemId].approve_status,
        remarks: rowDecisions[itemId].remarks || null,
        source_of_purchase: rowDecisions[itemId].source_of_purchase || null
      }));

    if (approvalsPayload.length === 0) {
      setError('Please record decisions before saving approvals.');
      setSubmitting(false);
      return;
    }

    // Validation: Rejections must have remarks
    for (const app of approvalsPayload) {
      if (app.approve_status === 'Not Approve' && (!app.remarks || app.remarks.trim() === '')) {
        setError('Remarks are mandatory for all unapproved items.');
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await authApi.post(`/estimates/${id}/row-approvals`, {
        approvals: approvalsPayload
      });
      if (res.data?.success) {
        setSuccess('Row approvals updated successfully.');
        queryClient.invalidateQueries({ queryKey: ['estimate', id] });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save row decisions.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReview = async () => {
    setError('');
    setSuccess('');

    // Ensure decisions are recorded for all rows
    const undecided = items.some(item => !rowDecisions[item.item_id]?.approve_status);
    if (undecided) {
      setError('Decisions must be recorded for all rows before finalizing the review.');
      return;
    }

    // Rejections must have remarks
    for (const item of items) {
      const dec = rowDecisions[item.item_id];
      if (dec.approve_status === 'Not Approve' && (!dec.remarks || dec.remarks.trim() === '')) {
        setError(`Please enter rejection comments for item: ${item.material_details}`);
        return;
      }
    }

    if (!window.confirm('Finalize your review submission? This status transition is transactional and permanent.')) return;

    setSubmitting(true);
    try {
      // 1. Submit Row Decisions first to ensure DB matches state
      const approvalsPayload = items.map(item => ({
        item_id: item.item_id,
        approve_status: rowDecisions[item.item_id].approve_status,
        remarks: rowDecisions[item.item_id].remarks || null,
        source_of_purchase: rowDecisions[item.item_id].source_of_purchase || null
      }));
      await authApi.post(`/estimates/${id}/row-approvals`, { approvals: approvalsPayload });

      // 2. Submit Final Review
      const remarks = prompt('Enter review summary comments (optional):') || '';
      const res = await authApi.post(`/estimates/${id}/submit-review`, { remarks });
      if (res.data?.success) {
        setSuccess('Review finalized successfully.');
        queryClient.invalidateQueries({ queryKey: ['estimate', id] });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestRevision = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Validation: Ensure there is at least one Not Approve row
    const hasRejections = Object.values(rowDecisions).some(dec => dec.approve_status === 'Not Approve');
    if (!hasRejections) {
      setError('At least one row must be marked "Not Approve" before requesting a revision.');
      setShowRevisionModal(false);
      return;
    }

    // Rejections must have remarks
    for (const itemId of Object.keys(rowDecisions)) {
      const dec = rowDecisions[itemId];
      if (dec.approve_status === 'Not Approve' && (!dec.remarks || dec.remarks.trim() === '')) {
        const item = items.find(i => i.item_id === itemId);
        setError(`Please enter rejection comments for item: ${item ? item.material_details : 'Selected item'}`);
        setShowRevisionModal(false);
        return;
      }
    }

    if (deadlineHours < 1 || deadlineHours > 168 || !Number.isInteger(deadlineHours)) {
      setError('Deadline must be an integer between 1 and 168 hours.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Save Row Decisions first
      const approvalsPayload = Object.keys(rowDecisions)
        .filter(itemId => rowDecisions[itemId].approve_status)
        .map(itemId => ({
          item_id: itemId,
          approve_status: rowDecisions[itemId].approve_status,
          remarks: rowDecisions[itemId].remarks || null,
          source_of_purchase: rowDecisions[itemId].source_of_purchase || null
        }));
      await authApi.post(`/estimates/${id}/row-approvals`, { approvals: approvalsPayload });

      // 2. Request Revision
      const res = await authApi.post(`/estimates/${id}/request-revision`, {
        deadline_hours: deadlineHours
      });

      if (res.data?.success) {
        setSuccess('Revision cycle initiated successfully.');
        setShowRevisionModal(false);
        queryClient.invalidateQueries({ queryKey: ['estimate', id] });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to request revision.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopenEstimate = async () => {
    if (!window.confirm('Are you sure you want to reopen this estimate? This will reset all ZO/HO approvals and remarks, and place it in the HO Revision stage.')) {
      return;
    }
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const res = await authApi.post(`/estimates/${id}/reopen`);
      if (res.data?.success) {
        setSuccess(res.data.message || 'Estimate reopened successfully.');
        queryClient.invalidateQueries({ queryKey: ['estimate', id] });
        queryClient.invalidateQueries({ queryKey: ['estimates'] });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reopen estimate.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-IN');
  };

  const getCategoryTotal = (category) => {
    const isMaterials = category.toLowerCase() === 'materials';
    return items
      .filter(item => {
        const head = item.material_main_head?.toLowerCase();
        if (isMaterials) {
          return head !== 'labour' && head !== 'transport' && head !== 'miscellaneous';
        }
        return head === category.toLowerCase();
      })
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  };

  if (loading) {
    return (
      <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
        <BackgroundShapes />
        <Sidebar />
        <MobileHeader />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
        </main>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
        <BackgroundShapes />
        <Sidebar />
        <MobileHeader />
        <main className="flex-grow flex items-center justify-center text-xs uppercase font-extrabold tracking-widest text-slate-400">
          Estimate details not found.
        </main>
      </div>
    );
  }

  const isJE = user?.role === 'je' || user?.role === 'staff';
  const isZO = user?.role === 'zo';
  const isHO = user?.role === 'ho';
  const isAdmin = user?.role === 'admin';

  // State checking
  const canStartZOReview = (isZO || isAdmin) && estimate.estimate_status === ESTIMATE_STATUS.SUBMITTED;
  const canStartHOReview = (isHO || isAdmin) && estimate.estimate_status === ESTIMATE_STATUS.ZO_APPROVED;
  
  const isCurrentlyInZOReview = estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW;
  const isCurrentlyInHOReview = estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW;
  
  const showReviewPanel = ((isZO || isAdmin) && isCurrentlyInZOReview) || ((isHO || isAdmin) && isCurrentlyInHOReview);
  const canEditEstimate = (isJE && [ESTIMATE_STATUS.DRAFT, ESTIMATE_STATUS.ZO_REVISION_REQUESTED, ESTIMATE_STATUS.HO_REVISION_REQUESTED].includes(estimate.estimate_status)) || isAdmin;
  const canReopen = (isHO || isAdmin) && [
    ESTIMATE_STATUS.FINAL_APPROVED,
    ESTIMATE_STATUS.REJECTED_BY_HO,
    ESTIMATE_STATUS.REJECTED_BY_ZO
  ].includes(estimate.estimate_status);

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Workflow Status: {estimate.estimate_status}</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Estimate Detail Console</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Manage, audit, and audit trail logs for cost estimate entry.</p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => exportToExcel(estimate, items)}
              variant="success"
            >
              Excel
            </Button>

            {canReopen && (
              <Button
                onClick={handleReopenEstimate}
                variant="danger"
                disabled={submitting}
              >
                Reopen Estimate
              </Button>
            )}
            {canEditEstimate && (
              <Button
                onClick={() => navigate(`/estimates/${id}/edit`)}
                variant="primary"
              >
                Edit Draft Items
              </Button>
            )}
            {canStartZOReview && (
              <Button
                onClick={handleStartReview}
                variant="amber"
              >
                Start ZO Review
              </Button>
            )}
            {canStartHOReview && (
              <Button
                onClick={handleStartReview}
                variant="primary"
              >
                Start HO Review
              </Button>
            )}
          </div>
        </div>

        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6">
            {displayError}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6">
            {success}
          </div>
        )}

        {/* PRINTABLE AREA CONTAINER */}
        <div id="printable-estimate-area" className="space-y-8 bg-black p-4 rounded-3xl">

        {/* 1. HEADER INFORMATION */}
        <div className="glass-panel p-6 rounded-3xl mb-8 border border-white/5 space-y-6">
          <div className="flex items-center gap-2 text-amber-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">1. Header Information</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 text-xs">
            <div>
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">Work Order No.</span>
              <span className="font-mono font-bold text-slate-200 text-sm">{estimate.work_order_no}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">Estimate No.</span>
              <span className="font-mono font-bold text-slate-200 text-sm">{estimate.estimate_no || 'Auto Generated'}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">State</span>
              <span className="text-slate-200 text-sm">{estimate.projects_master?.state || 'West Bengal'}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">District</span>
              <span className="text-slate-200 text-sm">{estimate.projects_master?.district || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">Area Code</span>
              <span className="font-mono font-bold text-slate-200 text-sm">{estimate.area_code}</span>
            </div>
            <div className="md:col-span-2 border-t border-white/5 pt-4">
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">Department</span>
              <span className="text-slate-300 text-sm">{estimate.projects_master?.department || 'N/A'}</span>
            </div>
            <div className="md:col-span-3 border-t border-white/5 pt-4">
              <span className="text-slate-500 block mb-1 font-bold uppercase text-[9px] tracking-wider">Site Details</span>
              <span className="text-slate-300 text-sm block leading-relaxed">{estimate.projects_master?.site_details}</span>
            </div>
          </div>
        </div>

        {/* Tab view controllers */}
        <div className="flex gap-6 mb-6 border-b border-white/5">
          <button
            onClick={() => setActiveViewTab('items')}
            className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeViewTab === 'items' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            2. Cost Estimate Line Items ({items.length})
          </button>
          <button
            onClick={() => setActiveViewTab('revisions')}
            className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeViewTab === 'revisions' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Revision Log Cycles ({revisions.length})
          </button>
        </div>

        {activeViewTab === 'items' ? (
          <>
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 mb-4 p-4 glass-panel rounded-2xl border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mr-2">Filter by Approval</span>
              
              {/* ZO Filter */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">ZO:</span>
                {['all', 'Approve', 'Not Approve', 'Pending'].map((opt) => (
                  <button
                    key={`zo-${opt}`}
                    onClick={() => setZoFilter(opt)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                      zoFilter === opt
                        ? opt === 'Approve'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : opt === 'Not Approve'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : opt === 'Pending'
                          ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-white/5 text-slate-500 border border-white/5 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    {opt === 'all' ? 'All' : opt}
                  </button>
                ))}
              </div>

              <div className="w-px h-5 bg-white/10 mx-1" />

              {/* HO Filter */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">HO:</span>
                {['all', 'Approve', 'Not Approve', 'Pending'].map((opt) => (
                  <button
                    key={`ho-${opt}`}
                    onClick={() => setHoFilter(opt)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                      hoFilter === opt
                        ? opt === 'Approve'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : opt === 'Not Approve'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : opt === 'Pending'
                          ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-white/5 text-slate-500 border border-white/5 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    {opt === 'all' ? 'All' : opt}
                  </button>
                ))}
              </div>

              {/* Reset + count */}
              {(zoFilter !== 'all' || hoFilter !== 'all') && (
                <>
                  <div className="w-px h-5 bg-white/10 mx-1" />
                  <button
                    onClick={() => { setZoFilter('all'); setHoFilter('all'); }}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-all duration-200"
                  >
                    ✕ Reset
                  </button>
                  <span className="text-[10px] text-slate-500 font-mono ml-auto">
                    Showing {items.filter(item => {
                      const zoVal = item.zo_office_approve || 'Pending';
                      const hoVal = item.ho_office_approve || 'Pending';
                      const zoMatch = zoFilter === 'all' || zoVal === zoFilter;
                      const hoMatch = hoFilter === 'all' || hoVal === hoFilter;
                      return zoMatch && hoMatch;
                    }).length} of {items.length} items
                  </span>
                </>
              )}
            </div>

            {/* 2. MATERIAL ENTRY / COST ESTIMATE LINE ITEMS */}
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden mb-8">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-400 font-mono">
                      <th className="py-4 px-5 w-12 text-center">Sl.</th>
                      <th className="py-4 px-5 w-40">Main Head</th>
                      <th className="py-4 px-5 w-40">Sub Head</th>
                      <th className="py-4 px-5">Material Details</th>
                      <th className="py-4 px-5 w-16 text-center">Unit</th>
                      <th className="py-4 px-5 w-20 text-center">Qty</th>
                      <th className="py-4 px-5 w-24 text-right">Rate</th>
                      <th className="py-4 px-5 w-28">Rate Ref</th>
                      <th className="py-4 px-5 w-32 text-right">Amount</th>
                      {showReviewPanel ? (
                        <>
                          <th className="py-4 px-5 w-44">Review Decision</th>
                          <th className="py-4 px-5">Remarks</th>
                        </>
                      ) : (
                        <>
                          <th className="py-4 px-5 w-28 text-center">ZO Approve</th>
                          <th className="py-4 px-5 w-36">ZO Remarks</th>
                          <th className="py-4 px-5 w-28 text-center">HO Approve</th>
                          <th className="py-4 px-5 w-36">HO Remarks</th>
                        </>
                      )}
                      <th className="py-4 px-5 w-40">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                    {items.filter(item => {
                        const zoVal = item.zo_office_approve || 'Pending';
                        const hoVal = item.ho_office_approve || 'Pending';
                        const zoMatch = zoFilter === 'all' || zoVal === zoFilter;
                        const hoMatch = hoFilter === 'all' || hoVal === hoFilter;
                        return zoMatch && hoMatch;
                      }).map((item, idx) => {
                      const dec = rowDecisions[item.item_id];
                      const isRejected = dec?.approve_status === 'Not Approve';

                      return (
                        <tr key={item.item_id} className="hover:bg-white/[0.01] transition-colors duration-200">
                           <td className="py-4 px-5 text-center font-mono text-slate-500">{idx + 1}</td>
                          <td className="py-4 px-5">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400">
                              {item.material_main_head}
                            </span>
                          </td>
                          <td className="py-4 px-5 text-slate-300 font-semibold">{item.material_sub_head}</td>
                          <td className="py-4 px-5 font-bold text-slate-200 whitespace-pre-wrap">{item.material_details}</td>
                          <td className="py-4 px-5 text-center text-slate-400 font-mono">{item.unit}</td>
                          <td className="py-4 px-5 text-center font-bold text-slate-300">{item.qty}</td>
                          <td className="py-4 px-5 text-right font-mono">{formatINR(item.rate)}</td>
                          <td className="py-4 px-5 text-slate-400 truncate max-w-[120px]">{item.rate_reference}</td>
                          <td className="py-4 px-5 text-right font-mono font-bold text-slate-200">
                            {formatINR(item.amount)}
                          </td>
                          {showReviewPanel ? (
                            <>
                              <td className="py-3 px-4">
                                <select
                                  value={dec?.approve_status || ''}
                                  onChange={(e) => handleDecisionChange(item.item_id, 'approve_status', e.target.value)}
                                  className="w-full bg-white/5 border border-white/10 p-2 rounded-lg text-xs"
                                  disabled={submitting}
                                >
                                  <option value="">Decide</option>
                                  <option value="Approve">Approve</option>
                                  <option value="Not Approve">Not Approve</option>
                                </select>
                              </td>
                              <td className="py-3 px-4">
                                <input
                                  type="text"
                                  placeholder={isRejected ? 'Remarks mandatory' : 'Optional comments'}
                                  value={dec?.remarks || ''}
                                  onChange={(e) => handleDecisionChange(item.item_id, 'remarks', e.target.value)}
                                  className={`w-full bg-white/5 border border-white/10 p-2 rounded-lg text-xs ${
                                    isRejected && !dec?.remarks?.trim() ? 'border border-red-500/50 bg-red-950/10' : ''
                                  }`}
                                  disabled={submitting}
                                  required={isRejected}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-4 px-5 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  item.zo_office_approve === 'Approve' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                                  item.zo_office_approve === 'Not Approve' ? 'bg-red-950/40 text-red-400 border border-red-900/30' : 'text-slate-500 bg-white/5 border border-transparent'
                                }`}>
                                  {item.zo_office_approve || 'Pending'}
                                </span>
                              </td>
                              <td className="py-4 px-5 text-slate-400 italic max-w-[150px] whitespace-pre-wrap break-words">
                                {item.zo_remarks || '-'}
                              </td>
                              <td className="py-4 px-5 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  item.ho_office_approve === 'Approve' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                                  item.ho_office_approve === 'Not Approve' ? 'bg-red-950/40 text-red-400 border border-red-900/30' : 'text-slate-500 bg-white/5 border border-transparent'
                                }`}>
                                  {item.ho_office_approve || 'Pending'}
                                </span>
                              </td>
                              <td className="py-4 px-5 text-slate-400 italic max-w-[150px] whitespace-pre-wrap break-words">
                                {item.ho_remarks || '-'}
                              </td>
                            </>
                          )}
                          <td className="py-4 px-5 text-slate-300 font-semibold">
                            {((isHO || isAdmin) && showReviewPanel) ? (
                              <select
                                value={dec?.source_of_purchase || ''}
                                onChange={(e) => handleDecisionChange(item.item_id, 'source_of_purchase', e.target.value)}
                                className="w-full bg-white/5 border border-white/10 p-2 rounded-lg text-xs text-slate-300"
                                disabled={submitting}
                              >
                                <option value="" className="bg-slate-900 text-slate-300">Select Source</option>
                                {purchaseOptions.map(o => (
                                  <option key={o.id} value={o.id} className="bg-slate-900 text-slate-300">{o.name}</option>
                                ))}
                              </select>
                            ) : (
                              item.purchase_data?.name || item.source_of_purchase || 'N/A'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-between items-center p-4 bg-white/[0.02] border-t border-white/5 text-xs text-slate-400 font-mono">
                <span>Total Items: <strong className="text-slate-200">{items.filter(item => {
                  const zoVal = item.zo_office_approve || 'Pending';
                  const hoVal = item.ho_office_approve || 'Pending';
                  return (zoFilter === 'all' || zoVal === zoFilter) && (hoFilter === 'all' || hoVal === hoFilter);
                }).length}</strong>{(zoFilter !== 'all' || hoFilter !== 'all') && <span className="text-slate-600 ml-1">(of {items.length})</span>}</span>
                <span>Total Materials Cost: <strong className="text-amber-500 font-bold">{formatINR(getCategoryTotal('Materials'))}</strong></span>
              </div>
            </div>

            {/* Bottom Grid for Summary and Approval Logs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8 items-start">
              
              {/* 3. ESTIMATE SUMMARY */}
              <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
                <div className="flex items-center gap-2 text-amber-500">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">3. Estimate Summary</h3>
                </div>
                
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                      <th className="pb-2">Description</th>
                      <th className="pb-2 text-right">Amount (INR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300 font-medium">
                    <tr>
                      <td className="py-2.5">Total Material Cost</td>
                      <td className="py-2.5 text-right font-mono">{formatINR(getCategoryTotal('Materials'))}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5">Total Labour Cost</td>
                      <td className="py-2.5 text-right font-mono">{formatINR(getCategoryTotal('Labour'))}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5">Total Transport Cost</td>
                      <td className="py-2.5 text-right font-mono">{formatINR(getCategoryTotal('Transport'))}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5">Miscellaneous Cost</td>
                      <td className="py-2.5 text-right font-mono">{formatINR(getCategoryTotal('Miscellaneous'))}</td>
                    </tr>
                    <tr className="border-t-2 border-white/10 font-bold text-slate-100 text-sm">
                      <td className="py-3 text-amber-500">Grand Total Estimate</td>
                      <td className="py-3 text-right font-mono text-amber-500">{formatINR(summary?.gross_total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 4. APPROVAL INFORMATION */}
              <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 lg:col-span-2">
                <div className="flex items-center gap-2 text-amber-500 mb-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">4. Approval Information</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-[11px]">
                  
                  {/* Preparer card */}
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                    <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 block border-b border-white/5 pb-1">JE / Estimate Preparer</span>
                    <div>
                      <span className="text-slate-500 block">JE User ID / Mob</span>
                      <span className="font-mono text-slate-300">{estimate.created_by}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">JE Name</span>
                      <span className="text-slate-300 font-semibold">{estimate.je_name || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Submission Status</span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/10 border border-amber-500/20 text-amber-400">
                        {estimate.estimate_status}
                      </span>
                    </div>
                    {estimate.je_remarks && (
                      <div>
                        <span className="text-slate-500 block">Remarks</span>
                        <span className="text-slate-300 italic block mt-0.5">"{estimate.je_remarks}"</span>
                      </div>
                    )}
                  </div>

                  {/* ZO card */}
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                    <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 block border-b border-white/5 pb-1">ZO Zonal Office</span>
                    <div>
                      <span className="text-slate-500 block">ZO Status</span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                        estimate.zo_name ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400' : 'text-slate-500 bg-white/5'
                      }`}>
                        {estimate.zo_name ? 'Approved' : 'Awaiting Audit'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Audited By</span>
                      <span className="text-slate-300 font-semibold">{estimate.zo_name || 'N/A'}</span>
                    </div>
                    {estimate.zo_approval_date && (
                      <div>
                        <span className="text-slate-500 block">Approval Date</span>
                        <span className="text-slate-300 font-mono">{formatDate(estimate.zo_approval_date)}</span>
                      </div>
                    )}
                  </div>

                  {/* HO card */}
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                    <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 block border-b border-white/5 pb-1">HO Head Office</span>
                    <div>
                      <span className="text-slate-500 block">HO Status</span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                        estimate.ho_name ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400' : 'text-slate-500 bg-white/5'
                      }`}>
                        {estimate.ho_name ? 'Final Approved' : 'Awaiting Audit'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Audited By</span>
                      <span className="text-slate-300 font-semibold">{estimate.ho_name || 'N/A'}</span>
                    </div>
                    {estimate.ho_approval_date && (
                      <div>
                        <span className="text-slate-500 block">Approval Date</span>
                        <span className="text-slate-300 font-mono">{formatDate(estimate.ho_approval_date)}</span>
                      </div>
                    )}
                  </div>

                </div>
              </div>

            </div>

            {/* Live Helper & Actions Panel */}
            {showReviewPanel && (
              <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 mb-8 bg-gradient-to-r from-amber-500/[0.01] to-white/[0.01]">
                <div className="text-left">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Session Audit Helper</span>
                  <p className="text-xs text-slate-400">Approved running total for items selected: <strong className="text-amber-500 font-mono">{formatINR(runningApprovedTotal)}</strong></p>
                </div>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    onClick={handleSaveRowApprovals}
                    variant="secondary"
                    disabled={submitting}
                  >
                    Save Row Approvals
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowRevisionModal(true)}
                    variant="amber"
                    disabled={submitting}
                  >
                    Request Revision
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSubmitReview}
                    variant="primary"
                    disabled={submitting}
                  >
                    Submit Final Review
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Revisions Log Tab */
          <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
            {revisions.length === 0 ? (
              <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                No revision request cycles are currently recorded for this cost estimate.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {revisions.map((rev) => (
                  <div key={rev.id} className="p-6 hover:bg-white/[0.01] transition duration-200 space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-lg mr-3">
                          Cycle {rev.revision_cycle}
                        </span>
                        <span className="text-slate-400 font-mono">Stage: {rev.stage}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">Created: {formatDate(rev.created_at)}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Requested By</span>
                        <span className="text-slate-300 font-semibold">{rev.requested_by_name || rev.requested_by}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Resubmitted By</span>
                        <span className="text-slate-300 font-semibold">
                          {rev.resubmitted_by_name === 'Auto-resubmitted by system' ? (
                            <span className="text-red-400 font-bold italic">Auto-resubmitted by system</span>
                          ) : (
                            rev.resubmitted_by_name || 'Awaiting Resubmission'
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Revision Deadline</span>
                        <span className="text-slate-300 font-mono">{formatDate(rev.revision_deadline)}</span>
                      </div>
                      {rev.resubmitted_at && (
                        <div>
                          <span className="text-slate-500 block">Resubmitted At</span>
                          <span className="text-slate-300 font-mono">{formatDate(rev.resubmitted_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        {/* ── REQUEST REVISION MODAL ── */}
        {showRevisionModal && (
          <Modal
            isOpen={true}
            onClose={() => setShowRevisionModal(false)}
            title="Request JE Revision"
            size="sm"
            footer={
              <div className="flex justify-end gap-3 w-full">
                <Button
                  variant="secondary"
                  onClick={() => setShowRevisionModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  form="revision-form"
                  disabled={submitting}
                >
                  Request Revision
                </Button>
              </div>
            }
          >
            <form id="revision-form" onSubmit={handleRequestRevision} className="space-y-5 text-left">
              <div>
                <Input
                  label="Revision Deadline duration (Hours)"
                  type="number"
                  min="1"
                  max="168"
                  value={deadlineHours}
                  onChange={(e) => setDeadlineHours(parseInt(e.target.value) || '')}
                  required
                  disabled={submitting}
                  size="sm"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Specify integer value between 1 and 168 hours (Max 7 days). Default is 24h.</span>
              </div>
            </form>
          </Modal>
        )}
      </main>
    </div>
  );
};

export default EstimateView;
